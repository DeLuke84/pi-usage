import type { ResetStyle, UsageSnapshot } from "./usage";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 5000;

interface CodexAuth {
  access: string;
  accountId?: string;
}

export function parseCodexUsageResponse(data: unknown, now = Date.now()): UsageSnapshot {
  const root = asRecord(data);
  const rateLimit = asRecord(root.rate_limit ?? root);
  const limits = [
    parseWindow("5h", asRecord(rateLimit.primary_window), now, "relative"),
    parseWindow("week", asRecord(rateLimit.secondary_window), now, "weekday"),
    ...parseSparkLimits(root, now),
  ].filter((limit) => limit !== null);
  if (limits.length === 0) throw new Error("Codex usage response missing quota windows");

  const planLabel = stringValue(
    root.plan_type ?? asRecord(root.account).plan_type ?? asRecord(root.subscription).plan_type,
  );

  return {
    provider: "codex",
    label: "Codex",
    ...(planLabel ? { planLabel } : {}),
    limits,
  };
}

export async function fetchCodexUsage(auth: CodexAuth): Promise<UsageSnapshot> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(USAGE_URL, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${auth.access}`,
        referer: "https://chatgpt.com/codex/settings/usage",
        "x-openai-target-path": "/backend-api/wham/usage",
        ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
      },
    });
    if (!response.ok) throw new Error(`Codex usage HTTP ${response.status}`);
    return parseCodexUsageResponse(await response.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseSparkLimits(root: Record<string, unknown>, now: number) {
  const spark = Object.values(asRecord(root.additional_rate_limits)).find((value) =>
    stringValue(asRecord(value).limit_name)?.toLowerCase().includes("spark") === true,
  );
  if (!spark) return [];

  const rateLimit = asRecord(asRecord(spark).rate_limit);
  const primary = parseWindow("spark 5h", asRecord(rateLimit.primary_window), now, "relative");
  const secondary = parseWindow("spark week", asRecord(rateLimit.secondary_window), now, "weekday");
  return primary && secondary ? [primary, secondary] : [];
}

function parseWindow(fallbackLabel: string, value: Record<string, unknown>, now: number, fallbackResetStyle: ResetStyle) {
  const percentage = numberValue(value.used_percent);
  const nextResetTime = resetTime(value, now);
  if (percentage === null || nextResetTime === null) return null;

  const presentation = presentationForWindow(
    fallbackLabel,
    numberValue(value.limit_window_seconds),
    fallbackResetStyle,
  );
  return { label: presentation.label, percentage, nextResetTime, resetStyle: presentation.resetStyle };
}

/**
 * Codex exposes the duration of each quota window. Primary and secondary are
 * transport positions, not stable product concepts: subscription accounts use
 * 5-hour/weekly windows while the Free plan currently returns a 30-day primary
 * window. Derive the display from that duration and retain the old labels only
 * when the endpoint omits it.
 */
function presentationForWindow(
  fallbackLabel: string,
  durationSeconds: number | null,
  fallbackResetStyle: ResetStyle,
): { label: string; resetStyle: ResetStyle } {
  if (durationSeconds === null || durationSeconds <= 0) {
    return { label: fallbackLabel, resetStyle: fallbackResetStyle };
  }

  const hour = 60 * 60;
  const day = 24 * hour;
  const prefix = fallbackLabel.startsWith("spark ") ? "spark " : "";

  if (durationSeconds >= 27 * day) {
    return { label: `${prefix}${Math.round(durationSeconds / day)}d`, resetStyle: "date" };
  }
  if (durationSeconds >= 6 * day) {
    return { label: `${prefix}1w`, resetStyle: "weekday" };
  }
  if (durationSeconds >= day) {
    return { label: `${prefix}${Math.round(durationSeconds / day)}d`, resetStyle: "date" };
  }

  return { label: `${prefix}${Math.max(1, Math.round(durationSeconds / hour))}h`, resetStyle: "relative" };
}

function resetTime(value: Record<string, unknown>, now: number): number | null {
  const resetAt = value.reset_at;
  if (typeof resetAt === "string") {
    const parsed = Date.parse(resetAt);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof resetAt === "number") return resetAt < 10_000_000_000 ? resetAt * 1000 : resetAt;
  const seconds = numberValue(value.reset_after_seconds);
  return seconds === null ? null : now + seconds * 1000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
