import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UsageProvider, UsageSnapshot } from "./usage";
import { createPeriodicRefresh } from "./timer";
import { fetchQuota } from "./api";
import { fetchCodexUsage } from "./codex";
import { fetchGitHubCopilotUsage } from "./copilot";
import { fetchTokenPlanUsage } from "./tokenplan";
import { formatErrorMessage, formatErrorState, formatUsageSegments, formatUsageStatus } from "./format";
import { getApiKey, getCodexAuth, getGitHubCopilotAuth, getTokenPlanCookie } from "./auth";
import { quotaToUsageSnapshot, selectUsageProvider } from "./usage";

const STATUS_ID = "pi-usage";
const OLD_STATUS_ID = "glm-usage";

type PiTheme = {
  bg?: (color: string, text: string) => string;
  fg?: (color: string, text: string) => string;
};

type PiContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1] & {
  model?: { provider?: string };
  modelRegistry?: { getApiKeyForProvider?: (provider: string) => Promise<string | undefined> };
  ui: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]["ui"] & { theme?: PiTheme };
};

export default function (pi: ExtensionAPI): void {
  let currentCtx: PiContext | null = null;
  let lastSnapshot: UsageSnapshot | null = null;
  let refreshSeq = 0;

  function showStatus(text: string | undefined, dim?: boolean): void {
    currentCtx?.ui.setWidget(STATUS_ID, undefined);
    currentCtx?.ui.setStatus(STATUS_ID, text && dim ? `◌ ${text}` : text);
  }

  function showSnapshotStatus(snapshot: UsageSnapshot, dim?: boolean): void {
    showStatus(formatThemedUsageStatus(snapshot), dim);
  }

  function formatThemedUsageStatus(snapshot: UsageSnapshot): string {
    const segments = formatUsageSegments(snapshot);
    const theme = currentCtx?.ui.theme;
    if (!theme.fg) return segments.map((segment) => segment.text).join(" · ");

    return segments
      .map((segment) => theme.fg(colorForSeverity(segment.severity).foreground, segment.text))
      .join(theme.fg("muted", " · "));
  }

  async function fetchActiveUsage(provider: UsageProvider, ctx: PiContext): Promise<UsageSnapshot> {
    if (provider === "glm") return quotaToUsageSnapshot(await fetchQuota(getApiKey()));

    if (provider === "token-plan") return fetchTokenPlanUsage(getTokenPlanCookie());

    if (provider === "github-copilot") {
      const stored = getGitHubCopilotAuth();
      const refreshed = await ctx.modelRegistry?.getApiKeyForProvider?.("github-copilot");
      return fetchGitHubCopilotUsage({ ...stored, access: refreshed ?? stored.access });
    }

    const stored = getCodexAuth();
    const refreshed = await ctx.modelRegistry?.getApiKeyForProvider?.("openai-codex");
    return fetchCodexUsage({ ...stored, access: refreshed ?? stored.access });
  }

  async function refreshUsage(ctx: PiContext, dim?: boolean): Promise<void> {
    currentCtx = ctx;
    const seq = ++refreshSeq;
    const provider = selectUsageProvider(ctx.model);
    if (!provider) return showStatus(undefined);

    const stillCurrent = () => seq === refreshSeq && selectUsageProvider(currentCtx?.model) === provider;
    try {
      const snapshot = await fetchActiveUsage(provider, ctx);
      if (!stillCurrent()) return;
      lastSnapshot = snapshot;
      showSnapshotStatus(snapshot, dim);
    } catch (error) {
      if (!stillCurrent()) return;
      currentCtx?.ui.notify(formatErrorMessage(error), "error");
      showStatus(formatErrorState(error), dim);
    }
  }

  const controller = createPeriodicRefresh({
    getApiKey,
    fetchQuota,
    formatQuotaStatus: (quota) => formatUsageStatus(quotaToUsageSnapshot(quota)),
    formatErrorState,
    setStatus: () => {},
    lastKnownQuota: { value: null },
    refreshActiveStatus: async () => {
      if (currentCtx) await refreshUsage(currentCtx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    ctx.ui.setStatus(OLD_STATUS_ID, undefined);
    refreshUsage(currentCtx).catch((err) => console.error("[pi-usage] startup error:", err));
  });

  pi.on("agent_start", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    controller.start();
  });

  pi.on("agent_end", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    controller.stop();
    refreshUsage(currentCtx).catch((err) => console.error("[pi-usage] agent_end error:", err));
  });

  pi.on("model_select", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    if (!selectUsageProvider(currentCtx.model)) return showStatus(undefined);
    // Mark whatever is currently displayed as stale while fetching new provider's usage.
    if (lastSnapshot) showSnapshotStatus(lastSnapshot, true);
    refreshUsage(currentCtx).catch((err) =>
      console.error("[pi-usage] model_select error:", err),
    );
  });

  pi.on("session_shutdown", () => {
    ++refreshSeq;
    currentCtx = null;
    controller.stop();
  });
}

function colorForSeverity(severity: "ok" | "warning" | "critical"): { background: string; foreground: string } {
  if (severity === "critical") return { background: "toolErrorBg", foreground: "error" };
  if (severity === "warning") return { background: "toolPendingBg", foreground: "warning" };
  return { background: "toolSuccessBg", foreground: "success" };
}
