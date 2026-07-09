import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
        retention: cdk.Duration.days(7),
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

    // =============================================
    // Offline desktop auto-update artifact bucket
    // =============================================
    // Public-read hosting for the electron-updater feed artifacts (installer +
    // blockmap) under the `updates/` prefix. The installers are the same public
    // binaries we hand to customers, so public GET on that prefix is fine; the
    // gating decision (who gets which version) is made by the Lambda feed, not
    // by hiding the files. The API Lambda only ever serves the tiny generated
    // latest.yml and 302-redirects the binary download here.
    const updatesBucket = new s3.Bucket(this, 'DesktopUpdatesBucket', {
      bucketName: `${this.account}-netrofit-desktop-updates-${stage}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    updatesBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'PublicReadDesktopUpdates',
        actions: ['s3:GetObject'],
        resources: [updatesBucket.arnForObjects('updates/*')],
        principals: [new iam.AnyPrincipal()],
      })
    );
    const updateArtifactBaseUrl = `https://${updatesBucket.bucketRegionalDomainName}/updates`;
    new cdk.CfnOutput(this, 'DesktopUpdatesBucketName', { value: updatesBucket.bucketName });
    new cdk.CfnOutput(this, 'DesktopUpdatesBaseUrl', { value: updateArtifactBaseUrl });

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
        // ed25519 private key (PEM, pkcs8) used to sign offline desktop license
        // tokens. Set via env at deploy; the matching public key is embedded in
        // the Electron app. Without it, /api/public/license/validate returns 500.
        LICENSE_SIGNING_KEY: process.env.LICENSE_SIGNING_KEY ?? '',
        // Base URL the desktop update feed 302-redirects binary downloads to.
        // Points at the public `updates/` prefix of the bucket above.
        UPDATE_ARTIFACT_BASE_URL: updateArtifactBaseUrl,
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
        // localhost:4300 is the owner's local-only admin console (netrofit-admin),
        // which talks to the prod API via the karim-admin-secret routes — so its
        // POST/DELETE preflights must be allowed even in prod.
        allowOrigins: stage === 'prod'
          ? ['https://app.netrofit.com', 'http://localhost:4300']
          : ['http://localhost:4200', 'http://localhost:4300', 'https://dev.netrofit.com'],
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
