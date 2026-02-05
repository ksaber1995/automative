# Migration Guide: Backend to AWS

This guide will help you migrate the Automate Magic application from the file-based backend to AWS infrastructure.

## What Changed

### Architecture Changes

**Before (Backend)**:
- NestJS backend running locally on port 3000
- File-based JSON storage in `data/` folder
- Local development only

**After (AWS)**:
- AWS Lambda with ts-rest (replaced Next.js as requested)
- Aurora Serverless v2 PostgreSQL database (supports RDS Query Editor)
- API Gateway for RESTful endpoints
- Serverless, scalable infrastructure with auto-scaling database

### Key Files Created

```
aws/
├── bin/
│   └── core.ts                    # CDK app entry point
├── lib/
│   └── core-stack.ts              # Main CDK stack (RDS, Lambda, API Gateway)
├── lambda/
│   └── api/
│       ├── src/
│       │   ├── index.ts           # Lambda handler
│       │   ├── contract.ts        # ts-rest API contract
│       │   ├── db/
│       │   │   └── connection.ts  # PostgreSQL connection
│       │   ├── utils/
│       │   │   ├── secrets.ts     # AWS Secrets Manager
│       │   │   └── jwt.ts         # JWT utilities
│       │   └── routes/
│       │       ├── auth.ts        # Auth routes
│       │       ├── students.ts    # Students routes
│       │       ├── branches.ts    # Branches routes
│       │       ├── courses.ts     # Courses routes
│       │       ├── revenues.ts    # Revenues routes
│       │       ├── expenses.ts    # Expenses routes
│       │       └── analytics.ts   # Analytics routes
│       ├── package.json
│       └── tsconfig.json
├── sql/
│   └── schema.sql                 # PostgreSQL database schema
├── package.json
├── tsconfig.json
├── cdk.json
├── .env.example
├── README.md
└── deploy.sh                      # Deployment script

frontend/src/environments/
└── environment.aws.ts             # AWS environment configuration
```

## Step-by-Step Migration

### Step 1: AWS Setup

1. **Install AWS CLI** (if not already installed):
   ```bash
   # Windows (using installer from AWS website)
   # Or using Chocolatey:
   choco install awscli

   # macOS
   brew install awscli

   # Linux
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   ```

2. **Configure AWS credentials** (using personal profile with access keys, not SSO):
   ```bash
   aws configure --profile personal
   ```
   Enter your:
   - AWS Access Key ID
   - AWS Secret Access Key
   - Default region: eu-west-1
   - Default output format: json

3. **Install AWS CDK globally**:
   ```bash
   npm install -g aws-cdk
   ```

4. **Bootstrap CDK** (first-time only):
   ```bash
   cdk bootstrap aws://YOUR-ACCOUNT-ID/YOUR-REGION
   ```

### Step 2: Deploy AWS Infrastructure

1. **Navigate to the AWS directory**:
   ```bash
   cd aws
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Install Lambda dependencies**:
   ```bash
   cd lambda/api
   npm install
   cd ../..
   ```

4. **Build Lambda function**:
   ```bash
   cd lambda/api
   npm run build
   cd ../..
   ```

5. **Deploy the stack**:
   ```bash
   # Deploy using personal profile
   npx cdk deploy --profile personal --require-approval never
   ```

5. **Save the outputs**:
   After deployment, you'll see outputs like:
   ```
   Outputs:
   AutomateMagicStack-dev.ApiUrl = https://abc123xyz.execute-api.eu-west-1.amazonaws.com/dev
   AutomateMagicStack-dev.DatabaseEndpoint = automatemagicdb.xyz123.eu-west-1.rds.amazonaws.com
   AutomateMagicStack-dev.DatabaseSecretArn = arn:aws:secretsmanager:...
   ```

   **Save the `ApiUrl` - you'll need it for the frontend!**

### Step 3: Initialize the Database

The database uses **Aurora Serverless v2 with Data API enabled**, so you can use the **AWS RDS Query Editor** directly from the console.

1. **Using RDS Query Editor** (Recommended - easiest method):
   - Go to [AWS RDS Console](https://console.aws.amazon.com/rds/)
   - Click **Query Editor** in the left sidebar
   - Select your database cluster: `automatemagicstack-dev-automatemagicauroradbef2379-*`
   - Connect using:
     - **Database credentials**: Choose "Connect with a Secrets Manager ARN"
     - **Secret**: Select `/dev/automate-magic/db-credentials`
     - **Database name**: `automative`
   - Copy and paste the contents of `aws/sql/schema.sql`
   - Execute the SQL to create all tables

2. **Alternative: Using AWS CLI with Data API**:
   ```bash
   aws rds-data execute-statement \
     --resource-arn "YOUR-CLUSTER-ARN" \
     --secret-arn "YOUR-SECRET-ARN" \
     --database "automative" \
     --sql "$(cat sql/schema.sql)" \
     --profile personal
   ```

3. **Get database credentials** (if needed for local connection):
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id /dev/automate-magic/db-credentials \
     --query SecretString \
     --output text \
     --profile personal
   ```

