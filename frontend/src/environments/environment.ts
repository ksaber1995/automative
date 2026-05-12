export const environment = {
  production: false,
  apiUrl: 'https://nrmh90r9h6.execute-api.eu-west-1.amazonaws.com/dev/api',
  jwtTokenKey: 'automate_magic_token',
  refreshTokenKey: 'automate_magic_refresh_token',
  userDataKey: 'automate_magic_user_data',
  // Google reCAPTCHA v3 site key (public). Leave '' to disable client-side
  // execution — the backend will also skip verification when its secret is unset.
  recaptchaSiteKey: '6LcwMOYsAAAAAKUaPQtzky_TfXXekd_1JW3w56Bp',
};
