import assert from "node:assert/strict";
import test from "node:test";

import { formatUsageStatus } from "../format.ts";
import { fetchTokenPlanUsage, parseTokenPlanResponses } from "../tokenplan.ts";

const DETAIL = {
  code: 0,
  message: "",
  data: {
    planCode: "standard",
    planName: "Standard",
    currentPeriodEnd: "2026-10-23 23:59:59",
    expired: false,
    enableAutoRenew: true,
    autoRenewDiscount: null,
    hasAutoRenewSubscribed: true,
    clawEnabled: false,
    clawPeriodEnd: null,
    clawPurchased: false,
  },
};

const USAGE = {
  code: 0,
  message: "",
  data: {
    monthUsage: {
      percent: 0.4748,
      items: [{ name: "month_total_token", used: 5223026108, limit: 11000000000, percent: 0.4748 }],
    },
    usage: {
      percent: 0.47,
      items: [
        { name: "plan_total_token", used: 5223026108, limit: 11000000000, percent: 0.47 },
        { name: "compensation_total_token", used: 0, limit: 0, percent: 0 },
      ],
    },
  },
};

test("renders the plan quota as a single compact segment", () => {
  const snapshot = parseTokenPlanResponses(DETAIL, USAGE);

  assert.equal(snapshot.provider, "token-plan");
  assert.equal(snapshot.planLabel, undefined);
  assert.deepEqual(snapshot.limits, [
    {
      label: "plan",
      percentage: (5223026108 / 11000000000) * 100,
      nextResetTime: Date.UTC(2026, 9, 23, 23, 59, 59),
      resetStyle: "date",
    },
  ]);
  assert.match(formatUsageStatus(snapshot), /^plan 47\.5% ↻ Oct23$/);
});

test("never shows the redundant monthly window", () => {
  const usage = structuredClone(USAGE);
  usage.data.monthUsage = {
    percent: 0.9,
    items: [{ name: "month_total_token", used: 9900000000, limit: 11000000000, percent: 0.9 }],
  };

  const snapshot = parseTokenPlanResponses(DETAIL, usage);
  assert.deepEqual(snapshot.limits.map((limit) => limit.label), ["plan"]);
});

test("keeps plan identity out of the status display", () => {
  const text = formatUsageStatus(parseTokenPlanResponses(DETAIL, USAGE));
  assert.doesNotMatch(text, /Standard/);
});

test("omits zero-limit items like compensation credits", () => {
  const snapshot = parseTokenPlanResponses(DETAIL, USAGE);
  assert.deepEqual(snapshot.limits.map((limit) => limit.label), ["plan"]);
});

test("includes compensation credits while the provider grants a limit", () => {
  const usage = structuredClone(USAGE);
  usage.data.usage.items[1] = { name: "compensation_total_token", used: 250000, limit: 1000000, percent: 0.25 };

  const snapshot = parseTokenPlanResponses(DETAIL, usage);
  assert.deepEqual(snapshot.limits.map((limit) => limit.label), ["plan", "comp"]);
  assert.equal(snapshot.limits[1]!.percentage, 25);
});

test("derives percentages from used/limit even when the ratio field disagrees", () => {
  const usage = structuredClone(USAGE);
  usage.data.usage.items[0] = { name: "plan_total_token", used: 500, limit: 1000, percent: 0.47 };

  const snapshot = parseTokenPlanResponses(DETAIL, usage);
  assert.equal(snapshot.limits[0]!.percentage, 50);
});

test("maps unknown window names to their provider label", () => {
  const usage = structuredClone(USAGE);
  usage.data.usage.items[0] = { name: "promo_total_token", used: 1, limit: 4, percent: 0.25 };

  const snapshot = parseTokenPlanResponses(DETAIL, usage);
  assert.equal(snapshot.limits[0]!.label, "promo");
});

test("rejects responses without quota windows", () => {
  assert.throws(() => parseTokenPlanResponses(DETAIL, { code: 0, message: "", data: {} }), /missing quota windows/);
});

test("rejects details without a period end", () => {
  assert.throws(() => parseTokenPlanResponses({ code: 0, message: "", data: {} }, USAGE), /currentPeriodEnd/);
});

test("surfaces provider error codes", () => {
  assert.throws(() => parseTokenPlanResponses({ code: 41001, message: "quota service down", data: {} }, USAGE), /41001/);
});

test("names the cookie source and the remedy when the platform rejects the session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("", { status: 401 }))) as typeof fetch;
  try {
    for (const [source, label] of [
      ["env", "PI_USAGE_TOKEN_PLAN_COOKIE"],
      ["browser", "browser cookie store"],
      ["stored", "auth.json fallback"],
    ] as const) {
      await assert.rejects(
        fetchTokenPlanUsage({ cookie: "userId=7; api-platform_serviceToken=stale", source }),
        (error: Error) => {
          assert.ok(error.message.includes("Token Plan cookie rejected"), error.message);
          assert.ok(error.message.includes(label), error.message);
          assert.match(error.message, /open https:\/\/platform\.xiaomimimo\.com once/);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
