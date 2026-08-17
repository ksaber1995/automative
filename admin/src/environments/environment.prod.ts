/**
 * Deployed at https://dione.netrofit.com.
 *
 * A RELATIVE path, because CloudFront forwards `/api/*` on that host straight to
 * the API Gateway origin (see the apiProxy on NetrofitAdminStack-prod in
 * aws/bin/core.ts). Two things fall out of that, both wanted:
 *
 *  - No CORS. The browser sees one origin, so no preflight and nothing to add to
 *    the API's allowlist.
 *  - The API's execute-api hostname never appears in the shipped bundle.
 *
 * Same arrangement app.netrofit.com uses for the customer app.
 */
export const environment = {
  production: true,
  adminEndpoint: '/api/karim-admin-secret',
};
