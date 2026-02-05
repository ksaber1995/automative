#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';

const app = new cdk.App();

// Get stage from context or default to 'dev'
const stage = app.node.tryGetContext('stage') || 'dev';

// Create the main stack
new CoreStack(app, `AutomateMagicStack-${stage}`, {
  stage,
  dbName: 'automative',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
  description: `Automate Magic Application Stack (${stage})`,
  tags: {
    Environment: stage,
    Application: 'AutomateMagic',
    ManagedBy: 'CDK',
  },
});

app.synth();
