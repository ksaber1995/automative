import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
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
  /**
   * Optional Route 53 zone in which to create A/AAAA alias records pointing
   * `domainName` (and `wwwDomain`, if any) at this stack's CloudFront distro.
   * The zone itself is referenced read-only — CDK will not create or destroy it.
   *
   * Migration note: deploying with this set when the same A/AAAA records already
   * exist in the zone will fail with "record already exists". Delete the existing
   * records imperatively (or import them) before turning this on.
   */
  hostedZoneId?: string;
  /** Defaults to the last two labels of `domainName` (e.g. "netrofit.com"). */
  hostedZoneName?: string;
  /**
   * Zone-apex TXT records (SPF / DMARC). Only set this on ONE stack per zone,
   * typically the apex landing stack — otherwise CFN will conflict on duplicates.
   */
  zoneApexTxtRecords?: {
    spf?: string;     // e.g. "v=spf1 -all"
    dmarc?: string;   // e.g. "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s"
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

    // ─── Optional Route 53 alias records ────────────────────────────────────
    // Cert validation is intentionally still acm.CertificateValidation.fromDns()
    // (no zone arg) — passing a zone changes the CFN property and forces cert
    // replacement, which we want to avoid for already-issued certs.
    if (props.hostedZoneId) {
      const zoneName =
        props.hostedZoneName ?? props.domainName.split('.').slice(-2).join('.');
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: props.hostedZoneId,
        zoneName,
      });
      const aliasTarget = route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      );

      new route53.ARecord(this, 'AliasA', {
        zone,
        recordName: props.domainName,
        target: aliasTarget,
      });
      new route53.AaaaRecord(this, 'AliasAAAA', {
        zone,
        recordName: props.domainName,
        target: aliasTarget,
      });
      if (wwwDomain) {
        new route53.ARecord(this, 'WwwAliasA', {
          zone,
          recordName: wwwDomain,
          target: aliasTarget,
        });
        new route53.AaaaRecord(this, 'WwwAliasAAAA', {
          zone,
          recordName: wwwDomain,
          target: aliasTarget,
        });
      }

      if (props.zoneApexTxtRecords) {
        if (props.zoneApexTxtRecords.spf) {
          new route53.TxtRecord(this, 'ApexSpf', {
            zone,
            recordName: zoneName,
            values: [props.zoneApexTxtRecords.spf],
            ttl: cdk.Duration.hours(1),
          });
        }
        if (props.zoneApexTxtRecords.dmarc) {
          new route53.TxtRecord(this, 'ApexDmarc', {
            zone,
            recordName: `_dmarc.${zoneName}`,
            values: [props.zoneApexTxtRecords.dmarc],
            ttl: cdk.Duration.hours(1),
          });
        }
      }
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
