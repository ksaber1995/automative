# Deployment Guide

This repository uses GitHub Actions to automatically deploy the AWS infrastructure using CDK.

## Prerequisites

1. AWS Account with appropriate permissions
2. GitHub repository with Actions enabled

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

To deploy locally:

```bash
# Build Lambda function
cd aws/lambda/api && npm run build

# Deploy CDK stack
cd ../.. && npm run cdk deploy
```

## Rollback

If you need to rollback a deployment:

1. Go to AWS CloudFormation console
2. Select the `AutomateMagicStack-dev` stack
3. Choose **Stack actions** → **Delete stack** (or update with previous version)

## Security Notes

- Never commit AWS credentials to the repository
- Use GitHub secrets for sensitive data
- Rotate access keys regularly
- Use least-privilege IAM permissions
- Consider using AWS OIDC for GitHub Actions (more secure than access keys)

## Support

For issues with deployment, check:
1. GitHub Actions logs
2. AWS CloudFormation events in AWS Console
3. Lambda logs in CloudWatch
