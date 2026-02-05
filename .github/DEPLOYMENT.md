# Deployment Guide

This repository uses GitHub Actions to automatically deploy the AWS infrastructure using CDK.

## Prerequisites

1. Personal AWS Account with access keys (not AWS SSO)
2. AWS CLI configured with `personal` profile
3. GitHub repository with Actions enabled

### AWS Profile Setup

Configure your personal AWS profile with access keys:

```bash
aws configure --profile personal
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Default region: eu-west-1
# Default output format: json
```

## Setup GitHub Secrets

Add the following secrets to your GitHub repository:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add:

### Required Secrets

| Secret Name | Description | Example |
|------------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | Your AWS Access Key ID | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | Your AWS Secret Access Key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |

### How to Create AWS Access Keys

1. Sign in to AWS Console
2. Go to **IAM** → **Users** → Select your user
3. Click **Security credentials** tab
4. Under **Access keys**, click **Create access key**
5. Choose **Application running outside AWS**
6. Download and save the credentials securely
7. Add them to GitHub secrets

## Deployment Triggers

The deployment workflow runs automatically when:

- **Push to master branch** - Changes in the `aws/` directory trigger deployment
- **Manual trigger** - Use the "Run workflow" button in Actions tab

## Manual Deployment

To manually trigger a deployment:

1. Go to **Actions** tab in GitHub
2. Select **Deploy to AWS** workflow
3. Click **Run workflow**
4. Choose the environment (dev/prod)
5. Click **Run workflow**

## Monitoring Deployments

- View deployment progress in the **Actions** tab
- Each deployment shows:
  - CDK diff (changes to be made)
  - Deployment logs
  - Stack outputs (API URL, Database endpoint, etc.)

## Local Development

To deploy locally using your personal AWS profile with access keys (not SSO):

```bash
# Build Lambda function
cd aws/lambda/api && npm run build

# Deploy CDK stack with personal profile
cd ../.. && npx cdk deploy --profile personal
```

**Note:** This project uses a personal AWS profile with access keys, not AWS SSO.

## Rollback

If you need to rollback a deployment:

1. Go to AWS CloudFormation console
2. Select the `AutomateMagicStack-dev` stack
3. Choose **Stack actions** → **Delete stack** (or update with previous version)

## Security Notes

- Never commit AWS credentials to the repository
- Use GitHub secrets for sensitive data (for CI/CD deployments)
- Local deployments use the `personal` AWS profile with access keys
- Rotate access keys regularly
- Use least-privilege IAM permissions

## Accessing the Database

The deployed Aurora Serverless v2 cluster supports the **RDS Query Editor** with Data API enabled.

### Using RDS Query Editor

1. Go to [AWS RDS Console](https://console.aws.amazon.com/rds/)
2. Click **Query Editor** in the left sidebar
3. Select your database cluster: `automatemagicstack-dev-automatemagicauroradbef2379-*`
4. Connect using:
   - **Database credentials**: Choose "Connect with a Secrets Manager ARN"
   - **Secret**: Select `/dev/automate-magic/db-credentials`
   - **Database name**: `automative`
5. Run SQL queries directly in the browser

### Database Details

- **Type**: Aurora Serverless v2 PostgreSQL 15.8
- **Scaling**: 0.5 - 1 ACU (Aurora Capacity Units)
- **Data API**: Enabled for Query Editor access
- **Backup**: 7-day retention with automatic snapshots

## Support

For issues with deployment, check:
1. GitHub Actions logs
2. AWS CloudFormation events in AWS Console
3. Lambda logs in CloudWatch
4. Aurora cluster logs in RDS console
