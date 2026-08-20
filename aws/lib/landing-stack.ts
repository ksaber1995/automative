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
   * Write the ACM validation records into `hostedZoneId` instead of leaving them
   * to be added by hand — the deploy then issues the cert on its own.
   *
   * OPT-IN, and it must stay that way. Passing the zone to
   * `CertificateValidation.fromDns` changes the CloudFormation property on the
   * certificate, which REPLACES an already-issued one. The three stacks that
   * predate this flag hold valid certs, so they must keep the zoneless call.
   * Only set this on a brand-new stack.
   */
  certValidationInZone?: boolean;
  /**
   * Zone-apex TXT records (SPF / DMARC). Only set this on ONE stack per zone,
   * typically the apex landing stack — otherwise CFN will conflict on duplicates.
   */
  zoneApexTxtRecords?: {
    spf?: string;     // e.g. "v=spf1 -all"
    dmarc?: string;   // e.g. "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s"
  };
  /**
   * 301 any request whose path starts with `prefix` to `target` + the same path
   * — e.g. netrofit.com/p/s/<token> → app.netrofit.com/p/s/<token>, for QR links
   * printed or shared against the wrong host. Handled at the edge, before the
   * SPA ever loads.
   */
  pathRedirects?: { prefix: string; target: string }[];
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

    // ─── Route 53 zone (read-only reference) ────────────────────────────────
    // Resolved before the certificate so `certValidationInZone` can hand it to
    // ACM. Importing a zone creates no resource, so the position of this call
    // changes nothing in the synthesised template.
    const zone = props.hostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.hostedZoneName ?? props.domainName.split('.').slice(-2).join('.'),
        })
      : undefined;

    // ─── ACM cert (DNS-validated; covers apex + www) ────────────────────────
    const certificate = new acm.Certificate(this, 'LandingCert', {
      domainName: props.domainName,
      subjectAlternativeNames: altDomains,
      // See certValidationInZone: adding the zone here replaces an issued cert,
      // so only a new stack may ask for it.
      validation: props.certValidationInZone && zone
        ? acm.CertificateValidation.fromDns(zone)
        : acm.CertificateValidation.fromDns(),
    });

    // SPA fallback strategy:
    //  - Without an API proxy: distribution-level errorResponses are fine (403/404 → index.html).
    //  - With an API proxy: errorResponses would also catch real API errors (e.g. 404 from
    //    /api/whatever) and replace the JSON body with the SPA shell. Use a CloudFront Function
    //    on viewer-request instead, scoped to non-/api, non-static-asset paths.
    const useFunctionFallback = !!props.apiProxy;
    const redirects = props.pathRedirects ?? [];
    // One viewer-request function per behavior is all CloudFront allows, so the
    // redirects and the SPA fallback share it. Redirects run first — a request
    // that belongs on another host must never fall through to index.html.
    const needsFunction = useFunctionFallback || redirects.length > 0;
    const spaFunction = needsFunction
      ? new cloudfront.Function(this, 'SpaFallbackFunction', {
          comment: 'Path redirects + SPA deep-link rewrite (viewer-request)',
          code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
${redirects.map((r) => `  if (uri.indexOf(${JSON.stringify(r.prefix)}) === 0) {
    return { statusCode: 301, statusDescription: 'Moved Permanently',
             headers: { location: { value: ${JSON.stringify(r.target)} + uri } } };
  }`).join('\n')}
${useFunctionFallback ? `  if (uri.indexOf('/api/') === 0) return request;
  if (uri.lastIndexOf('.') > uri.lastIndexOf('/')) return request;
  request.uri = '/index.html';` : ''}
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
    if (zone) {
      const zoneName = zone.zoneName;
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
    //
    // Two passes, because the files fall into two groups that want opposite
    // caching, and uploading them with none at all gives the browser no
    // instructions: it then guesses (heuristic freshness off Last-Modified) and
    // can sit on a stale index.html for days. CloudFront is invalidated on every
    // deploy, so this was only ever a problem on the visitor's own machine —
    // which is exactly the machine we cannot clear.
    //
    // 1. Hashed build output (main-AB12CD34.js and friends). The name changes
    //    whenever the content does, so it can be cached forever.
    const FOREVER = ['*.html', 'assets/*', 'assets/**/*'];
    const immutableAssets = new deploy.BucketDeployment(this, 'DeployLanding', {
      sources: [deploy.Source.asset(props.sourcePath)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
      // s3 sync applies these filters to the destination too, so the files the
      // second pass owns are neither uploaded nor pruned here.
      exclude: FOREVER,
      cacheControl: [
        deploy.CacheControl.setPublic(),
        deploy.CacheControl.maxAge(cdk.Duration.days(365)),
        deploy.CacheControl.immutable(),
      ],
    });

    // 2. The entry point and the runtime-loaded assets — index.html, and the
    //    i18n JSON the app fetches by a fixed name. These keep their names
    //    across releases, so a browser holding one holds the old app: index.html
    //    points at last release's bundles, and a stale en.json is last release's
    //    wording. They must be revalidated, every time. It costs one conditional
    //    request each; the answer is a 304 unless we shipped.
    const revalidated = new deploy.BucketDeployment(this, 'DeployLandingEntryPoint', {
      sources: [deploy.Source.asset(props.sourcePath)],
      destinationBucket: bucket,
      // The first pass already invalidates /*; a second one would just cost time.
      prune: false,
      exclude: ['*'],
      include: FOREVER,
      cacheControl: [
        deploy.CacheControl.setPublic(),
        deploy.CacheControl.maxAge(cdk.Duration.seconds(0)),
        deploy.CacheControl.mustRevalidate(),
      ],
    });
    // Ordered so a release is never briefly half-old: bundles land first, then
    // the index.html that names them.
    revalidated.node.addDependency(immutableAssets);

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
