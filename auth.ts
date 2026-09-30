import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_AUTH_PATH = ".pi/agent/auth.json";

interface AuthConfig {
  zai: { key: string };
  "openai-codex": CodexAuthConfig;
  "github-copilot": GitHubCopilotAuthConfig;
  "xiaomi-token-plan-ams": TokenPlanAuthConfig;
}

export interface TokenPlanAuthConfig {
  cookie?: string;
}

export interface CodexAuthConfig {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export interface GitHubCopilotAuthConfig {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  enterpriseUrl?: string;
}

export function getAuthFilePath(): string {
  const authDir = process.env.PI_AUTH_DIR;
  return authDir ? path.join(authDir, "auth.json") : path.join(os.homedir(), DEFAULT_AUTH_PATH);
}

export function getApiKey(): string {
  const authFilePath = getAuthFilePath();
  try {
    const apiKey = readAuthConfig().zai?.key;
    if (!apiKey) throw new Error("zai.key not found in auth.json");
    return apiKey;
  } catch (error) {
    throw authError(error, authFilePath, "API key");
  }
}

export function getCodexAuth(): CodexAuthConfig {
  const authFilePath = getAuthFilePath();
  try {
    const codex = readAuthConfig()["openai-codex"];
    if (!codex?.access || !codex.refresh || typeof codex.expires !== "number" || !codex.accountId) {
      throw new Error("openai-codex OAuth credentials not found in auth.json");
    }
    return codex;
  } catch (error) {
    throw authError(error, authFilePath, "Codex auth");
  }
}

export function getGitHubCopilotAuth(): GitHubCopilotAuthConfig {
  const authFilePath = getAuthFilePath();
  try {
    const copilot = readAuthConfig()["github-copilot"];
    if (!copilot?.access || !copilot.refresh || typeof copilot.expires !== "number") {
      throw new Error("github-copilot OAuth credentials not found in auth.json");
    }
    return copilot;
  } catch (error) {
    throw authError(error, authFilePath, "GitHub Copilot auth");
  }
}

export function getTokenPlanCookie(): string {
  const envCookie = process.env.PI_USAGE_TOKEN_PLAN_COOKIE;
  if (envCookie?.trim()) return envCookie.trim();
  const authFilePath = getAuthFilePath();
  try {
    const cookie = readAuthConfig()["xiaomi-token-plan-ams"]?.cookie;
    if (!cookie) throw new Error("xiaomi-token-plan-ams.cookie not found in auth.json");
    return cookie;
  } catch (error) {
    throw authError(error, authFilePath, "Token Plan session cookie");
  }
}

function readAuthConfig(): Partial<AuthConfig> {
  return JSON.parse(fs.readFileSync(getAuthFilePath(), "utf-8")) as Partial<AuthConfig>;
}

function authError(error: unknown, authFilePath: string, label: string): Error {
  if (error instanceof Error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Error(`Auth file not found at ${authFilePath}. Please ensure you've configured your z.ai API key in pi.`);
    }
    return new Error(`Failed to read ${label}: ${error.message}`);
  }
  return new Error(`Failed to read ${label}: unknown error`);
}
