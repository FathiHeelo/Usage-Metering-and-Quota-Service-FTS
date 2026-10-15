# Generated k6 results

Timestamped JSON summaries are written here by each run and are ignored by Git. They contain measurements and assertion results, never API keys.

Implementation verification was executed on October 15, 2026 against the local Docker Compose stack. The load generator was `grafana/k6:1.8.2` in a short-lived Docker container. Host CPU model and Docker CPU allocation were not recorded, so these measurements are local evidence rather than a capacity claim.

| Test | Status | Requests / RPS | Latency avg / p95 / p99 | Business results | Final usage |
| --- | --- | --- | --- | --- | --- |
| Smoke | PASS | 14 / 73.86 RPS | 14.50 / 23.98 / 29.58 ms | 5 accepted, 0 rejected | Expected/account/user: 10/10/10 |
| Concurrency correctness | PASS | 29 / 106.97 RPS | 41.00 / 71.99 / 91.00 ms | 5 accepted, 15 rejected | Expected/account/user: 50/50/50 |
| Idempotency concurrency | PASS | 30 / 182.29 RPS | 18.53 / 61.96 / 77.29 ms | 20 identical accepted responses, 1 expected conflict, 0 technical failures | Expected/account/user: 7/7/7 |
| Normal load | NOT RUN | N/A | N/A | N/A | N/A |
| Stress | NOT RUN | N/A | N/A | N/A | N/A |

Request totals and RPS include isolated fixture setup and final reporting reads. Idempotency's 20 accepted responses represent the same stored logical decision and consumed only once.

One post-test `docker stats --no-stream` snapshot showed:

| Container | CPU | Memory | PIDs |
| --- | --- | --- | --- |
| API | 0.00% | 37.95 MiB / 7.62 GiB | 11 |
| PostgreSQL | 0.02% | 30.96 MiB / 7.62 GiB | 6 |

This is a post-test idle snapshot, not peak resource consumption.
