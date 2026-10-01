# Deploying API Chaos Lab on AWS (handoff guide)

The app currently runs publicly on Vercel (https://api-chaos-lab.vercel.app). The **production target is AWS**, and the "Zero to Shipped" hackathon only accepts apps that are **live on AWS at a public URL**. This guide deploys the full serverless stack with one CDK command (~10 minutes).

What gets created (all in `us-east-1` by default):

| Resource | Purpose |
|---|---|
| CloudFront distribution + S3 bucket | Hosts the React app; routes `/api/*` and `/x/*` to API Gateway (single public URL) |
| API Gateway HTTP API | `/api/{proxy+}` → control-plane Lambda, `/x/{proxy+}` → chaos Lambda; throttling 250 rps / burst 500 |
| 3 × Lambda (Node 22, arm64, X-Ray) | `ControlApi`, `ChaosProxy` (fault injection), `AiWorker` (Bedrock, 5 min timeout, async) |
| DynamoDB table (on-demand, TTL, PITR) | Projects, scenarios, runs, jobs, chaos events (events expire after 3 days) |
| S3 bucket | Raw + compiled OpenAPI specs |
| CloudWatch dashboard `ApiChaosLab` + alarm | Requests vs faults by type, latency p50/p95, Lambda health, AI worker duration |
| IAM | Least-privilege grants per function + `bedrock:InvokeModel/Converse` for the AI worker |

## 1. Prerequisites

- Node.js 20+ and npm
- AWS CLI (`aws --version`)
- An AWS account with permission to create the resources above

### Create credentials (IAM access key)
1. AWS Console → **IAM → Users → Create user** (e.g. `chaoslab-deployer`) → **Attach policies directly → AdministratorAccess** → Create.
2. Open the user → **Security credentials → Create access key → Command Line Interface (CLI)** → Create → copy both values.
3. On your machine:
   ```bash
   aws configure          # paste key id + secret, region: us-east-1, output: json
   aws sts get-caller-identity
   ```

### Enable Bedrock models
Bedrock console (region **us-east-1**) → **Model access** → enable **Amazon Nova Pro** and **Amazon Nova Lite** (or any other model you prefer). The model chain is configurable with `BEDROCK_MODEL_IDS` (comma-separated Bedrock model or inference-profile IDs, tried in order). Default: `us.amazon.nova-pro-v1:0,us.amazon.nova-lite-v1:0`.

If Bedrock isn't enabled, the app still works and uses its built-in rules engine for matrix, explanations and reports.

## 2. Deploy

```bash
git clone <this repo> && cd <repo>
npm --prefix web install && npm --prefix web run build      # the CDK stack uploads web/dist
cd backend && npm install
npx cdk bootstrap                                           # once per account/region
npx cdk deploy --require-approval never --outputs-file cdk-outputs.json
# optional: choose models
# BEDROCK_MODEL_IDS="us.amazon.nova-pro-v1:0" npx cdk deploy --require-approval never
```

The outputs include:
- `SiteUrl`: the public CloudFront URL (this is the live link for the hackathon submission)
- `ApiUrl`: the raw API Gateway endpoint
- `DashboardUrl`: the CloudWatch dashboard

Verify:
```bash
curl https://<SiteUrl>/api/health
# {"ok":true,...,"storage":"dynamodb","ai":"bedrock"}
```

To redeploy after code changes, run the same `npx cdk deploy` (rebuild `web` first if the UI changed). To tear everything down, run `npx cdk destroy`.

## 3. Optional: use Bedrock from the Vercel deployment

Vercel → Project `api-chaos-lab` → Settings → Environment Variables:
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1`, optionally `BEDROCK_MODEL_IDS`. Redeploy, and `/api/health` will report `"ai":"bedrock"`.
(Use a separate IAM user that only has `bedrock:InvokeModel` + `bedrock:Converse` permissions.)

## 4. Hackathon submission checklist (Zero to Shipped — due Oct 2, 11:59 PM PDT)

- [ ] App live on AWS: the CloudFront `SiteUrl` above
- [ ] Proof that the coding agent is connected to AWS: screenshots/logs of the agent running `aws sts get-caller-identity` and `cdk deploy`, plus the CloudFormation stack `ApiChaosLab` in the console
- [ ] Category tag `#commercial-potential`, lane tag `#startups`
- [ ] Project post: development process, how the coding agent helped ship, link to the live app, demo video (`video/out/chaoslab-demo.mp4`), GitHub repo

## Cost

Everything is pay-per-use. Idle cost is ~$0 (CloudFront/S3/DynamoDB on-demand/Lambda). Bedrock is billed per token, and Nova Lite/Pro are inexpensive. Run `npx cdk destroy` after judging if you want to remove everything.
