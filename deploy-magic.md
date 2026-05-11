# deploy-magic

Single source of truth for deploying anything in this repo. Always run from the project root unless noted otherwise.

All AWS commands use `--profile personal` (access keys, not SSO). Account `365729671026`, primary region `eu-west-1`, CloudFront/ACM region `us-east-1`.

---

## Stack inventory

CDK app entry: `aws/bin/core.ts`. Five stacks total:

| Stack | Region | What it is | Domain |
|---|---|---|---|
| `AutomateMagicStack-dev` | eu-west-1 | API Lambda + Aurora (dev) | `nrmh90r9h6.execute-api.eu-west-1.amazonaws.com/dev/` |
| `AutomateMagicStack-prod` | eu-west-1 | API Lambda + Aurora (prod) | `prod.api.netrofit.net` |
| `NetrofitLandingStack-dev` | us-east-1 | Marketing site (S3 + CloudFront) | `netrofit.com` |
| `NetrofitFrontendStack-dev` | us-east-1 | Angular app (dev) | `dev.netrofit.com` |
| `NetrofitFrontendStack-prod` | us-east-1 | Angular app (prod) | `app.netrofit.com` (same-origin `/api/*` proxy to prod API) |

CDK reads the built artifacts from disk — **you must build the right output folder before `cdk deploy`** or the upload step ships stale bits.

| Stack | Reads from |
|---|---|
| `NetrofitLandingStack-dev` | `landing/dist/netrofit-landing/browser` |
| `NetrofitFrontendStack-dev` | `frontend/dist/automate-magic-frontend/browser` |
| `NetrofitFrontendStack-prod` | `frontend/dist/automate-magic-frontend-prod/browser` |
| Both `AutomateMagicStack-*` | `aws/lambda/api/dist` (built JS bundle) |

---

## Frontend — dev (`dev.netrofit.com`)

```bash
cd frontend && npm run build && cd ..
cd aws && npx cdk deploy NetrofitFrontendStack-dev --profile personal --require-approval never && cd ..
```

`npm run build` uses the default Angular config (production optimization, no env file replacement) and writes to `dist/automate-magic-frontend/browser`.

## Frontend — prod (`app.netrofit.com`)

```bash
cd frontend && npm run build:prod && cd ..
cd aws && npx cdk deploy NetrofitFrontendStack-prod --profile personal --require-approval never && cd ..
```

`npm run build:prod` swaps in `environment.prod.ts` and writes to `dist/automate-magic-frontend-prod/browser`.

## Landing page (`netrofit.com`)

```bash
cd landing && npm run build && cd ..
cd aws && npx cdk deploy NetrofitLandingStack-dev --profile personal --require-approval never && cd ..
```

Single instance — the apex domain is intrinsically prod-grade, no separate prod copy.

---

## Backend API — dev

```bash
cd aws/lambda/api && npm run build && cd ../..
cd aws && npx cdk deploy AutomateMagicStack-dev --profile personal --require-approval never && cd ..
```

API URL: `https://nrmh90r9h6.execute-api.eu-west-1.amazonaws.com/dev/`

## Backend API — prod

```bash
cd aws/lambda/api && npm run build && cd ../..
cd aws && npx cdk deploy AutomateMagicStack-prod --profile personal --require-approval never && cd ..
```

API custom domain: `prod.api.netrofit.net`. Separate Aurora cluster, separate Lambda. SES identity stays owned by the dev stack to avoid duplicate-identity errors.

> If CDK creates a brand-new API Gateway (full delete + redeploy), the auto-generated execute-api URL changes. Update `frontend/src/environments/environment*.ts` and `memory/MEMORY.md` afterward.

---

## Deploy everything at once

Build all artifacts first, then deploy all stacks. CDK deploys stacks in dependency order; pass `--all` to do them in one shot.

```bash
# Build all artifacts
cd frontend && npm run build && npm run build:prod && cd ..
cd landing && npm run build && cd ..
cd aws/lambda/api && npm run build && cd ../..

# Deploy everything
cd aws && npx cdk deploy --all --profile personal --require-approval never && cd ..
```

---

## Diff / synth / destroy

```bash
cd aws
npx cdk list --profile personal                          # list stack names
npx cdk diff <StackName> --profile personal              # preview changes
npx cdk synth <StackName> --profile personal             # render template
npx cdk destroy <StackName> --profile personal           # DELETES — be sure
```

---

## Pre-flight checklist

1. AWS profile works: `aws sts get-caller-identity --profile personal` → account `365729671026`.
2. CDK bootstrapped in both regions (one-time): `npx cdk bootstrap aws://365729671026/eu-west-1 aws://365729671026/us-east-1 --profile personal`.
3. For backend deploys touching schema: run migrations first via the `/api/migrations/*` endpoints or `psql` against the Aurora cluster (see `MEMORY.md` for ARNs).
4. Don't `git add -A` build artifacts — `frontend/dist/`, `landing/dist/`, `aws/lambda/api/dist/`, and `aws/cdk.out*/` are gitignored for a reason.

---

## Troubleshooting

- **`no credentials have been configured`** → you forgot `--profile personal`, or your access keys expired. Re-run `aws configure --profile personal`.
- **`record already exists` on Route 53** → existing A/AAAA record blocks the alias. Delete it in the console (or remove the `hostedZoneId` prop temporarily) and redeploy. See `memory/dns_infrastructure.md`.
- **ACM cert validation hangs** → first deploy in `us-east-1` pauses until the validation CNAMEs land in Route 53. With `hostedZoneId` set, CDK creates them automatically.
- **Frontend deploys but old assets cached** → CloudFront invalidation runs on every `cdk deploy`; if you bypassed CDK (e.g. raw `aws s3 sync`), invalidate manually: `aws cloudfront create-invalidation --distribution-id <id> --paths "/*" --profile personal`.
- **Lambda build error: `Cannot find module 'typescript'`** → run `npm install` inside `aws/lambda/api` before `npm run build`.

---

## Quick reference card

```bash
# Frontend dev
cd frontend && npm run build && cd ../aws && npx cdk deploy NetrofitFrontendStack-dev --profile personal --require-approval never

# Frontend prod
cd frontend && npm run build:prod && cd ../aws && npx cdk deploy NetrofitFrontendStack-prod --profile personal --require-approval never

# Landing
cd landing && npm run build && cd ../aws && npx cdk deploy NetrofitLandingStack-dev --profile personal --require-approval never

# API dev
cd aws/lambda/api && npm run build && cd ../.. && cd aws && npx cdk deploy AutomateMagicStack-dev --profile personal --require-approval never

# API prod
cd aws/lambda/api && npm run build && cd ../.. && cd aws && npx cdk deploy AutomateMagicStack-prod --profile personal --require-approval never
```
