# Automate Magic AWS Infrastructure

This directory contains the AWS infrastructure for the Automate Magic application using AWS CDK.

## Architecture

The stack includes:

- **RDS PostgreSQL Database**: Named "automative" for storing all application data
- **Lambda Function**: Running the API with ts-rest instead of Next.js
- **API Gateway**: RESTful API endpoint
- **VPC**: Private network with public, private, and isolated subnets
- **Secrets Manager**: Storing database credentials and JWT secrets
- **Security Groups**: Controlling network access

## Prerequisites

1. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```

2. **Node.js** (v20 or higher)

3. **AWS CDK** installed globally
   ```bash
   npm install -g aws-cdk
   ```

4. **Bootstrap CDK** (first-time only)
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Install Lambda dependencies**:
   ```bash
   cd lambda/api
   npm install
   cd ../..
   ```

3. **Build the Lambda function**:
   ```bash
   cd lambda/api
   npm run build
   cd ../..
   ```

4. **Set environment variables**:
   ```bash
   export CDK_DEFAULT_ACCOUNT=your-account-id
   export CDK_DEFAULT_REGION=eu-west-1
   ```

## Deployment

### Deploy to Dev Environment

```bash
npm run deploy
```

or

```bash
cdk deploy
```

### Deploy to Production

```bash
cdk deploy --context stage=prod
```

### View Differences Before Deploy

```bash
npm run diff
```

### Synthesize CloudFormation Template

```bash
npm run synth
```

## Database Setup

After deployment, you need to initialize the database schema:

1. **Get the database endpoint** from the CDK outputs or AWS Console

2. **Connect to the database**:
   - Use AWS Systems Manager Session Manager to connect to a bastion host, or
   - Use a Lambda function to execute the schema SQL, or
   - Connect through a VPN/Direct Connect

3. **Run the schema SQL**:
   ```bash
   psql -h <db-endpoint> -U automative_admin -d automative -f sql/schema.sql
   ```

   The password is stored in AWS Secrets Manager. Retrieve it with:
   ```bash
   aws secretsmanager get-secret-value --secret-id /dev/automate-magic/db-credentials
   ```

## API Endpoints

After deployment, your API will be available at the API Gateway URL (shown in CDK outputs):

```
https://[api-id].execute-api.[region].amazonaws.com/dev
```

### Available Routes

- **Auth**:
  - `POST /api/auth/login` - User login
  - `POST /api/auth/register` - User registration
  - `GET /api/auth/profile` - Get user profile (requires Authorization header)

- **Students**:
  - `POST /api/students` - Create student
  - `GET /api/students` - List students (optional: ?branchId=uuid)
  - `GET /api/students/:id` - Get student by ID
  - `PATCH /api/students/:id` - Update student
  - `DELETE /api/students/:id` - Soft delete student

- **Branches**:
  - `POST /api/branches` - Create branch
  - `GET /api/branches` - List branches
  - `GET /api/branches/:id` - Get branch by ID
  - `PATCH /api/branches/:id` - Update branch

- **Courses**:
  - `POST /api/courses` - Create course
  - `GET /api/courses` - List courses (optional: ?branchId=uuid)
  - `GET /api/courses/:id` - Get course by ID
  - `PATCH /api/courses/:id` - Update course

- **Revenues**:
  - `POST /api/revenues` - Create revenue
  - `GET /api/revenues` - List revenues (optional: ?branchId=uuid&startDate=date&endDate=date)
  - `GET /api/revenues/:id` - Get revenue by ID
  - `PATCH /api/revenues/:id` - Update revenue

- **Expenses**:
  - `POST /api/expenses` - Create expense
  - `GET /api/expenses` - List expenses (optional: ?branchId=uuid&startDate=date&endDate=date)
  - `GET /api/expenses/:id` - Get expense by ID
  - `PATCH /api/expenses/:id` - Update expense

- **Analytics**:
  - `GET /api/analytics/dashboard` - Get dashboard analytics (optional: ?startDate=date&endDate=date)

## Updating the Frontend

Update your frontend API base URL to point to the API Gateway endpoint:

1. Find the API URL in the CDK deployment outputs
2. Update the environment configuration in your frontend
3. Replace `http://localhost:3000` with the API Gateway URL

Example for Angular:
```typescript
// src/environments/environment.ts
export const environment = {
  production: true,
  apiUrl: 'https://[api-id].execute-api.[region].amazonaws.com/dev'
};
```

## Stack Outputs

After deployment, you'll see:

- `ApiUrl` - The API Gateway endpoint URL
- `ApiId` - The API Gateway ID
- `DatabaseEndpoint` - The RDS database endpoint
- `DatabaseName` - The database name
- `DatabaseSecretArn` - ARN of the secret containing DB credentials
- `LambdaFunctionArn` - ARN of the API Lambda function

## Monitoring

- **CloudWatch Logs**: Lambda function logs are automatically sent to CloudWatch
- **CloudWatch Metrics**: API Gateway and Lambda metrics are available
- **X-Ray Tracing**: Enabled for API Gateway to trace requests

## Costs

Estimated monthly costs (varies by usage):

- **RDS t3.micro**: ~$15-20/month
- **Lambda**: Free tier: 1M requests/month + 400,000 GB-seconds
- **API Gateway**: Free tier: 1M requests/month
- **NAT Gateway**: ~$32/month (most expensive component)
- **Secrets Manager**: $0.40/secret/month

**Note**: You can reduce costs by removing the NAT Gateway if Lambda doesn't need internet access.

## Cleanup

To delete all resources:

```bash
npm run destroy
```

or

```bash
cdk destroy
```

**Warning**: This will delete the database and all data. Make sure to create a snapshot first if needed.

## Development

### Local Lambda Testing

You can test the Lambda function locally using:

```bash
cd lambda/api
npm test
```

### Update Lambda Code

After making changes to the Lambda code:

```bash
cd lambda/api
npm run build
cd ../..
npm run deploy
```

## Troubleshooting

### Lambda can't connect to RDS

- Verify the Lambda is in the same VPC as the RDS instance
- Check security group rules allow traffic from Lambda to RDS on port 5432
- Verify the database credentials in Secrets Manager

### API Gateway returns 403

- Check CORS configuration in the stack
- Verify the API Gateway deployment stage

### Database connection timeout

- Ensure the Lambda has the correct VPC subnet configuration
- Verify the RDS instance is accessible from the Lambda's subnet

## Security Considerations

1. **Secrets Management**: All sensitive data (DB credentials, JWT secrets) are stored in AWS Secrets Manager
2. **Network Isolation**: RDS is in an isolated subnet with no internet access
3. **IAM Roles**: Lambda has minimum required permissions
4. **Encryption**: RDS storage is encrypted at rest
5. **SSL/TLS**: All API communication is over HTTPS

## Migration from Backend

The old backend used file-based JSON storage. To migrate:

1. Deploy the AWS stack
2. Run the schema SQL to create tables
3. Create a migration script to read JSON files and insert into PostgreSQL
4. Update frontend to use new API URL
5. Test thoroughly before switching over

## Support

For issues or questions:
- Check CloudWatch logs for Lambda errors
- Review API Gateway execution logs
- Verify database connectivity
