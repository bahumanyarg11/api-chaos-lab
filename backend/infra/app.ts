import * as cdk from "aws-cdk-lib";
import { ChaosLabStack } from "./stack.js";

const app = new cdk.App();
new ChaosLabStack(app, "ApiChaosLab", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
  description: "API Chaos Lab — AI-powered API resilience testing (API Gateway, Lambda, DynamoDB, S3, Bedrock, CloudWatch, CloudFront)",
});
