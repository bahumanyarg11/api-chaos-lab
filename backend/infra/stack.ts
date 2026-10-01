import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "node:path";
import * as fs from "node:fs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cw from "aws-cdk-lib/aws-cloudwatch";

const ROOT = path.resolve(import.meta.dirname, "..");

export class ChaosLabStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------- data ----------------
    const table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    const dataBucket = new s3.Bucket(this, "SpecBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------------- compute ----------------
    const common: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, sourceMap: true, target: "node22", format: nodejs.OutputFormat.CJS },
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: dataBucket.bucketName,
        BEDROCK_MODEL_IDS: process.env.BEDROCK_MODEL_IDS ?? "us.amazon.nova-pro-v1:0,us.amazon.nova-lite-v1:0",
        BEDROCK_REGION: process.env.BEDROCK_REGION ?? cdk.Stack.of(this).region,
        NODE_OPTIONS: "--enable-source-maps",
      },
    };

    const worker = new nodejs.NodejsFunction(this, "AiWorker", { ...common, entry: path.join(ROOT, "src/handlers/worker.ts"), handler: "handler", timeout: cdk.Duration.minutes(5), description: "ChaosLab AI worker (Bedrock: matrix generation, explanations, resilience reports)" } as nodejs.NodejsFunctionProps);
    const api = new nodejs.NodejsFunction(this, "ControlApi", { ...common, entry: path.join(ROOT, "src/handlers/api.ts"), handler: "handler", timeout: cdk.Duration.seconds(29), description: "ChaosLab control plane API" } as nodejs.NodejsFunctionProps);
    api.addEnvironment("WORKER_FN", worker.functionName);
    const chaos = new nodejs.NodejsFunction(this, "ChaosProxy", { ...common, memorySize: 512, entry: path.join(ROOT, "src/handlers/chaos.ts"), handler: "handler", timeout: cdk.Duration.seconds(29), description: "ChaosLab data plane: mock/proxy + fault injection" } as nodejs.NodejsFunctionProps);

    for (const fn of [api, chaos, worker]) {
      table.grantReadWriteData(fn);
      dataBucket.grantReadWrite(fn);
    }
    worker.grantInvoke(api);
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream", "aws-marketplace:ViewSubscriptions", "aws-marketplace:Subscribe"],
        resources: ["*"],
      }),
    );

    // ---------------- API Gateway (HTTP API) ----------------
    const http = new apigw.HttpApi(this, "HttpApi", {
      description: "API Chaos Lab",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigw.CorsHttpMethod.ANY],
        allowHeaders: ["*"],
        exposeHeaders: ["x-chaos-fault", "x-chaos-scenario", "x-chaos-event", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"],
        maxAge: cdk.Duration.hours(1),
      },
    });
    http.addRoutes({ path: "/api/{proxy+}", methods: [apigw.HttpMethod.ANY], integration: new HttpLambdaIntegration("ApiInt", api) });
    http.addRoutes({ path: "/x/{proxy+}", methods: [apigw.HttpMethod.ANY], integration: new HttpLambdaIntegration("ChaosInt", chaos) });
    const stage = http.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingBurstLimit: 500, throttlingRateLimit: 250 };
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split("/", http.apiEndpoint));

    // ---------------- web (S3 + CloudFront) ----------------
    const webBucket = new s3.Bucket(this, "WebBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`function handler(event){var r=event.request;var u=r.uri;if(!u.includes('.')){r.uri='/index.html';}return r;}`),
    });
    const apiOrigin = new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY, readTimeout: cdk.Duration.seconds(45) });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_AND_SECURITY_HEADERS,
    };
    const dist = new cloudfront.Distribution(this, "Site", {
      comment: "API Chaos Lab",
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: { "/api/*": apiBehavior, "/x/*": apiBehavior },
    });

    const webDist = path.join(ROOT, "../web/dist");
    if (fs.existsSync(path.join(webDist, "index.html"))) {
      new s3deploy.BucketDeployment(this, "DeployWeb", {
        sources: [s3deploy.Source.asset(webDist)],
        destinationBucket: webBucket,
        distribution: dist,
        distributionPaths: ["/*"],
        memoryLimit: 1024,
      });
    }

    // ---------------- observability ----------------
    const ns = "ApiChaosLab";
    const m = (name: string, stat = "Sum", dims?: Record<string, string>) => new cw.Metric({ namespace: ns, metricName: name, statistic: stat, period: cdk.Duration.minutes(1), dimensionsMap: dims });
    const faults = ["latency", "timeout", "http_500", "http_502_html", "http_503", "rate_limit_429", "malformed_json", "missing_fields", "schema_drift", "intermittent", "auth_401"];
    const dash = new cw.Dashboard(this, "Dashboard", { dashboardName: "ApiChaosLab" });
    dash.addWidgets(
      new cw.TextWidget({ markdown: "# API Chaos Lab — live chaos telemetry\nRequests through the chaos data plane, faults injected by type, latency and Lambda health.", width: 24, height: 2 }),
      new cw.GraphWidget({ title: "Chaos requests vs faults injected", left: [m("Requests", "Sum", { Fault: "none" }).with({ label: "healthy" }), ...faults.map((f) => m("FaultsInjected", "Sum", { Fault: f }).with({ label: f }))], stacked: true, width: 12, height: 7 }),
      new cw.GraphWidget({ title: "Data-plane latency (ms)", left: [m("Latency", "p50", {}).with({ label: "p50" }), m("Latency", "p95", {}).with({ label: "p95" })], width: 12, height: 7 }),
      new cw.GraphWidget({ title: "Lambda invocations", left: [api.metricInvocations(), chaos.metricInvocations(), worker.metricInvocations()], width: 8, height: 6 }),
      new cw.GraphWidget({ title: "Lambda errors", left: [api.metricErrors(), chaos.metricErrors(), worker.metricErrors()], width: 8, height: 6 }),
      new cw.GraphWidget({ title: "AI worker duration (Bedrock)", left: [worker.metricDuration({ statistic: "p90" })], width: 8, height: 6 }),
    );
    new cw.Alarm(this, "ControlApiErrors", { metric: api.metricErrors({ period: cdk.Duration.minutes(5) }), threshold: 5, evaluationPeriods: 1, alarmDescription: "ChaosLab control API Lambda errors" });

    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${dist.distributionDomainName}` });
    new cdk.CfnOutput(this, "ApiUrl", { value: http.apiEndpoint });
    new cdk.CfnOutput(this, "DashboardUrl", { value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=ApiChaosLab` });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
  }
}
