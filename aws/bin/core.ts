#!/usr/bin/env node
import 'source-map-support/register';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';
import { LandingStack } from '../lib/landing-stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT || '365729671026';
const apiRegion = process.env.CDK_DEFAULT_REGION || 'eu-west-1';

// Route 53 zone for netrofit.com. Migrated from Google Cloud DNS on 2026-05-10
// because Google's zone couldn't apex-ALIAS to CloudFront. Referenced read-only
// by every netrofit.* stack so CDK can manage their A/AAAA alias records.
const netrofitZoneId = 'Z09915202RRKLGYSVZZTS';

// ─── DEV ────────────────────────────────────────────────────────────────────
new CoreStack(app, `AutomateMagicStack-dev`, {
  stage: 'dev',
  dbName: 'automative',
  env: { account, region: apiRegion },
  description: `Netrofit Application Stack (dev)`,
  tags: {
    Environment: 'dev',
    Application: 'AutomateMagic',
    ManagedBy: 'CDK',
  },
});

// Marketing landing page — must live in us-east-1 because ACM certs attached
// to CloudFront distributions must be issued in us-east-1. Single instance
// (apex netrofit.com is intrinsically prod-grade); no separate prod copy.
new LandingStack(app, `NetrofitLandingStack-dev`, {
  domainName: 'netrofit.com',
  sourcePath: path.resolve(__dirname, '../../landing/dist/netrofit-landing/browser'),
  hostedZoneId: netrofitZoneId,
  // Apex stack owns the zone-wide TXTs so we don't get duplicate-record CFN errors.
  zoneApexTxtRecords: {
    spf: 'v=spf1 -all',
    dmarc: 'v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s',
  },
  env: { account, region: 'us-east-1' },
  description: `Netrofit Landing Page (dev)`,
  tags: {
    Environment: 'dev',
    Application: 'NetrofitLanding',
    ManagedBy: 'CDK',
  },
});

// Dev frontend Angular app at dev.netrofit.com (calls dev API directly).
new LandingStack(app, `NetrofitFrontendStack-dev`, {
  domainName: 'dev.netrofit.com',
  wwwDomain: 'www.dev.netrofit.com',
  sourcePath: path.resolve(__dirname, '../../frontend/dist/automate-magic-frontend/browser'),
  hostedZoneId: netrofitZoneId,
  env: { account, region: 'us-east-1' },
  description: `Netrofit Frontend App (dev)`,
  tags: {
    Environment: 'dev',
    Application: 'NetrofitFrontend',
    ManagedBy: 'CDK',
  },
});

// ─── PROD ───────────────────────────────────────────────────────────────────
// Separate Aurora cluster, separate API, separate Lambda. SES identity stays
// owned by the dev stack to avoid the duplicate-identity error.
new CoreStack(app, `AutomateMagicStack-prod`, {
  stage: 'prod',
  dbName: 'automative_prod',
  apiCustomDomain: 'prod.api.netrofit.net',
  createSesIdentity: false,
  env: { account, region: apiRegion },
  description: `Netrofit Application Stack (prod)`,
  tags: {
    Environment: 'prod',
    Application: 'AutomateMagic',
    ManagedBy: 'CDK',
  },
});

// Prod frontend at app.netrofit.com — same-origin /api/* proxy to API Gateway
// custom domain so the network tab only ever shows app.netrofit.com.
new LandingStack(app, `NetrofitFrontendStack-prod`, {
  domainName: 'app.netrofit.com',
  wwwDomain: 'www.app.netrofit.com',
  sourcePath: path.resolve(__dirname, '../../frontend/dist/automate-magic-frontend-prod/browser'),
  apiProxy: {
    originDomain: 'prod.api.netrofit.net',
    pathPattern: '/api/*',
  },
  hostedZoneId: netrofitZoneId,
  env: { account, region: 'us-east-1' },
  description: `Netrofit Frontend App (prod)`,
  tags: {
    Environment: 'prod',
    Application: 'NetrofitFrontend',
    ManagedBy: 'CDK',
  },
});

app.synth();
