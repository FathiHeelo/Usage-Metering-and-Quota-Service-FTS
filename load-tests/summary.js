import { TEST_ENVIRONMENT, BASE_URL } from "./config.js";

function metric(data, name, value, fallback = null) {
  const values = data.metrics[name] && data.metrics[name].values;
  return values && values[value] !== undefined ? values[value] : fallback;
}

function thresholdsPassed(data) {
  return Object.values(data.metrics).every((item) =>
    !item.thresholds || Object.values(item.thresholds).every((threshold) => threshold.ok),
  );
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function collectFailedChecks(group, prefix = "") {
  if (!group) return [];
  const location = group.name ? `${prefix}${group.name} / ` : prefix;
  const failed = (group.checks || [])
    .filter((item) => item.fails > 0)
    .map((item) => `${location}${item.name} (${item.fails} failed)`);
  return (group.groups || []).reduce(
    (items, child) => items.concat(collectFailedChecks(child, location)),
    failed,
  );
}

export function createHandleSummary(testName, configuredVus) {
  const outputPath = __ENV.RESULT_FILE || `results/${testName}-${timestamp()}.json`;

  return function handleSummary(data) {
    const durationSeconds = data.state && data.state.testRunDurationMs
      ? data.state.testRunDurationMs / 1000
      : 0;
    const acceptedResponses = metric(data, "business_accepted", "count", 0);
    const report = {
      testName,
      executedAt: new Date().toISOString(),
      environment: TEST_ENVIRONMENT,
      baseUrl: BASE_URL,
      durationSeconds,
      vus: {
        configuredMaximum: configuredVus,
        observedMaximum: metric(data, "vus", "max", configuredVus),
      },
      requests: {
        total: metric(data, "http_reqs", "count", 0),
        rps: metric(data, "http_reqs", "rate", 0),
      },
      latencyMs: {
        average: metric(data, "http_req_duration", "avg", 0),
        p95: metric(data, "http_req_duration", "p(95)", 0),
        p99: metric(data, "http_req_duration", "p(99)", 0),
      },
      outcomes: {
        acceptedResponses,
        acceptedPerSecond: durationSeconds > 0 ? acceptedResponses / durationSeconds : 0,
        rejectedResponses: metric(data, "business_rejected", "count", 0),
        expectedConflicts: metric(data, "expected_conflicts", "count", 0),
        technicalFailures: metric(data, "technical_failures", "count", 0),
        technicalFailureRate: metric(data, "technical_failure_rate", "rate", 0),
      },
      finalUsage: {
        expected: metric(data, "expected_final_usage", "value"),
        account: metric(data, "final_account_usage", "value"),
        user: metric(data, "final_user_usage", "value"),
        consistent: metric(data, "final_usage_consistent", "rate") === 1,
      },
      assertions: {
        passed: metric(data, "checks", "passes", 0),
        failed: metric(data, "checks", "fails", 0),
        failedChecks: collectFailedChecks(data.root_group),
        thresholdsPassed: thresholdsPassed(data),
      },
      pass:
        thresholdsPassed(data) &&
        metric(data, "checks", "fails", 0) === 0,
      notes: [
        "HTTP request totals include isolated fixture setup and final reporting reads.",
        "Business quota rejections are reported separately and are not technical failures.",
        "Measurements apply only to the recorded environment and workload.",
      ],
    };

    const concise = [
      "",
      `=== ${testName.toUpperCase()} SUMMARY ===`,
      `PASS: ${report.pass}`,
      `Requests: ${report.requests.total} (${Number(report.requests.rps).toFixed(2)} req/s)`,
      `Latency: avg ${Number(report.latencyMs.average).toFixed(2)} ms | p95 ${Number(report.latencyMs.p95).toFixed(2)} ms | p99 ${Number(report.latencyMs.p99).toFixed(2)} ms`,
      `Business outcomes: ${report.outcomes.acceptedResponses} accepted (${Number(report.outcomes.acceptedPerSecond).toFixed(2)}/s) | ${report.outcomes.rejectedResponses} rejected`,
      `Technical failures: ${report.outcomes.technicalFailures}`,
      `Final usage: expected ${report.finalUsage.expected} | account ${report.finalUsage.account} | user ${report.finalUsage.user}`,
      `Report: ${outputPath}`,
      "",
    ].join("\n");

    return {
      stdout: concise,
      [outputPath]: JSON.stringify(report, null, 2),
    };
  };
}
