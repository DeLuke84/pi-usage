import assert from "node:assert/strict";
import test from "node:test";

import { formatUsageStatus } from "../format.ts";
import { parseTokenPlanResponses } from "../tokenplan.ts";

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
      percent: 0.4608,
      items: [{ name: "month_total_token", used: 5069202448, limit: 11000000000, percent: 0.4608 }],
    },
    usage: {
      percent: 0.46,
      items: [
        { name: "plan_total_token", used: 5069202448, limit: 11000000000, percent: 0.46 },
        { name: "compensation_total_token", used: 0, limit: 0, percent: 0 },
      ],
    },
  },
};

test("renders Token Plan windows as compact date-scoped segments", () => {
  const snapshot = parseTokenPlanResponses(DETAIL, USAGE);

  assert.equal(snapshot.provider, "token-plan");
  assert.equal(snapshot.planLabel, undefined);
  assert.deepEqual(snapshot.limits.map((limit) => limit.label), ["month", "plan"]);
  assert.deepEqual(snapshot.limits, [
    {
      label: "month",
      percentage: (5069202448 / 11000000000) * 100,
      nextResetTime: Date.UTC(2026, 9, 23, 23, 59, 59),
      resetStyle: "date",
    },
    {
      label: "plan",
      percentage: (5069202448 / 11000000000) * 100,
      nextResetTime: Date.UTC(2026, 9, 23, 23, 59, 59),
      resetStyle: "date",
    },
  ]);
  assert.match(formatUsageStatus(snapshot), /^month 46\.1% ↻ Oct23 · plan 46\.1% ↻ Oct23$/);
});

test("keeps plan identity out of the status display", () => {
  const text = formatUsageStatus(parseTokenPlanResponses(DETAIL, USAGE));
  assert.doesNotMatch(text, /Standard/);
});

test("omits zero-limit items like compensation credits", () => {
  const snapshot = parseTokenPlanResponses(DETAIL, USAGE);
  assert.deepEqual(snapshot.limits.map((limit) => limit.label), ["month", "plan"]);
});

test("includes compensation credits while the provider grants a limit", () => {
  const usage = structuredClone(USAGE);
  usage.data.usage.items[1] = { name: "compensation_total_token", used: 250000, limit: 1000000, percent: 0.25 };

  const snapshot = parseTokenPlanResponses(DETAIL, usage);
  assert.deepEqual(snapshot.limits.map((limit) => limit.label), ["month", "plan", "comp"]);
  assert.equal(snapshot.limits[2]!.percentage, 25);
});

test("derives percentages from used/limit even when the ratio field disagrees", () => {
  const usage = structuredClone(USAGE);
  usage.data.monthUsage.items[0] = { name: "month_total_token", used: 500, limit: 1000, percent: 0.4608 };

  const snapshot = parseTokenPlanResponses(DETAIL, usage);
  assert.equal(snapshot.limits[0]!.percentage, 50);
});

test("maps unknown window names to their provider label", () => {
  const usage = structuredClone(USAGE);
  usage.data.monthUsage.items[0] = { name: "promo_total_token", used: 1, limit: 4, percent: 0.25 };

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
