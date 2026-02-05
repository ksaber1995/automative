#!/bin/bash

# Deploy script for Automate Magic AWS Infrastructure

set -e

echo "================================="
echo "Automate Magic AWS Deployment"
echo "================================="

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed"
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "Error: AWS CDK is not installed. Run: npm install -g aws-cdk"
    exit 1
fi

# Get stage from argument or default to dev
STAGE=${1:-dev}
echo "Deploying to stage: $STAGE"

# Install root dependencies
echo ""
echo "Installing CDK dependencies..."
npm install

# Install Lambda dependencies and build
echo ""
echo "Building Lambda function..."
cd lambda/api
npm install
npm run build
cd ../..

# Synthesize the stack
echo ""
echo "Synthesizing CDK stack..."
npm run synth

# Show diff
echo ""
echo "Showing deployment changes..."
cdk diff --context stage=$STAGE || true

# Confirm deployment
echo ""
read -p "Do you want to proceed with deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

# Deploy the stack
echo ""
echo "Deploying stack..."
cdk deploy --context stage=$STAGE --require-approval never

echo ""
echo "================================="
echo "Deployment completed successfully!"
echo "================================="
echo ""
echo "Next steps:"
echo "1. Get the API URL from the outputs above"
echo "2. Get database credentials from AWS Secrets Manager"
echo "3. Initialize the database using sql/schema.sql"
echo "4. Update your frontend API URL to point to the API Gateway endpoint"
echo ""
