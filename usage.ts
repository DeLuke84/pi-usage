import type { ParsedQuota } from "./types";
import { Unit } from "./types";

export type UsageProvider = "glm" | "codex" | "github-copilot";
export type ResetStyle = "relative" | "weekday" | "date";

export interface UsageLimitView {
  label: string;
  percentage: number;
  nextResetTime: number;
  resetStyle: ResetStyle;
}

export interface UsageSnapshot {
  provider: UsageProvider;
  label: string;
  planLabel?: string;
  limits: UsageLimitView[];
}

export function selectUsageProvider(model?: { provider?: string | null } | null): UsageProvider | null {
  if (model?.provider === "zai") return "glm";
  if (model?.provider === "openai-codex") return "codex";
  if (model?.provider === "github-copilot") return "github-copilot";
  return null;
}

export function quotaToUsageSnapshot(quota: ParsedQuota): UsageSnapshot {
  const limits: UsageLimitView[] = [];
  if (quota.fiveHour) {
    limits.push({
      label: "5h",
      percentage: quota.fiveHour.percentage,
      nextResetTime: quota.fiveHour.nextResetTime,
      resetStyle: "relative",
    });
  }
  if (quota.weekly) {
    limits.push({
      label: "week",
      percentage: quota.weekly.percentage,
      nextResetTime: quota.weekly.nextResetTime,
      resetStyle: "weekday",
    });
  }
  return { provider: "glm", label: "GLM", planLabel: quota.planLevel, limits };
}

export function resetStyleToUnit(style: ResetStyle): number {
  if (style === "weekday") return Unit.WEEKLY;
  if (style === "date") return Unit.MONTHLY;
  return Unit.FIVE_HOUR;
}
