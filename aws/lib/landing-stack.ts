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
  domainName: string;            // e.g. "netrofit.com"
  wwwDomain?: string | null;     // default "www.<domainName>"; pass null to skip the www SAN
  sourcePath: string;            // absolute path to built static files
  /**
   * Optional same-origin API proxy. When set, CloudFront adds a behavior so
   * `<domainName>/<pathPattern>` is forwarded to the given origin domain — letting
   * the frontend call relative URLs (`/api/...`) without exposing the API host.
   */
  apiProxy?: {
    originDomain: string;        // e.g. "prod.api.netrofit.net"
    pathPattern?: string;        // default "/api/*"
    originPath?: string;         // optional origin path prefix (e.g. "/prod" for raw execute-api)
  };
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

    const wwwDomain =
      props.wwwDomain === null
        ? undefined
        : (props.wwwDomain ?? `www.${props.domainName}`);
    const altDomains = wwwDomain ? [wwwDomain] : [];

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
      subjectAlternativeNames: altDomains,
      validation: acm.CertificateValidation.fromDns(),
    });

    // SPA fallback strategy:
    //  - Without an API proxy: distribution-level errorResponses are fine (403/404 → index.html).
    //  - With an API proxy: errorResponses would also catch real API errors (e.g. 404 from
    //    /api/whatever) and replace the JSON body with the SPA shell. Use a CloudFront Function
    //    on viewer-request instead, scoped to non-/api, non-static-asset paths.
    const useFunctionFallback = !!props.apiProxy;
    const spaFunction = useFunctionFallback
      ? new cloudfront.Function(this, 'SpaFallbackFunction', {
          comment: 'Rewrite SPA deep-links to /index.html, leave /api/* and asset paths alone',
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('/api/') === 0) return request;
  if (uri.lastIndexOf('.') > uri.lastIndexOf('/')) return request;
  request.uri = '/index.html';
  return request;
}
          `.trim()),
        })
      : undefined;

    // ─── CloudFront distribution ────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'LandingDistribution', {
      defaultRootObject: 'index.html',
      domainNames: [props.domainName, ...altDomains],
      certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: spaFunction
          ? [{ function: spaFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }]
          : undefined,
      },
      // SPA fallback so deep-links resolve to index.html (only when not using a CFF).
      errorResponses: useFunctionFallback
        ? undefined
        : [
            { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
            { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
          ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // ─── Optional same-origin API proxy ─────────────────────────────────────
    if (props.apiProxy) {
      const apiOrigin = new origins.HttpOrigin(props.apiProxy.originDomain, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        originPath: props.apiProxy.originPath,
      });
      distribution.addBehavior(props.apiProxy.pathPattern ?? '/api/*', apiOrigin, {
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      });
    }

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
