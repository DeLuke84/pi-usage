import type { ParsedQuota } from "./types";
import { Unit } from "./types";
import type { UsageSnapshot } from "./usage";
import { quotaToUsageSnapshot, resetStyleToUnit } from "./usage";

const DAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const RESET_SYMBOL = "↻";
const SEGMENT_SEPARATOR = " · ";

export type UsageSeverity = "ok" | "warning" | "critical";

export interface UsageStatusSegment {
  text: string;
  usedPercentage: number;
  severity: UsageSeverity;
}

export function formatResetTime(timestamp: number, unit: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "now";
  const diff = timestamp - Date.now();
  if (diff <= 0) return "now";

  if (unit === Unit.FIVE_HOUR) {
    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  }

  if (unit === Unit.WEEKLY) {
    return DAY_ABBREVIATIONS[new Date(timestamp).getUTCDay()]!;
  }

  if (unit === Unit.MONTHLY) {
    const date = new Date(timestamp);
    return `${MONTH_ABBREVIATIONS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  }

  return "now";
}

export function formatQuotaStatus(quota: ParsedQuota): string {
  return formatUsageStatus(quotaToUsageSnapshot(quota));
}

export function formatUsageStatus(snapshot: UsageSnapshot): string {
  return formatUsageSegments(snapshot).map((segment) => segment.text).join(SEGMENT_SEPARATOR);
}

export function formatUsageSegments(snapshot: UsageSnapshot): UsageStatusSegment[] {
  return snapshot.limits.map((limit) => {
    const usedPercentage = clampPercentage(limit.percentage);
    const label = formatLimitLabel(limit.label);
    const resetTime = formatCompactResetTime(limit.nextResetTime, resetStyleToUnit(limit.resetStyle));
    return {
      text: `${label} ${formatPercentage(usedPercentage)}% ${RESET_SYMBOL} ${resetTime}`,
      usedPercentage,
      severity: severityForUsedPercentage(usedPercentage),
    };
  });
}

export function formatErrorState(_error: unknown): string {
  return "⚠ usage unavailable";
}

export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `pi-usage: ${message || "failed to fetch usage"}`;
}

function formatCompactResetTime(timestamp: number, unit: number): string {
  const resetTime = formatResetTime(timestamp, unit);
  if (resetTime === "now") return resetTime;
  if (unit === Unit.WEEKLY && resetTime.length > 2) return resetTime.slice(0, 2);

  const withoutZeroHours = resetTime.replace(/^0h /, "");
  const withoutZeroMinutes = withoutZeroHours.replace(/ 0m$/, "");
  return withoutZeroMinutes.replace(/h (\d+)m$/, "h$1").replace(/ /g, "");
}

function formatLimitLabel(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized === "5h") return "5h";
  if (normalized === "week" || normalized === "weekly") return "1w";
  if (normalized.startsWith("spark ")) return `s${normalized.slice("spark ".length)}`;
  if (normalized === "premium" || normalized === "premium_interactions") return "prem";
  return label.replace(/\s+/g, "");
}

function clampPercentage(percentage: number): number {
  if (!Number.isFinite(percentage)) return 0;
  return Math.max(0, Math.min(100, percentage));
}

// Provider APIs derive percentages via float subtraction (e.g. 100 - 93.8),
// which can yield values like 6.200000000000003. Round to one decimal place
// for display and drop it entirely when the result is a whole number.
function formatPercentage(percentage: number): string {
  const rounded = Math.round(percentage * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function severityForUsedPercentage(usedPercentage: number): UsageSeverity {
  if (usedPercentage >= 90) return "critical";
  if (usedPercentage >= 75) return "warning";
  return "ok";
}
