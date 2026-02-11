# CDK Deployment Guide

Simple guide for deploying the multi-tenant application using AWS CDK with personal profile (access keys).

## Prerequisites

1. **AWS CLI** configured with personal profile
   ```bash
   aws configure --profile personal
   # Enter your Access Key ID and Secret Access Key
   ```

2. **AWS CDK** installed globally
   ```bash
   npm install -g aws-cdk
   ```

3. **Database Migrations** completed
   - Run migrations on your RDS database first (see below)

## Quick Deployment

### Option 1: Using Deploy Script (Recommended)

```bash
cd aws

# Deploy to development
./deploy.sh dev personal

# Deploy to production
./deploy.sh prod personal
```

The script will:
- ✅ Install dependencies
- ✅ Build Lambda function
- ✅ Synthesize CDK stack
- ✅ Show deployment diff
- ✅ Ask for confirmation
- ✅ Deploy to AWS

### Option 2: Manual CDK Commands

```bash
cd aws

# Install dependencies
npm install

# Build Lambda function
cd lambda/api
npm install
npm run build
cd ../..

# Synthesize stack
npm run synth

# Deploy with personal profile
cdk deploy --profile personal --context stage=prod
```

## Database Migration (CRITICAL - Do This First!)

Before deploying the backend, you **MUST** run database migrations:

### Step 1: Connect to Your RDS Database

```bash
# Export database credentials
export DB_HOST="your-rds-endpoint.amazonaws.com"
export DB_PORT="5432"
export DB_NAME="automate_magic"
export DB_USER="admin"
export DB_PASSWORD="your-password"
```

### Step 2: Run Migrations

From project root:

```bash
# Make scripts executable (first time only)
chmod +x run-migrations.sh
chmod +x verify-database.sh

# Run all migrations
./run-migrations.sh
```

Or manually run each migration:

```bash
cd aws/sql/migrations

# Run migrations in order
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f 001_create_companies_table.sql
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f 002_add_company_id_to_all_tables.sql
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f 003_migrate_existing_data.sql
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f 004_enforce_company_id_constraints.sql
```

### Step 3: Verify Migration

```bash
./verify-database.sh
```

Should output:
```
✓ MIGRATION SUCCESSFUL
All checks passed. Database is ready for multi-tenant operation.
```

## Deployment Order

**CRITICAL**: Follow this order to prevent downtime and errors:

1. ✅ **Database Migrations** (see above)
2. ✅ **Backend Deployment** (CDK deploy)
3. ✅ **Frontend Deployment** (separate process)

## Backend Deployment Details

### What Gets Deployed

- **Lambda Function** - API backend with multi-tenant isolation
- **API Gateway** - REST API endpoint
- **RDS Database** - PostgreSQL (if creating new)
- **Secrets Manager** - Database credentials
- **IAM Roles** - Lambda execution roles

### Environment Variables

The Lambda function needs these environment variables (set in CDK stack):

```typescript
environment: {
  DATABASE_URL: // from Secrets Manager
  JWT_SECRET: // your secret
  JWT_REFRESH_SECRET: // your refresh secret
  NODE_ENV: 'production'
}
```

### Verify Deployment

After deployment completes:

```bash
# Get API URL from CDK outputs
# It will be printed at the end of deployment

# Test health endpoint
curl https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod/health

# Test registration (create a test company)
curl -X POST https://your-api-url/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Test Company",
    "companyEmail": "test@test.com",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@test.com",
    "password": "testpass123"
  }'
```

## Rollback

If deployment fails or has issues:

```bash
# Rollback to previous version
cdk deploy --profile personal --rollback

# Or manually in AWS Console:
# 1. Go to CloudFormation
# 2. Find your stack
# 3. Click "Stack actions" → "Roll back"
```

## Common Issues

### Issue: CDK Bootstrap Required

```
Error: This stack uses assets, so the toolkit stack must be deployed
```

**Solution**:
```bash
cdk bootstrap aws://ACCOUNT-ID/REGION --profile personal
```

### Issue: Lambda Build Fails

```
Error: Cannot find module 'typescript'
```

**Solution**:
```bash
cd aws/lambda/api
npm install
npm run build
cd ../../..
```

### Issue: Database Connection Failed

```
Error: Connection refused
```

**Solution**:
1. Check RDS security group allows Lambda VPC access
2. Verify DATABASE_URL in Secrets Manager
3. Check RDS instance is running

### Issue: Old JWT Tokens Still Valid

**This is expected** - Migration invalidates all tokens!

Users must:
1. Logout
2. Login again
3. Tokens now include companyId

## Stages

### Development Stage

```bash
./deploy.sh dev personal
```

- Development environment
- Separate RDS instance (or same with different database)
- For testing before production

### Production Stage

```bash
./deploy.sh prod personal
```

- Production environment
- Live user data
- **Requires maintenance window**
- **Notify users first**

## Monitoring After Deployment

### CloudWatch Logs

```bash
# View Lambda logs
aws logs tail /aws/lambda/AutomateMagicAPI-prod --follow --profile personal

# Filter for errors
aws logs tail /aws/lambda/AutomateMagicAPI-prod --follow --filter-pattern "ERROR" --profile personal
```

### Check API Gateway

1. Go to AWS Console → API Gateway
2. Find your API
3. Check "Stages" → "prod"
4. View metrics and logs

### Check Lambda Function

1. Go to AWS Console → Lambda
2. Find your function
3. View "Monitoring" tab
4. Check invocations, errors, duration

## Cost Optimization

After deployment, monitor costs:

- **Lambda**: Pay per request (very cheap for small apps)
- **RDS**: Database instance running 24/7 (main cost)
- **API Gateway**: Pay per million requests

Consider:
- RDS: Use t3.micro for small workloads
- Lambda: 1GB memory is usually sufficient
- Enable RDS auto-pause for development environments

## Security Checklist

Before production deployment:

- [ ] Database in private subnet (no public access)
- [ ] Lambda in VPC with RDS
- [ ] Secrets in AWS Secrets Manager
- [ ] Environment variables not in code
- [ ] API Gateway with custom domain + SSL
- [ ] CloudWatch logs enabled
- [ ] IAM roles follow least privilege

## Next Steps After Deployment

1. **Get API URL** from CDK outputs
2. **Update Frontend** environment.prod.ts with API URL
3. **Deploy Frontend** to hosting (S3, Vercel, etc.)
4. **Test Multi-Tenant Isolation**:
   ```bash
   API_URL=https://your-api-url ./test-multi-tenant.sh
   ```
5. **Monitor for 24 hours** - Check CloudWatch logs and metrics
6. **Notify Users** - Inform them to re-login

## Quick Commands Reference

```bash
# Deploy to production
cd aws && ./deploy.sh prod personal

# Deploy backend only (no confirmation)
cdk deploy --profile personal --require-approval never

# Show what will change
cdk diff --profile personal

# Destroy stack (DELETE EVERYTHING - BE CAREFUL!)
cdk destroy --profile personal

# View CloudFormation template
cdk synth --profile personal

# List all stacks
cdk list --profile personal
```

## Support

If you encounter issues:

1. Check CloudWatch Logs for Lambda errors
2. Check API Gateway execution logs
3. Verify database migrations completed
4. Review DEPLOYMENT_GUIDE.md for detailed troubleshooting
5. Check MULTI_TENANT_DEV_GUIDE.md for code patterns

---

**Remember**: Database migrations BEFORE backend deployment!
