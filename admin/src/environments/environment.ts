/**
 * Local development (`npm start`, http://localhost:4300).
 *
 * The console is served by the Angular dev server, so the API is a different
 * origin and has to be named in full. That works because localhost:4300 is in
 * the API's CORS allowlist (`aws/lambda/api/src/index.ts` and
 * `aws/lib/core-stack.ts`).
 */
export const environment = {
  production: false,
  adminEndpoint:
    'https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret',
};
