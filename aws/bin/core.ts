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
  frontendBaseUrl: 'https://dev.netrofit.com',
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
    spf: 'v=spf1 include:amazonses.com -all',
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
  frontendBaseUrl: 'https://app.netrofit.com',
  // Public API base for the Telegram webhook. Use the execute-api URL directly:
  // the prod.api.netrofit.net custom domain isn't wired in DNS (the Route 53 zone
  // is netrofit.com, not netrofit.net), so Telegram can't reach it. The
  // execute-api hostname resolves with a valid cert and Telegram accepts it.
  apiBaseUrl: 'https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod',
  env: { account, region: apiRegion },
  description: `Netrofit Application Stack (prod)`,
  tags: {
    Environment: 'prod',
    Application: 'AutomateMagic',
    ManagedBy: 'CDK',
  },
});

// Prod frontend at app.netrofit.com — same-origin /api/* proxy to API Gateway.
// Using the execute-api hostname directly (with stage path prefix) to avoid
// needing a separate DNS zone for netrofit.net.
new LandingStack(app, `NetrofitFrontendStack-prod`, {
  domainName: 'app.netrofit.com',
  wwwDomain: 'www.app.netrofit.com',
  sourcePath: path.resolve(__dirname, '../../frontend/dist/automate-magic-frontend-prod/browser'),
  apiProxy: {
    originDomain: 'xnbgr057y1.execute-api.eu-west-1.amazonaws.com',
    pathPattern: '/api/*',
    originPath: '/prod',
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

// The owner's superadmin console at dione.netrofit.com.
//
// Public hostname, but not a public tool: everything it talks to sits behind the
// portal sign-in added in routes/admin-portal.ts, so the login page is the only
// thing an unauthenticated visitor can reach. The API it calls was already on
// the public internet — putting the UI beside it adds no new exposure.
//
// apiProxy, so the console calls a relative /api/* on its own origin: no CORS,
// no preflight, and the execute-api hostname stays out of the shipped bundle.
// No www: nobody types www in front of an admin console.
new LandingStack(app, `NetrofitAdminStack-prod`, {
  domainName: 'dione.netrofit.com',
  wwwDomain: null,
  sourcePath: path.resolve(__dirname, '../../admin/dist/admin/browser'),
  apiProxy: {
    originDomain: 'xnbgr057y1.execute-api.eu-west-1.amazonaws.com',
    pathPattern: '/api/*',
    originPath: '/prod',
  },
  hostedZoneId: netrofitZoneId,
  // New stack, new cert — so it can validate itself in the zone instead of
  // waiting for someone to paste a CNAME. Never turn this on for the three
  // stacks above; it would replace certs that are already issued.
  certValidationInZone: true,
  env: { account, region: 'us-east-1' },
  description: `Netrofit Admin Console (prod)`,
  tags: {
    Environment: 'prod',
    Application: 'NetrofitAdmin',
    ManagedBy: 'CDK',
  },
});

app.synth();
