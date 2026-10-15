import http from "k6/http";
import { check } from "k6";
import { Rate } from "k6/metrics";
import { commonThresholds, SUMMARY_TREND_STATS } from "./config.js";
import { classifyConsume, consumeRequest, createFixture, verifyFinalUsage } from "./helpers.js";
import { createHandleSummary } from "./summary.js";

const REQUEST_COUNT = 20;
const UNITS = 10;
const EXPECTED_ACCEPTED = 5;
const EXPECTED_REJECTED = 15;
const EXPECTED_USAGE = 50;
const concurrencyCorrectness = new Rate("concurrency_correctness");

export const options = {
  vus: 1,
  iterations: 1,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: {
    ...commonThresholds({ p95: 1000, p99: 2000 }),
    concurrency_correctness: ["rate==1"],
    final_usage_consistent: ["rate==1"],
  },
};

export function setup() {
  return createFixture("concurrency", {
    accountMonthlyAllowance: 1_000_000,
    accountMaxUnitsPerRequest: UNITS,
    userMonthlyAllowance: EXPECTED_USAGE,
    userMaxUnitsPerRequest: UNITS,
  });
}

export default function (fixture) {
  const requests = Array.from({ length: REQUEST_COUNT }, (_, index) =>
    consumeRequest(
      fixture,
      `concurrency_${fixture.runId}_${String(index + 1).padStart(3, "0")}`,
      UNITS,
    ),
  );
  const decisions = http.batch(requests).map(classifyConsume).filter(Boolean);
  const accepted = decisions.filter((decision) => decision.accepted).length;
  const rejected = decisions.filter((decision) => !decision.accepted).length;
  const correct =
    decisions.length === REQUEST_COUNT &&
    accepted === EXPECTED_ACCEPTED &&
    rejected === EXPECTED_REJECTED;
  concurrencyCorrectness.add(correct);
  check(decisions, {
    "exactly 5 requests are accepted": () => accepted === EXPECTED_ACCEPTED,
    "exactly 15 requests are rejected": () => rejected === EXPECTED_REJECTED,
    "all rejections are USER monthly-allowance decisions": () =>
      decisions
        .filter((decision) => !decision.accepted)
        .every((decision) =>
          decision.rejection &&
          decision.rejection.scope === "USER" &&
          decision.rejection.rule === "MONTHLY_ALLOWANCE"),
  });
}

export function teardown(fixture) {
  verifyFinalUsage(fixture, UNITS, EXPECTED_USAGE);
}

export const handleSummary = createHandleSummary("concurrency", 1);
