import type { ResetStyle, UsageLimitView, UsageSnapshot } from "./usage";

const REQUEST_TIMEOUT_MS = 5000;
const COPILOT_API_VERSION = "2025-05-01";

export interface GitHubCopilotAuth {
  access: string;
  refresh: string;
  expires: number;
  enterpriseUrl?: string;
}

interface CopilotUserResponse {
  access_type_sku?: string;
  copilot_plan?: string;
  quota_snapshots?: {
    chat?: QuotaSnapshotResponse;
    completions?: QuotaSnapshotResponse;
    premium_interactions?: QuotaSnapshotResponse;
  };
  quota_reset_date_utc?: string;
  quota_reset_date?: string;
}

interface QuotaSnapshotResponse {
  remaining?: number;
  entitlement?: number;
  percent_remaining?: number;
  unlimited?: boolean;
}

interface WindowHeader {
  entitlement: number;
  percentRemaining: number;
  percentUsed: number;
  resetsAt?: string;
}

export async function fetchGitHubCopilotUsage(auth: GitHubCopilotAuth): Promise<UsageSnapshot> {
  // Prefer the read-only user endpoint. The chat probe below spends a tiny request,
  // so it is intentionally only a fallback for setups where /copilot_internal/user
  // is unavailable or does not contain quota snapshots.
  let userError: unknown;
  try {
    const user = await fetchCopilotUserSnapshot(auth);
    if (user.limits.length > 0) {
      return {
        provider: "github-copilot",
        label: "Copilot",
        planLabel: user.planLabel,
        limits: user.limits,
      };
    }
  } catch (error) {
    userError = error;
  }

  try {
    const probe = await probeCopilotChat(auth);
    if (probe.limits.length > 0) {
      return {
        provider: "github-copilot",
        label: "Copilot",
        planLabel: probe.planLabel,
        limits: probe.limits,
      };
    }
  } catch (probeError) {
    throw new Error(`GitHub Copilot usage unavailable: ${probeError instanceof Error ? probeError.message : String(probeError)}`);
  }

  throw new Error(`GitHub Copilot usage response missing quota data${userError instanceof Error ? `: ${userError.message}` : ""}`);
}

async function fetchCopilotUserSnapshot(auth: GitHubCopilotAuth): Promise<Pick<UsageSnapshot, "planLabel" | "limits">> {
  if (!auth.refresh) throw new Error("github-copilot.refresh not found in auth.json");

  const url = getCopilotUserUrl(auth.enterpriseUrl);
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.refresh}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`Copilot user HTTP ${response.status}`);

  const data = (await response.json()) as CopilotUserResponse;
  const reset = parseResetTime(data.quota_reset_date_utc ?? data.quota_reset_date);
  const limits: UsageLimitView[] = [];

  // GitHub exposes this quota with a monthly reset date. It is a 30-day
  // premium-interactions window, not a generic "premium" counter.
  const premium = quotaToLimit("30d", data.quota_snapshots?.premium_interactions, reset, "date");
  if (premium) limits.push(premium);

  return {
    planLabel: data.copilot_plan ?? data.access_type_sku,
    limits,
  };
}

async function probeCopilotChat(auth: GitHubCopilotAuth): Promise<Pick<UsageSnapshot, "planLabel" | "limits">> {
  if (!auth.access) throw new Error("github-copilot.access not found in auth.json");

  const response = await fetchWithTimeout(`${getCopilotApiBase(auth)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.access}`,
      "Content-Type": "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": "vscode/1.95.0",
      "Editor-Plugin-Version": "copilot-chat/0.48.1",
      "X-GitHub-Api-Version": COPILOT_API_VERSION,
      "X-Interaction-Id": crypto.randomUUID(),
      "X-Initiator": "user",
      "OpenAI-Intent": "conversation-panel",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "." }],
      max_tokens: 1,
      stream: false,
    }),
  });

  if (response.status === 429) {
    const retryAfter = numberValue(response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-user-retry-after"));
    const exceeded = response.headers.get("x-ratelimit-exceeded") ?? "";
    const label = exceeded.includes("weekly") ? "week" : "5h";
    return {
      limits: [{
        label,
        percentage: 100,
        nextResetTime: retryAfter ? Date.now() + retryAfter * 1000 : Date.now(),
        resetStyle: label === "week" ? "weekday" : "relative",
      }],
    };
  }

  if (!response.ok) throw new Error(`Copilot probe HTTP ${response.status}`);

  const limits: UsageLimitView[] = [];
  const session = parseWindowHeader(response.headers.get("x-usage-ratelimit-session"));
  if (session) limits.push(windowToLimit("5h", session, "relative"));

  const weekly = parseWindowHeader(response.headers.get("x-usage-ratelimit-weekly"));
  if (weekly) limits.push(windowToLimit("week", weekly, "weekday"));

  // Enterprise Copilot often exposes the monthly premium quota only on probe headers.
  const premium = parseWindowHeader(response.headers.get("x-quota-snapshot-premium_interactions"));
  if (premium) limits.push(windowToLimit("30d", premium, "date"));

  // Consume body so the connection can be reused; ignore parse errors/content.
  await response.arrayBuffer().catch(() => undefined);
  return { limits };
}

function getCopilotUserUrl(enterpriseUrl?: string): string {
  const domain = normalizeDomain(enterpriseUrl);
  if (domain) return `https://${domain}/api/v3/copilot_internal/user`;
  return "https://api.github.com/copilot_internal/user";
}

function getCopilotApiBase(auth: GitHubCopilotAuth): string {
  const enterpriseDomain = normalizeDomain(auth.enterpriseUrl);
  if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`;

  const proxyHost = auth.access.match(/proxy-ep=([^;]+)/)?.[1];
  if (proxyHost) return `https://${proxyHost.replace(/^proxy\./, "api.")}`;

  return "https://api.individual.githubcopilot.com";
}

function normalizeDomain(input?: string): string | null {
  if (!input) return null;
  try {
    const url = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return url.hostname;
  } catch {
    return null;
  }
}

function quotaToLimit(label: string, quota: QuotaSnapshotResponse | undefined, reset: number | null, resetStyle: ResetStyle): UsageLimitView | null {
  if (!quota || quota.unlimited) return null;
  const remaining = numberValue(quota.percent_remaining);
  if (remaining === null) return null;
  return {
    label,
    percentage: Math.max(0, 100 - remaining),
    nextResetTime: reset ?? Date.now(),
    resetStyle,
  };
}

function windowToLimit(label: string, header: WindowHeader, resetStyle: ResetStyle): UsageLimitView {
  return {
    label,
    percentage: header.percentUsed,
    nextResetTime: parseResetTime(header.resetsAt) ?? Date.now(),
    resetStyle,
  };
}

function parseWindowHeader(raw: string | null): WindowHeader | null {
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const entitlement = numberValue(params.get("ent")) ?? 0;
  const percentRemaining = numberValue(params.get("rem"));
  if (percentRemaining === null) return null;
  return {
    entitlement,
    percentRemaining,
    percentUsed: Math.max(0, 100 - percentRemaining),
    resetsAt: params.get("rst") ?? undefined,
  };
}

function parseResetTime(value?: string | number): number | null {
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
