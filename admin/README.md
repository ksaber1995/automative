# Netrofit Admin (local-only superadmin console)

A tiny tool **for you only** — it lists every company/tenant in the system with
their subscription, employee count, branch count, and start/end dates. It is
**never deployed**; you run it on your laptop.

## How it works

```
Angular app (localhost:4300)  ──/api──►  local Node server (localhost:3001)  ──RDS Data API──►  Aurora
```

The Aurora cluster lives in a private VPC, so there's no direct Postgres route
from your laptop. Instead the local server uses **AWS access keys** to call the
**RDS Data API** (already enabled on the cluster) over HTTPS. A browser can't
sign those SigV4 requests itself, which is why there's a thin local server
holding the keys. No cloud endpoint is created or deployed.

## One-time setup

```bash
cd admin
npm install
cp .env.example .env      # (Windows PowerShell: copy .env.example .env)
```

Then edit `.env` and fill in:

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — an IAM user/role allowed to call
  `rds-data:ExecuteStatement` and `secretsmanager:GetSecretValue`.
- `DB_CLUSTER_ARN`, `DB_SECRET_ARN`, `DB_NAME` — from the CloudFormation outputs:

  ```bash
  aws cloudformation describe-stacks --stack-name AutomateMagicStack-dev \
    --query "Stacks[0].Outputs" --region eu-west-1 --profile personal
  ```

  Use the `DatabaseClusterArn`, `DatabaseSecretArn`, and `DatabaseName` values.
  - **dev:**  stack `AutomateMagicStack-dev`,  `DB_NAME=automative`
  - **prod:** stack `AutomateMagicStack-prod`, `DB_NAME=automative_prod`

> `.env` is gitignored — never commit your keys.

## Run

```bash
npm start          # runs the local server + Angular dev server together
```

Open <http://localhost:4300>. Use the search box to filter by company name or
subscription type.

Run pieces separately if you prefer:

```bash
npm run server     # local API only (localhost:3001)
npm run web        # Angular only  (localhost:4300)
```

## The query

A single read-only statement (see `server/index.js`) joins `companies` with
`subscriptions` and counts `employees`/`branches` per company. "Type" is the
subscription `status` (`TRIAL` / `ACTIVE` / …); start/end fall back to the trial
window for companies still on trial. To change what's shown, edit
`SUBSCRIPTIONS_SQL` in `server/index.js`.
