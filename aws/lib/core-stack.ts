import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CoreStackProps extends cdk.StackProps {
  stage?: string;
  dbName?: string;
}

export class CoreStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly database: rds.DatabaseCluster;
  public readonly apiLambda: lambda.Function;

  constructor(scope: Construct, id: string, props?: CoreStackProps) {
    super(scope, id, props);

    const stage = props?.stage || 'dev';
    const dbName = props?.dbName || 'automative';

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

    // API Lambda Function
    this.apiLambda = new lambda.Function(this, 'ApiLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/api')),
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
      description: 'Automate Magic API Gateway',
      defaultCorsPreflightOptions: {
        allowOrigins: stage === 'prod'
          ? ['https://yourdomain.com'] // Replace with your production domain
          : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
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
