import http from "k6/http";
import { sleep } from "k6";
import { commonThresholds, durationEnv, numberEnv, SUMMARY_TREND_STATS } from "./config.js";
import { classifyConsume, consumeRequest, createFixture, verifyFinalUsage } from "./helpers.js";
import { createHandleSummary } from "./summary.js";

const THINK_TIME = numberEnv("STRESS_THINK_TIME_SECONDS", 0.05);
const UNITS = 1;

export const options = {
  summaryTrendStats: SUMMARY_TREND_STATS,
  scenarios: {
    controlled_stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: durationEnv("STRESS_RAMP", "5s"), target: 10 },
        { duration: durationEnv("STRESS_STAGE_10", "10s"), target: 10 },
        { duration: durationEnv("STRESS_STAGE_25", "10s"), target: 25 },
        { duration: durationEnv("STRESS_STAGE_50", "10s"), target: 50 },
        { duration: durationEnv("STRESS_RAMP_DOWN", "5s"), target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    ...commonThresholds({ p95: 1500, p99: 3000, technicalRate: 0.02 }),
    business_rejected: ["count==0"],
    final_usage_consistent: ["rate==1"],
  },
};

export function setup() {
  return createFixture("stress", {
    accountMonthlyAllowance: 2_000_000_000,
    accountMaxUnitsPerRequest: 10_000,
    userMonthlyAllowance: 2_000_000_000,
    userMaxUnitsPerRequest: 10_000,
  });
}

export default function (fixture) {
  const requestId = `stress_${fixture.runId}_${__VU}_${__ITER}`;
  const request = consumeRequest(fixture, requestId, UNITS);
  classifyConsume(http.post(request.url, request.body, request.params));
  sleep(THINK_TIME);
}

export function teardown(fixture) {
  verifyFinalUsage(fixture, UNITS);
}

export const handleSummary = createHandleSummary("stress", 50);
