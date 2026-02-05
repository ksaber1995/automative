import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

// Cache for secrets to avoid repeated API calls
const secretsCache: Record<string, any> = {};

export async function getSecret(secretArn: string): Promise<any> {
  if (secretsCache[secretArn]) {
    return secretsCache[secretArn];
  }

  try {
    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const response = await client.send(command);

    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString);
      secretsCache[secretArn] = secret;
      return secret;
    }

    throw new Error('Secret not found');
  } catch (error) {
    console.error('Error fetching secret:', error);
    throw error;
  }
}

export async function getDBCredentials(): Promise<{ username: string; password: string }> {
  const secretArn = process.env.DB_CREDENTIALS_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DB_CREDENTIALS_SECRET_ARN not set');
  }
  return await getSecret(secretArn);
}

export async function getJWTSecret(): Promise<string> {
  const secretArn = process.env.JWT_SECRET_ARN;
  if (!secretArn) {
    throw new Error('JWT_SECRET_ARN not set');
  }
  const secret = await getSecret(secretArn);
  return secret.secret;
}

export async function getJWTRefreshSecret(): Promise<string> {
  const secretArn = process.env.JWT_REFRESH_SECRET_ARN;
  if (!secretArn) {
    throw new Error('JWT_REFRESH_SECRET_ARN not set');
  }
  const secret = await getSecret(secretArn);
  return secret.secret;
}
