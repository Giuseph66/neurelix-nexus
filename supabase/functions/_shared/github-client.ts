// Shared GitHub client utilities for Edge Functions

import { createAppAuth } from "https://esm.sh/@octokit/auth-app@6.0.1";
import { Octokit } from "https://esm.sh/@octokit/rest@20.0.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface GitHubClientConfig {
  connectionId: string;
  installationId?: string;
}

/**
 * Retrieves GitHub App credentials from Supabase Vault
 */
async function getGitHubAppCredentials(): Promise<{
  appId: string;
  privateKey: string;
}> {
  // In production, fetch from Supabase Vault
  // For now, use environment variables
  const appId = Deno.env.get("GITHUB_APP_ID");
  const privateKey = Deno.env.get("GITHUB_PRIVATE_KEY");

  if (!appId || !privateKey) {
    throw new Error("GitHub App credentials not configured");
  }

  return { appId, privateKey };
}

/**
 * Gets installation token from Vault or generates new one
 */
async function getInstallationToken(installationId: string): Promise<string> {
  // Try to get from Vault first (cached token)
  const vaultKey = `github_installation_${installationId}`;
  
  // For now, generate new token via GitHub App
  const { appId, privateKey } = await getGitHubAppCredentials();
  
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId: parseInt(installationId),
  });

  const { token } = await auth({ type: "installation" });
  return token;
}

/**
 * Creates an authenticated Octokit client for a GitHub connection
 */
export async function getGitHubClient(
  config: GitHubClientConfig
): Promise<Octokit> {
  const { installationId } = config;

  if (!installationId) {
    throw new Error("Installation ID required for GitHub App");
  }

  const token = await getInstallationToken(installationId);

  return new Octokit({
    auth: token,
  });
}

/**
 * Creates an Octokit client for GitHub App authentication (without installation)
 */
export async function getGitHubAppClient(): Promise<Octokit> {
  const { appId, privateKey } = await getGitHubAppCredentials();

  const auth = createAppAuth({
    appId,
    privateKey,
  });

  const { token } = await auth({ type: "app" });

  return new Octokit({
    auth: token,
  });
}

/**
 * Rate limit helper with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if it's a rate limit error
      if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: number }).status;
        if (status === 403 || status === 429) {
          // Rate limited, wait and retry
          await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
          continue;
        }
      }

      // For other errors, throw immediately
      throw lastError;
    }
  }

  throw lastError || new Error("Max retries exceeded");
}


