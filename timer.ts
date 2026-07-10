import type { ParsedQuota } from "./types";

export interface RefreshContext {
  getApiKey: () => string;
  fetchQuota: (apiKey: string) => Promise<ParsedQuota>;
  formatQuotaStatus: (quota: ParsedQuota) => string;
  formatErrorState: (error: unknown) => string | undefined;
  setStatus: (id: string, value: string | undefined) => void;
  lastKnownQuota: { value: ParsedQuota | null };
  refreshActiveStatus?: () => Promise<void>;
}

export interface PeriodicRefreshController {
  start: (intervalMs?: number) => void;
  stop: () => void;
  isRunning: () => boolean;
}

const DEFAULT_INTERVAL_MS = 60_000;
const STATUS_BAR_ID = "pi-usage";

export function createPeriodicRefresh(deps: RefreshContext): PeriodicRefreshController {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  // Guard flag to prevent concurrent tick executions.
  // If a tick takes longer than the interval, this ensures only one
  // tick runs at a time, avoiding race conditions where multiple
  // fetches could update state concurrently.
  let tickInProgress = false;

  async function tick(): Promise<void> {
    // Skip this tick if one is already in progress
    if (tickInProgress) {
      return;
    }

    tickInProgress = true;

    try {
      if (deps.refreshActiveStatus) {
        await deps.refreshActiveStatus();
        return;
      }
      const apiKey = deps.getApiKey();
      const quota = await deps.fetchQuota(apiKey);
      deps.lastKnownQuota.value = quota;
      const formatted = deps.formatQuotaStatus(quota);
      deps.setStatus(STATUS_BAR_ID, formatted);
    } catch (error) {
      if (deps.lastKnownQuota.value) {
        const formatted = deps.formatQuotaStatus(deps.lastKnownQuota.value);
        deps.setStatus(STATUS_BAR_ID, formatted);
      } else {
        const errorDisplay = deps.formatErrorState(error);
        deps.setStatus(STATUS_BAR_ID, errorDisplay);
      }
    } finally {
      tickInProgress = false;
    }
  }

  return {
    start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
      if (intervalId !== null) return; // already running
      tick(); // immediate first fetch
      intervalId = setInterval(tick, intervalMs);
    },

    stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
        tickInProgress = false;
      }
    },

    isRunning(): boolean {
      return intervalId !== null;
    },
  };
}
