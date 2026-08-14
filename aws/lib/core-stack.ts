import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CoreStackProps extends cdk.StackProps {
  stage?: string;
  dbName?: string;
  /** Optional custom domain for API Gateway, e.g. "prod.api.netrofit.net". Cert is regional, in this stack's region. */
  apiCustomDomain?: string;
  /**
   * Whether this stack should claim the SES domain identity for netrofit.com.
   * Only one stack per account+region can own it — defaults to true; set false on duplicate stacks.
   */
  createSesIdentity?: boolean;
  /**
   * Absolute base URL of the deployed frontend for this stage. Used to build
   * password-reset links in transactional emails. Required because the default
   * (localhost) produces dead links once mail leaves the developer's laptop.
   */
  frontendBaseUrl?: string;
  /**
   * Absolute public base URL of this stage's API (e.g. "https://prod.api.netrofit.net").
   * Used to register the Telegram bot webhook. When unset, Telegram bot setup
   * will report a configuration error rather than registering a bad webhook.
   */
  apiBaseUrl?: string;
}

export class CoreStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly database: rds.DatabaseCluster;
  public readonly apiLambda: lambda.Function;

  constructor(scope: Construct, id: string, props?: CoreStackProps) {
    super(scope, id, props);

    const stage = props?.stage || 'dev';
    const dbName = props?.dbName || 'automative';
    const createSesIdentity = props?.createSesIdentity ?? true;

    // =============================================
    // VPC - Virtual Private Cloud
    // =============================================
    const vpc = new ec2.Vpc(this, 'AutomateMagicVPC', {
      maxAzs: 2, // Use 2 Availability Zones for high availability
      natGateways: 1, // Single NAT Gateway to reduce costs
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // =============================================
    // Security Groups
    // =============================================
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for Aurora Serverless v2 PostgreSQL database',
      allowAllOutbound: true,
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // Allow Lambda to connect to RDS
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to PostgreSQL'
    );

    // =============================================
    // Aurora Serverless v2 PostgreSQL Database
    // =============================================

    // Create database credentials secret
    const dbCredentialsSecret = new secretsmanager.Secret(this, 'DBCredentialsSecret', {
      secretName: `/${stage}/automate-magic/db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'automative_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Create JWT secrets
    const jwtSecret = new secretsmanager.Secret(this, 'JWTSecret', {
      secretName: `/${stage}/automate-magic/jwt-secret`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'secret',
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    const jwtRefreshSecret = new secretsmanager.Secret(this, 'JWTRefreshSecret', {
      secretName: `/${stage}/automate-magic/jwt-refresh-secret`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'secret',
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // WhatsApp Cloud API platform credentials — Netrofit's own Meta app, shared
    // by every tenant (each tenant's number and token live in their own secret,
    // see the tenant policy below).
    //
    // The three meta_* fields are placeholders filled in by hand from the Meta
    // dashboard after App Review; CloudFormation only writes generateSecretString
    // on CREATE, so redeploys never clobber what was pasted in. That is the whole
    // reason these are a secret and not a `process.env.X ?? ''` env var — that
    // pattern silently blanks the value on any deploy that forgets the variable,
    // which is exactly how the licence signing key was lost once already.
    //
    // webhook_verify_token is generated here rather than invented by a human: it
    // is an arbitrary shared string, and Meta only ever echoes it back.
    const whatsappSecret = new secretsmanager.Secret(this, 'WhatsAppPlatformSecret', {
      secretName: `/${stage}/automate-magic/whatsapp/platform`,
      description: 'Meta WhatsApp Cloud API app credentials + webhook verify token',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          meta_app_id: '',
          meta_app_secret: '',
          meta_config_id: '',
        }),
        generateStringKey: 'webhook_verify_token',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 48,
      },
    });

    // Web Push VAPID keypair — used to send free browser/PWA push notifications
    // to parents (docs/parent-pwa-notifications-plan.md), no per-message cost
    // and no third-party account unlike WhatsApp.
    //
    // Unlike the WhatsApp secret above, nobody pastes these in from a vendor
    // dashboard — they're a self-contained EC keypair we generate ourselves.
    // Still created here as blank placeholders rather than generated by CDK,
    // for the same reason: generateSecretString can only produce an arbitrary
    // random string, not a mathematically-related public/private EC pair, and
    // CloudFormation only writes generateSecretString on CREATE — a real
    // keypair has to be pasted in by hand exactly once, the same as the Meta
    // credentials, so a redeploy can never blank it.
    const pushVapidSecret = new secretsmanager.Secret(this, 'PushVapidSecret', {
      secretName: `/${stage}/automate-magic/push/vapid`,
      description: 'Web Push VAPID keypair for parent PWA notifications',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          publicKey: '',
          privateKey: '',
          // The mailto: contact VAPID requires push services be able to reach
          // if they need to flag abuse. Not a secret, kept alongside the keys
          // purely so one JSON blob has everything sendPush needs.
          subject: 'mailto:ksaber@octiga.com',
        }),
        generateStringKey: '_unused',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Aurora Serverless v2 Cluster
    this.database = new rds.DatabaseCluster(this, 'AutomateMagicAuroraDB', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_8,
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      defaultDatabaseName: dbName,
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      backup: {
        // 35 days (Aurora's maximum) rather than the default week: migrations here
        // self-apply at runtime via the `ensure*` guards, so a bad backfill writes
        // wrong values silently and is typically noticed when someone questions a
        // number — well after a 7-day restore window would have closed. Costs cents
        // a month at this volume size.
        retention: cdk.Duration.days(35),
      },
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      deletionProtection: stage === 'prod',
      serverlessV2MinCapacity: 0.5, // Minimum ACUs
      serverlessV2MaxCapacity: 1, // Maximum ACUs (adjust based on your needs)
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
        enablePerformanceInsights: true,
      }),
      // Enable Data API for Query Editor support
      enableDataApi: true,
    });

    // =============================================
    // Lambda Function for API
    // =============================================

    // Lambda execution role
    const lambdaRole = new iam.Role(this, 'ApiLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant Lambda access to secrets
    dbCredentialsSecret.grantRead(lambdaRole);
    jwtSecret.grantRead(lambdaRole);
    jwtRefreshSecret.grantRead(lambdaRole);
    whatsappSecret.grantRead(lambdaRole);
    pushVapidSecret.grantRead(lambdaRole);

    // Per-tenant WhatsApp credentials. Unlike every other secret here these are
    // created at runtime — a tenant connects their number through Embedded Signup
    // and the API writes the resulting token — so the Lambda needs write access,
    // scoped to this one path and nothing else. Secrets Manager appends a random
    // 6-char suffix to every ARN, hence the trailing wildcard.
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:PutSecretValue',
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
        'secretsmanager:DeleteSecret',
        'secretsmanager:TagResource',
      ],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:/${stage}/automate-magic/whatsapp/tenant/*`,
      ],
    }));

    // Where to paste the Meta app credentials after App Review, and the verify
    // token Meta asks for when subscribing the webhook. See
    // docs/whatsapp-meta-setup.md.
    new cdk.CfnOutput(this, 'WhatsAppPlatformSecretName', {
      value: whatsappSecret.secretName,
      description: 'Secret holding meta_app_id / meta_app_secret / meta_config_id / webhook_verify_token',
    });

    // Where to paste the generated VAPID keypair — see
    // docs/parent-pwa-notifications-plan.md §9 step 1.
    new cdk.CfnOutput(this, 'PushVapidSecretName', {
      value: pushVapidSecret.secretName,
      description: 'Secret holding publicKey / privateKey / subject for Web Push',
    });

    // Grant Lambda permission to send emails via SES
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // =============================================
    // SES Domain Identity (Easy DKIM enabled by default)
    // =============================================
    // Verifies netrofit.com so the Lambda can send `From: anything@netrofit.com`.
    // After deploy, paste the 3 DKIM CNAMEs (in stack outputs) into Squarespace
    // DNS — once propagated, AWS marks the identity verified automatically.
    if (createSesIdentity) {
      const emailIdentity = new ses.EmailIdentity(this, 'NetrofitEmailIdentity', {
        identity: ses.Identity.domain('netrofit.com'),
      });

      new cdk.CfnOutput(this, 'SesDkim1', {
        value: `${emailIdentity.dkimDnsTokenName1} CNAME ${emailIdentity.dkimDnsTokenValue1}`,
      });
      new cdk.CfnOutput(this, 'SesDkim2', {
        value: `${emailIdentity.dkimDnsTokenName2} CNAME ${emailIdentity.dkimDnsTokenValue2}`,
      });
      new cdk.CfnOutput(this, 'SesDkim3', {
        value: `${emailIdentity.dkimDnsTokenName3} CNAME ${emailIdentity.dkimDnsTokenValue3}`,
      });
    }

    // API Lambda Function
    this.apiLambda = new NodejsFunction(this, 'ApiLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/api/src/index.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node20',
        // Bundle everything — don't rely on Lambda runtime versions
        externalModules: [],
        // Needed so esbuild can resolve path aliases and module resolution correctly
        tsconfig: path.join(__dirname, '../lambda/api/tsconfig.json'),
      },
      environment: {
        NODE_ENV: stage,
        DB_HOST: this.database.clusterEndpoint.hostname,
        DB_PORT: this.database.clusterEndpoint.port.toString(),
        DB_NAME: dbName,
        DB_CREDENTIALS_SECRET_ARN: dbCredentialsSecret.secretArn,
        JWT_SECRET_ARN: jwtSecret.secretArn,
        JWT_REFRESH_SECRET_ARN: jwtRefreshSecret.secretArn,
        JWT_EXPIRATION: '365d',
        JWT_REFRESH_EXPIRATION: '365d',
        // SES sender — must be a verified identity in AWS SES (email or domain).
        // netrofit.com is verified via the SES EmailIdentity construct above.
        SENDER_EMAIL: 'noreply@netrofit.com',
        // Google reCAPTCHA v3 secret for server-side verification. When unset
        // (dev), verifyRecaptcha skips the check and allows requests through.
        // TODO: move to Secrets Manager once we're past the first deploy.
        RECAPTCHA_V3_SECRET_KEY: process.env.RECAPTCHA_V3_SECRET_KEY ?? '6LcwMOYsAAAAALzbgYLfn0a7YuW9-MNufQL9M9Kp',
        // Used to build absolute URLs in transactional emails (password reset).
        // Passed in per stage from bin/core.ts; falls back to localhost so a
        // developer running `ng serve` against this Lambda still gets working
        // links during local end-to-end testing.
        FRONTEND_BASE_URL: props?.frontendBaseUrl ?? 'http://localhost:4200',
        // Public API base, used to register the Telegram bot webhook.
        API_BASE_URL: props?.apiBaseUrl ?? '',
        // WhatsApp Cloud API. Only the ARN travels as env — the app id/secret and
        // the webhook verify token are read from the secret at runtime, so a
        // deploy can never blank them.
        WA_PLATFORM_SECRET_ARN: whatsappSecret.secretArn,
        // Per-tenant secret path prefix; the API appends `{company_id}`.
        WA_TENANT_SECRET_PREFIX: `/${stage}/automate-magic/whatsapp/tenant/`,
        // Web Push VAPID keypair for parent PWA notifications.
        PUSH_VAPID_SECRET_ARN: pushVapidSecret.secretArn,
      },
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      role: lambdaRole,
    });

    // =============================================
    // API Gateway
    // =============================================
    this.api = new apigateway.RestApi(this, 'AutomateMagicAPI', {
      restApiName: `automate-magic-api-${stage}`,
      description: 'Netrofit API Gateway',
      defaultCorsPreflightOptions: {
        // Echoing a specific origin is required because `allowCredentials: true`
        // is incompatible with `Allow-Origin: *` per CORS spec — browsers reject
        // the preflight outright. CDK echoes the request Origin when this list
        // contains explicit entries.
        // localhost:4300 is the owner's local-only admin console (netrofit-admin)
        // and localhost:4800 the local-only cards report (cards/), both of which
        // talk to the prod API via the karim-admin-secret routes — so their
        // preflights must be allowed even in prod.
        allowOrigins: stage === 'prod'
          ? ['https://app.netrofit.com', 'http://localhost:4300', 'http://localhost:4800']
          : ['http://localhost:4200', 'http://localhost:4300', 'http://localhost:4800', 'https://dev.netrofit.com'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'Accept-Language',
        ],
        allowCredentials: true,
        // Cache preflight 10 min so the 20–30 parallel calls the reports page
        // fires don't each trigger their own OPTIONS round-trip.
        maxAge: cdk.Duration.minutes(10),
      },
      deployOptions: {
        stageName: stage,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
    });

    // Lambda Integration
    const lambdaIntegration = new apigateway.LambdaIntegration(this.apiLambda, {
      proxy: true,
      allowTestInvoke: true,
    });

    // Add proxy resource to catch all requests
    const proxyResource = this.api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', lambdaIntegration);

    // Also add root path
    this.api.root.addMethod('ANY', lambdaIntegration);

    // When API Gateway itself returns an error (Lambda throttle → 5xx,
    // integration timeout → 504, default 4xx, etc.) it does NOT invoke our
    // Lambda response handler, so the response is missing CORS headers and
    // the browser masks the real status as a CORS error. Gateway responses
    // only support static values (no request-header echoing), so we use the
    // primary frontend origin for the stage.
    const gatewayOrigin = stage === 'prod' ? 'https://app.netrofit.com' : 'https://dev.netrofit.com';
    const corsErrorHeaders = {
      'Access-Control-Allow-Origin': `'${gatewayOrigin}'`,
      'Access-Control-Allow-Credentials': "'true'",
      'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept-Language'",
      'Access-Control-Allow-Methods': "'GET,POST,PUT,PATCH,DELETE,OPTIONS'",
    };
    for (const type of [
      apigateway.ResponseType.DEFAULT_4XX,
      apigateway.ResponseType.DEFAULT_5XX,
      apigateway.ResponseType.INTEGRATION_TIMEOUT,
      apigateway.ResponseType.INTEGRATION_FAILURE,
      apigateway.ResponseType.THROTTLED,
      apigateway.ResponseType.QUOTA_EXCEEDED,
    ]) {
      new apigateway.GatewayResponse(this, `GwResp-${type.responseType}`, {
        restApi: this.api,
        type,
        responseHeaders: corsErrorHeaders,
      });
    }

    // =============================================
    // Optional API Gateway Custom Domain
    // =============================================
    if (props?.apiCustomDomain) {
      const apiCert = new acm.Certificate(this, 'ApiCustomDomainCert', {
        domainName: props.apiCustomDomain,
        validation: acm.CertificateValidation.fromDns(),
      });

      const apiDomain = new apigateway.DomainName(this, 'ApiCustomDomainName', {
        domainName: props.apiCustomDomain,
        certificate: apiCert,
        endpointType: apigateway.EndpointType.REGIONAL,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
      });

      new apigateway.BasePathMapping(this, 'ApiCustomDomainBasePathMapping', {
        domainName: apiDomain,
        restApi: this.api,
        stage: this.api.deploymentStage,
      });

      new cdk.CfnOutput(this, 'ApiCustomDomain', {
        value: props.apiCustomDomain,
        description: 'Custom domain for API Gateway',
      });
      new cdk.CfnOutput(this, 'ApiCustomDomainTarget', {
        value: apiDomain.domainNameAliasDomainName,
        description: `Point ${props.apiCustomDomain} CNAME at this value.`,
      });
    }

    // =============================================
    // Outputs
    // =============================================
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${stage}-api-url`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
      exportName: `${stage}-api-id`,
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.clusterEndpoint.hostname,
      description: 'Aurora Database Cluster Endpoint',
      exportName: `${stage}-db-endpoint`,
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: dbName,
      description: 'Database Name',
      exportName: `${stage}-db-name`,
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: dbCredentialsSecret.secretArn,
      description: 'Database Credentials Secret ARN',
      exportName: `${stage}-db-secret-arn`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: this.apiLambda.functionArn,
      description: 'API Lambda Function ARN',
      exportName: `${stage}-lambda-arn`,
    });

    new cdk.CfnOutput(this, 'DatabaseClusterArn', {
      value: this.database.clusterArn,
      description: 'Aurora Cluster ARN (for Data API)',
      exportName: `${stage}-db-cluster-arn`,
    });
  }
}
