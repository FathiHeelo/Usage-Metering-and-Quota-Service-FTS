# Verified k6 results

This directory preserves compact, sanitized evidence from successful k6 reports. Raw timestamped JSON and CSV output remains ignored because it is generated locally and may be bulky. The committed summaries contain no API keys, authentication headers, database credentials, personal data, or raw request bodies.

All five selected runs were executed on October 15, 2026 against the local Docker Compose environment using `grafana/k6:1.8.2`. Selection required `pass: true`, passing thresholds, zero failed assertions, and consistent final account/user usage. The summary JSON retains the source report name, SHA-256 digest, and full numeric precision from that report.

## Results

| Profile | Status and evidence | UTC execution | Workload / maximum VUs | Requests / RPS | Latency avg / p95 / p99 | Technical failures | Correctness evidence |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| Smoke | [PASS](verified/smoke.json) | 2026-10-15 16:50:29.620 | 5 consume iterations / 1 configured, 1 observed | 14 / 73.86 | 14.50 / 23.98 / 29.58 ms | 0 | 5 accepted, 0 rejected; expected/account/user usage 10/10/10; 11 assertions passed |
| Quota concurrency | [PASS](verified/quota-concurrency.json) | 2026-10-15 16:50:36.371 | 20 simultaneous requests in one batch / 1 configured, 1 observed | 29 / 106.97 | 41.00 / 71.99 / 91.00 ms | 0 | 5 accepted, 15 valid quota rejections; expected/account/user usage 50/50/50; 44 assertions passed |
| Concurrent idempotency | [PASS](verified/concurrent-idempotency.json) | 2026-10-15 16:51:31.920 | 20 simultaneous retries plus one conflict / 1 configured, 1 observed | 30 / 182.29 | 18.53 / 61.96 / 77.29 ms | 0 | 20 identical accepted responses, 1 expected conflict, one 7-unit charge; 45 assertions passed |
| Normal load | [PASS](verified/normal-load.json) | 2026-10-15 16:57:38.659 | Ramp to 10 VUs, hold 30 seconds, ramp down / 10 configured, 10 observed | 1,795 / 35.77 | 26.16 / 116.32 / 217.69 ms | 0 | 1,786 accepted, 0 rejected; expected/account/user usage 1,786/1,786/1,786; 3,573 assertions passed |
| Controlled stress | [PASS](verified/controlled-stress.json) | 2026-10-15 16:59:37.714 | Stages at 10, 25, and 50 VUs / 50 configured, 49 observed | 5,319 / 132.72 | 98.43 / 279.34 / 328.04 ms | 0 | 5,310 accepted, 0 rejected; expected/account/user usage 5,310/5,310/5,310; 10,621 assertions passed |

HTTP request totals and RPS include isolated fixture setup and final reporting reads. A VU is a simulated client executing a scenario; the quota-concurrency and idempotency profiles use one VU to issue concurrent HTTP batches, so their simultaneous request count is larger than their VU count.

## Evidence selection

The committed summaries were derived from these ignored local source reports:

- `smoke-2026-10-15T16-50-29-620Z.json`
- `concurrency-2026-10-15T16-50-36-371Z.json`
- `idempotency-2026-10-15T16-51-31-920Z.json`
- `load-2026-10-15T16-57-38-659Z.json`
- `stress-2026-10-15T16-59-37-714Z.json`

An earlier smoke report was not selected because its retained VU and p99 fields were incomplete. Two earlier idempotency reports explicitly recorded one failed assertion and `pass: false`; they are not represented as successful evidence. No benchmark was rerun to prepare this index.

## Interpretation and limitations

- RPS is measured HTTP throughput for the recorded scenario, including setup and verification traffic. It is not the service's maximum capacity.
- VUs represent simulated clients. VU count, concurrent HTTP request count, and achieved RPS are different measurements.
- A quota rejection is a valid HTTP 200 business decision, not a technical error. The concurrency profile intentionally expects 15 rejections to prove the quota cannot be overspent.
- The concurrency profiles verify quota and idempotency correctness under contention; they are not capacity benchmarks.
- The normal-load and controlled-stress profiles used different stage shapes, think times, and durations. Their throughput and latency cannot be compared as if they were identical workloads.
- All measurements came from local Docker Compose, not cloud infrastructure. Host CPU details, Docker CPU allocation, generator utilization, and CPU saturation were not recorded, so no hardware-capacity conclusion is supported.
- The memory figures below are a post-test idle snapshot, not peak consumption during any profile.

## Post-test idle snapshot

| Container | CPU | Memory | PIDs |
| --- | --- | --- | --- |
| API | 0.00% | 37.95 MiB / 7.62 GiB | 11 |
| PostgreSQL | 0.02% | 30.96 MiB / 7.62 GiB | 6 |