3. **Verify the database**:
   ```bash
   psql -h YOUR-DB-ENDPOINT -U automative_admin -d automative -c "\dt"
   ```
   You should see all the tables listed.

### Step 4: Migrate Existing Data (Optional)

If you have existing data in the JSON files, you need to migrate it:

1. **Create a migration script** (example):
   ```typescript
   // aws/scripts/migrate-data.ts
   import { Pool } from 'pg';
   import * as fs from 'fs';

   async function migrate() {
     const pool = new Pool({
       host: 'YOUR-DB-ENDPOINT',
       user: 'automative_admin',
       password: 'YOUR-PASSWORD',
       database: 'automative',
     });

     // Read JSON files
     const users = JSON.parse(fs.readFileSync('../data/users.json', 'utf-8'));
     const branches = JSON.parse(fs.readFileSync('../data/branches.json', 'utf-8'));
     // ... etc

     // Insert into database
     for (const user of users) {
       await pool.query(
         'INSERT INTO users (id, email, password, first_name, last_name, role, branch_id, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
         [user.id, user.email, user.password, user.firstName, user.lastName, user.role, user.branchId, user.isActive, user.createdAt, user.updatedAt]
       );
     }
     // ... repeat for other tables

     await pool.end();
   }

   migrate().catch(console.error);
   ```

2. **Run the migration**:
   ```bash
   cd aws/scripts
   npx ts-node migrate-data.ts
   ```

### Step 5: Update Frontend

1. **Update the API URL**:

   Open `frontend/src/environments/environment.aws.ts` and replace the placeholder:
   ```typescript
   export const environment = {
     production: true,
     apiUrl: 'https://YOUR-ACTUAL-API-ID.execute-api.eu-west-1.amazonaws.com/dev/api',
     // ... rest of config
   };
   ```

2. **Update Angular build configuration** (if needed):

   In `frontend/angular.json`, add the AWS environment:
   ```json
   "configurations": {
     "production": {
       "fileReplacements": [{
         "replace": "src/environments/environment.ts",
         "with": "src/environments/environment.prod.ts"
       }]
     },
     "aws": {
       "fileReplacements": [{
         "replace": "src/environments/environment.ts",
         "with": "src/environments/environment.aws.ts"
       }]
     }
   }
   ```

3. **Test the frontend**:
   ```bash
   cd frontend
   npm start
   ```

   The frontend should now connect to the AWS API Gateway.

### Step 6: Test the API

Test some endpoints to verify everything works:

1. **Register a user**:
   ```bash
   curl -X POST https://YOUR-API-URL/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "email": "test@example.com",
       "password": "password123",
       "firstName": "Test",
       "lastName": "User",
       "role": "ADMIN"
     }'
   ```

2. **Login**:
   ```bash
   curl -X POST https://YOUR-API-URL/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{
       "email": "test@example.com",
       "password": "password123"
     }'
   ```

3. **Create a branch** (using the token from login):
   ```bash
   curl -X POST https://YOUR-API-URL/api/branches \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR-JWT-TOKEN" \
     -d '{
       "name": "Test Branch",
       "code": "TB001"
     }'
   ```

