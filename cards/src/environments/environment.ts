export const environment = {
  /**
   * Live, unauthenticated owner endpoint — the same one the admin console uses.
   * The obscure path is the only gate; it returns aggregate numbers plus company
   * names. CORS is locked to an allowlist, so this app must be served on
   * http://localhost:4800 (see README).
   */
  adminEndpoint:
    'https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret',

  /** How many per-client card-pool requests to have in flight at once. */
  poolConcurrency: 6,
};
