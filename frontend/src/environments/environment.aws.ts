// AWS Environment Configuration
// Replace the API URL below with your actual API Gateway URL from the CDK deployment outputs
//
// To get your API URL:
// 1. Deploy the AWS stack: cd aws && npm run deploy
// 2. Look for the "ApiUrl" output in the deployment results
// 3. Replace the placeholder URL below with your actual API Gateway URL
//
// Example: https://abc123xyz.execute-api.eu-west-1.amazonaws.com/dev

export const environment = {
  production: true,
  // IMPORTANT: Replace this URL with your actual API Gateway URL after deployment
  apiUrl: 'https://YOUR-API-ID.execute-api.eu-west-1.amazonaws.com/dev/api',
  jwtTokenKey: 'automate_magic_token',
  refreshTokenKey: 'automate_magic_refresh_token',
  userDataKey: 'automate_magic_user_data',
};
