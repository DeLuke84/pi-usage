import assert from "node:assert/strict";
import test from "node:test";

import { parseCodexUsageResponse } from "../codex.ts";
import { fetchGitHubCopilotUsage } from "../copilot.ts";
import { formatUsageStatus } from "../format.ts";

test("renders a Codex 30-day primary window as 30d rather than 5h", () => {
  const snapshot = parseCodexUsageResponse({
    plan_type: "free",
    rate_limit: {
      primary_window: {
        used_percent: 17,
        limit_window_seconds: 30 * 24 * 60 * 60,
        reset_at: "2099-08-09T12:00:00Z",
      },
      secondary_window: null,
    },
  });

  assert.deepEqual(snapshot.limits, [{
    label: "30d",
    percentage: 17,
    nextResetTime: Date.parse("2099-08-09T12:00:00Z"),
    resetStyle: "date",
  }]);
  assert.match(formatUsageStatus(snapshot), /^30d 17% ↻ Aug9$/);
});

test("keeps Codex subscription windows provider-specific", () => {
  const now = Date.UTC(2026, 6, 10, 12);
  const snapshot = parseCodexUsageResponse({
    rate_limit: {
      primary_window: {
        used_percent: 25,
        limit_window_seconds: 5 * 60 * 60,
        reset_after_seconds: 60 * 60,
      },
      secondary_window: {
        used_percent: 40,
        limit_window_seconds: 7 * 24 * 60 * 60,
        reset_after_seconds: 2 * 24 * 60 * 60,
      },
    },
  }, now);

  assert.deepEqual(snapshot.limits.map(({ label, resetStyle }) => ({ label, resetStyle })), [
    { label: "5h", resetStyle: "relative" },
    { label: "1w", resetStyle: "weekday" },
  ]);
});

test("preserves GitHub Copilot's premium-interactions quota label", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    copilot_plan: "pro",
    quota_reset_date_utc: "2026-08-01",
    quota_snapshots: {
      premium_interactions: { percent_remaining: 72 },
    },
  }), { status: 200 })) as typeof fetch;

  try {
    const snapshot = await fetchGitHubCopilotUsage({
      access: "unused-by-user-endpoint",
      refresh: "test-refresh-token",
      expires: 0,
    });

    assert.deepEqual(snapshot.limits, [{
      label: "premium",
      percentage: 28,
      nextResetTime: Date.parse("2026-08-01T00:00:00Z"),
      resetStyle: "date",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
