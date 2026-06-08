# Karim's Deploy Cheatsheet

Quick reference for deploying Netrofit (AutomateMagic) to **dev** and **prod**.

- **AWS profile:** `personal` (access keys, not SSO)
- **API/DB region:** `eu-west-1` · **Frontend/Landing (CloudFront) region:** `us-east-1`
- Frontend ships via CDK `BucketDeployment` → building Angular + `cdk deploy <stack>` *is* the deploy (CloudFront invalidation is automatic).
- All `cdk` commands run from the `aws/` folder. PowerShell syntax below.

## Stacks

| Stack | What | Region |
|---|---|---|
| `AutomateMagicStack-dev` | API Gateway + Lambda + Aurora (dev) | eu-west-1 |
| `NetrofitFrontendStack-dev` | Angular app → dev.netrofit.com | us-east-1 |
| `AutomateMagicStack-prod` | API Gateway + Lambda + Aurora (prod) | eu-west-1 |
| `NetrofitFrontendStack-prod` | Angular app → app.netrofit.com | us-east-1 |
| `NetrofitLandingStack-dev` | Marketing site → netrofit.com | us-east-1 |

---

## One-time setup

```powershell
aws configure --profile personal   # region eu-west-1, output json
npm install -g aws-cdk
cd D:\automative\aws; npm install
cd D:\automative\aws\lambda\api; npm install
```

---

## Deploy to DEV

```powershell
# 1. Build the Lambda (API)
cd D:\automative\aws\lambda\api; npm run build

# 2. Deploy API + DB
cd D:\automative\aws; npx cdk deploy AutomateMagicStack-dev --profile personal

# 3. Build the frontend (dev → dist/automate-magic-frontend)
cd D:\automative\frontend; npm run build

# 4. Deploy the frontend
cd D:\automative\aws; npx cdk deploy NetrofitFrontendStack-dev --profile personal
```

Deploy everything dev in one go:
```powershell
cd D:\automative\aws\lambda\api; npm run build
cd D:\automative\frontend; npm run build
cd D:\automative\aws; npx cdk deploy AutomateMagicStack-dev NetrofitFrontendStack-dev --profile personal
```

---

## Deploy to PROD

```powershell
# 1. Build the Lambda (API)
cd D:\automative\aws\lambda\api; npm run build

# 2. Deploy API + DB
cd D:\automative\aws; npx cdk deploy AutomateMagicStack-prod --profile personal

# 3. Build the frontend (PROD config → dist/automate-magic-frontend-prod)
cd D:\automative\frontend; npm run build:prod

# 4. Deploy the frontend
cd D:\automative\aws; npx cdk deploy NetrofitFrontendStack-prod --profile personal
```

> ⚠️ Prod uses `npm run build:prod` (different output folder). Don't use the plain `npm run build` for the prod frontend stack.

---

## Landing page (netrofit.com)

```powershell
cd D:\automative\landing; npm run build
cd D:\automative\aws; npx cdk deploy NetrofitLandingStack-dev --profile personal
```

---

## Preview changes before deploying

```powershell
cd D:\automative\aws
npx cdk diff AutomateMagicStack-dev --profile personal     # any stack name
npx cdk list --profile personal                            # list all stacks
```

---

## Database migrations (run BEFORE backend deploy when schema changes)

Run from a machine that can reach the DB (Git Bash / WSL — these are bash scripts). Set DB env vars first.

```bash
DB_HOST=... DB_NAME=automative DB_USER=... DB_PASSWORD=... ./run-migrations.sh
./verify-database.sh            # expect: ✓ MIGRATION SUCCESSFUL
```

Or run SQL directly via the **RDS Query Editor** (Data API enabled):
secret `/dev/automate-magic/db-credentials`, database `automative` (prod: `automative_prod`).

---

## Post-deploy checks

```powershell
# Get stack outputs (API URL, DB endpoint, CloudFront, ...)
aws cloudformation describe-stacks --stack-name AutomateMagicStack-dev `
  --query "Stacks[0].Outputs" --region eu-west-1 --profile personal

# Health check (use the API URL from outputs)
curl https://<api-url>/health
```

---

## CI/CD (automatic)

Pushing to `master` with changes under `aws/**` triggers `.github/workflows/deploy.yml`
(deploys the dev CDK stack). Manual run: **Actions → Deploy to AWS → Run workflow** (choose dev/prod).

---

## Rollback

CloudFormation console → select stack → **Stack actions** → update/delete, or redeploy a previous git commit.
Full procedure: see `DEPLOYMENT_CHECKLIST.md`.
