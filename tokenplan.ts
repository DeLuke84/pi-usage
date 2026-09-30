import type { ResetStyle, UsageLimitView, UsageSnapshot } from "./usage";

const API_BASE_URL = "https://platform.xiaomimimo.com/api/v1";
const REQUEST_TIMEOUT_MS = 5000;

export interface TokenPlanAuth {
  cookie: string;
}

const ITEM_LABELS: Record<string, string> = {
  month_total_token: "month",
  plan_total_token: "plan",
  compensation_total_token: "comp",
};

/**
 * Parse the platform's `tokenPlan/detail` and `tokenPlan/usage` responses into
 * the shared usage snapshot shape. The platform reports `percent` fields as
 * 0..1 ratios, so percentages are derived from `used`/`limit` instead. The
 * monthly window (`monthUsage`) mirrors the plan quota and is not shown.
 */
export function parseTokenPlanResponses(detail: unknown, usage: unknown): UsageSnapshot {
  assertOkCode(detail, "detail");
  assertOkCode(usage, "usage");

  const detailData = asRecord(asRecord(detail).data);
  const usageData = asRecord(asRecord(usage).data);
  const nextResetTime = parsePeriodEnd(detailData.currentPeriodEnd);

  const limits = parseUsageItems(asRecord(usageData.usage).items, nextResetTime);
  if (limits.length === 0) throw new Error("Token Plan usage response missing quota windows");

  return { provider: "token-plan", label: "Token Plan", limits };
}

export async function fetchTokenPlanUsage(auth: TokenPlanAuth): Promise<UsageSnapshot> {
  const userId = cookieValue(auth.cookie, "userId");
  if (!userId) throw new Error("Token Plan session cookie is missing userId");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Mirrors the platform console's request shape: the userId rides along as a
    // query parameter on GET requests.
    const headers = {
      accept: "application/json",
      cookie: auth.cookie,
      "accept-language": "en",
      "x-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const query = `?userId=${encodeURIComponent(userId)}`;
    const [detailResponse, usageResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/tokenPlan/detail${query}`, { signal: controller.signal, headers }),
      fetch(`${API_BASE_URL}/tokenPlan/usage${query}`, { signal: controller.signal, headers }),
    ]);
    if (detailResponse.status === 401 || usageResponse.status === 401) {
      throw new Error("Token Plan session expired; refresh the platform.xiaomimimo.com session cookie");
    }
    if (!detailResponse.ok) throw new Error(`Token Plan detail HTTP ${detailResponse.status}`);
    if (!usageResponse.ok) throw new Error(`Token Plan usage HTTP ${usageResponse.status}`);
    return parseTokenPlanResponses(await detailResponse.json(), await usageResponse.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseUsageItems(items: unknown, nextResetTime: number): UsageLimitView[] {
  if (!Array.isArray(items)) return [];
  const limits: UsageLimitView[] = [];
  for (const item of items) {
    const record = asRecord(item);
    const name = stringValue(record.name);
    const used = numberValue(record.used);
    const limit = numberValue(record.limit);
    if (!name || used === undefined || !limit || limit <= 0) continue;
    limits.push({
      label: ITEM_LABELS[name] ?? name.replace(/_total_token$/, ""),
      percentage: (used / limit) * 100,
      nextResetTime,
      resetStyle: "date" satisfies ResetStyle,
    });
  }
  return limits;
}

// The platform reports period ends as wall-clock strings without a zone.
// Reading them as UTC keeps the provider's own calendar date stable in the
// display (`Oct23`) regardless of the local timezone.
function parsePeriodEnd(value: unknown): number {
  const text = stringValue(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text ?? "");
  if (!match) throw new Error("Token Plan detail response missing currentPeriodEnd");
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function assertOkCode(response: unknown, label: string): void {
  const root = asRecord(response);
  const code = numberValue(root.code);
  if (code !== undefined && code !== 0) {
    throw new Error(`Token Plan ${label} error ${code}: ${stringValue(root.message) ?? "unknown error"}`);
  }
}

function cookieValue(cookie: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie);
  return match?.[1];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
