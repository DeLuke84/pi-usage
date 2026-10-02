import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readTokenPlanBrowserCookie } from "./browser-cookies";
import type { TokenPlanAuth } from "./tokenplan";

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

export function getTokenPlanCookie(
  readBrowserCookie: () => string | undefined = readTokenPlanBrowserCookie,
): TokenPlanAuth {
  const envCookie = process.env.PI_USAGE_TOKEN_PLAN_COOKIE;
  if (envCookie?.trim()) return { cookie: envCookie.trim(), source: "env" };

  // The platform rotates session cookies frequently, so the live browser
  // cookie is the primary source and the stored cookie only a fallback.
  const browserCookie = readBrowserCookie();
  if (browserCookie) {
    keepStoredCookieFresh(browserCookie);
    return { cookie: browserCookie, source: "browser" };
  }

  const authFilePath = getAuthFilePath();
  try {
    const cookie = readAuthConfig()["xiaomi-token-plan-ams"]?.cookie;
    if (!cookie) {
      throw new Error(
        "no platform.xiaomimimo.com session cookie found; open the MiMo platform once in your browser so the console re-issues its session cookie, or set PI_USAGE_TOKEN_PLAN_COOKIE",
      );
    }
    return { cookie, source: "stored" };
  } catch (error) {
    throw authError(error, authFilePath, "Token Plan session cookie");
  }
}

/**
 * Keep the stored `xiaomi-token-plan-ams.cookie` fallback in sync with the
 * live browser cookie so it cannot rot into a permanent false "expired"
 * session. Only an already stored cookie is refreshed; the fallback itself
 * stays opt-in and a missing auth file is not an error here.
 */
function keepStoredCookieFresh(cookie: string): void {
  const authFilePath = getAuthFilePath();
  try {
    const config = readAuthConfig();
    const stored = config["xiaomi-token-plan-ams"]?.cookie;
    if (!stored || stored === cookie) return;
    const next: Partial<AuthConfig> = {
      ...config,
      "xiaomi-token-plan-ams": { ...config["xiaomi-token-plan-ams"], cookie },
    };
    fs.writeFileSync(authFilePath, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(
        "[pi-usage] could not refresh the stored Token Plan cookie:",
        error instanceof Error ? error.message : error,
      );
    }
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
