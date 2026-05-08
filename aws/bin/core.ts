#!/usr/bin/env node
import 'source-map-support/register';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';
import { LandingStack } from '../lib/landing-stack';

const app = new cdk.App();

// Get stage from context or default to 'dev'
const stage = app.node.tryGetContext('stage') || 'dev';
const account = process.env.CDK_DEFAULT_ACCOUNT || '365729671026';

// Create the main stack
new CoreStack(app, `AutomateMagicStack-${stage}`, {
  stage,
  dbName: 'automative',
  env: {
    account,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
  description: `Netrofit Application Stack (${stage})`,
  tags: {
    Environment: stage,
    Application: 'AutomateMagic',
    ManagedBy: 'CDK',
  },
});

// Marketing landing page — must live in us-east-1 because ACM certs attached
// to CloudFront distributions must be issued in us-east-1.
new LandingStack(app, `NetrofitLandingStack-${stage}`, {
  domainName: 'netrofit.com',
  sourcePath: path.resolve(__dirname, '../../landing/dist/netrofit-landing/browser'),
  env: { account, region: 'us-east-1' },
  description: `Netrofit Landing Page (${stage})`,
  tags: {
    Environment: stage,
    Application: 'NetrofitLanding',
    ManagedBy: 'CDK',
  },
});

app.synth();
