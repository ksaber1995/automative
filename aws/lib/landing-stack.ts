import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface LandingStackProps extends cdk.StackProps {
  domainName: string;       // e.g. "netrofit.com"
  wwwDomain?: string;       // default "www.<domainName>"
  sourcePath: string;       // absolute path to built static files
}

/**
 * Landing-page hosting: private S3 bucket + CloudFront (with custom domain) + ACM cert.
 *
 * Must be deployed to us-east-1 (ACM certs attached to CloudFront live there).
 * The ACM cert uses DNS validation; first deploy will pause until you add the
 * validation CNAMEs returned in the stack outputs to your registrar.
 */
export class LandingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LandingStackProps) {
    super(scope, id, props);

    const wwwDomain = props.wwwDomain ?? `www.${props.domainName}`;

    // ─── S3 bucket (private; OAC-only access) ───────────────────────────────
    const bucket = new s3.Bucket(this, 'LandingBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // ─── ACM cert (DNS-validated; covers apex + www) ────────────────────────
    const certificate = new acm.Certificate(this, 'LandingCert', {
      domainName: props.domainName,
      subjectAlternativeNames: [wwwDomain],
      validation: acm.CertificateValidation.fromDns(),
    });

    // ─── CloudFront distribution ────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'LandingDistribution', {
      defaultRootObject: 'index.html',
      domainNames: [props.domainName, wwwDomain],
      certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      // SPA fallback so deep-links resolve to index.html.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // ─── Upload built assets ────────────────────────────────────────────────
    new deploy.BucketDeployment(this, 'DeployLanding', {
      sources: [deploy.Source.asset(props.sourcePath)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // ─── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'Point your apex/www DNS records here (CNAME or ALIAS).',
    });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'CertificateArn', { value: certificate.certificateArn });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}