## Differences from Backend

### API Response Format

The AWS Lambda with ts-rest returns slightly different response formats compared to NestJS:

**Backend (NestJS)**:
- Direct object returns
- Automatic error handling by NestJS

**AWS Lambda (ts-rest)**:
- Responses follow the contract schema
- Status codes are explicit
- CORS headers are automatically added

### Authentication

**Both use JWT tokens**, but:

**Backend**:
- JWT secrets in `.env` file
- Local file storage

**AWS**:
- JWT secrets in AWS Secrets Manager
- More secure, rotatable

### Database Queries

**Backend**:
- JSON file operations
- Mutex locks for concurrency

**AWS**:
- PostgreSQL queries
- Native database transactions
- Better performance and scalability

## Monitoring and Debugging

### CloudWatch Logs

View Lambda logs:
```bash
aws logs tail /aws/lambda/AutomateMagicStack-dev-ApiLambdaFunction --follow
```

### API Gateway Logs

Check API Gateway execution logs in the AWS Console:
- API Gateway → Your API → Stages → dev → Logs

### Database Monitoring

- Aurora Performance Insights (enabled by default)
- CloudWatch metrics for Aurora Serverless v2
- Automatic scaling between 0.5 - 1 ACU (Aurora Capacity Units)
- Query Editor for direct SQL access

## Cost Optimization

To reduce costs:

1. **Aurora Serverless v2 auto-scales** between 0.5 - 1 ACU (currently configured)
   - Adjust min/max capacity based on your workload
   - Consider pausing unused clusters (though v2 doesn't auto-pause like v1)
2. **Consider removing NAT Gateway** if Lambda doesn't need internet access
3. **Aurora automated backups** are enabled with 7-day retention
   - Adjust retention period based on requirements
4. **Use Lambda Provisioned Concurrency** only if needed
5. **Monitor Aurora capacity usage** to optimize ACU limits

## Troubleshooting

### Lambda Timeout

If Lambda times out connecting to RDS:
- Check VPC subnet configuration
- Verify security group rules
- Ensure Lambda is in a private subnet with NAT Gateway access

### Database Connection Errors

- Verify the Lambda has the correct IAM permissions to access Secrets Manager
- Check the Aurora cluster endpoint is correct (not writer instance endpoint)
- Ensure the Lambda security group can reach the Aurora security group on port 5432
- For Query Editor access, verify Data API is enabled on the cluster

### CORS Errors

CORS is configured in the CDK stack. If you see CORS errors:
- Verify the `allowOrigins` in `lib/core-stack.ts`
- Check the response headers in the Lambda handler

### 403 Forbidden from API Gateway

- Verify the Lambda has correct permissions
- Check the API Gateway deployment stage
- Ensure the Lambda integration is configured correctly

## Rollback Plan

If you need to rollback to the old backend:

1. Keep the backend code and `data/` folder intact
2. Update frontend environment to use `http://localhost:3000/api`
3. Start the backend:
   ```bash
   cd backend
   npm run start:dev
   ```

## Next Steps

After successful migration:

1. **Set up CI/CD** for automated deployments
2. **Configure custom domain** for API Gateway
3. **Set up monitoring alerts** in CloudWatch
4. **Enable AWS WAF** for API Gateway security
5. **Implement database backups** strategy
6. **Consider multi-region deployment** for high availability

## Support

For issues:
1. Check CloudWatch logs
2. Review the README in the `aws/` folder
3. Verify all environment variables are set correctly
4. Test individual Lambda functions using AWS Console

## Summary

You now have:
- ✅ Serverless architecture with AWS Lambda
- ✅ Aurora Serverless v2 PostgreSQL database with auto-scaling
- ✅ RDS Query Editor support with Data API enabled
- ✅ RESTful API with API Gateway
- ✅ ts-rest instead of Next.js (as requested)
- ✅ Secure secrets management with AWS Secrets Manager
- ✅ Fully scalable infrastructure
- ✅ Database schema matching your backend models
- ✅ All endpoints migrated from backend
- ✅ Personal AWS profile with access keys (not SSO)
