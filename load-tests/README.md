# k6 load and correctness tests

This suite measures the real Fastify/PostgreSQL service and verifies quota correctness under concurrency. Every run creates a uniquely named account, user, ACCOUNT plan, USER plan, and request IDs through the public API. Raw API keys remain only in k6 memory and are never written to summaries.

Test records intentionally remain in PostgreSQL after a run. The suite never resets the database, deletes volumes, or reuses demo/manual fixtures.

## Start the application

From the repository root:

```powershell
docker compose up -d --build --wait
```

The PowerShell runner uses the pinned `grafana/k6:1.8.2` image as a short-lived container. It reaches the host-published API through `host.docker.internal`; `localhost` inside the k6 container would refer to k6 itself.

## Run tests on Windows PowerShell

```powershell
.\load-tests\run-k6.ps1 smoke
.\load-tests\run-k6.ps1 concurrency
.\load-tests\run-k6.ps1 idempotency
.\load-tests\run-k6.ps1 load
```

The stress profile is optional and is never part of normal verification:

```powershell
.\load-tests\run-k6.ps1 stress
```

If k6 is installed locally instead, run from `load-tests/`:

```powershell
k6 run -e BASE_URL=http://127.0.0.1:3000 smoke.js
```

## Profiles and expected behavior

| Script | Default workload | Correctness expectation |
| --- | --- | --- |
| `smoke.js` | 1 VU, 5 consumption requests | All accepted; account and user usage finish at 10 |
| `load.js` | Ramp to 10 VUs, hold 30 seconds, ramp down | No quota rejection; final usage equals accepted one-unit decisions |
| `stress.js` | Short stages at 10, 25, and 50 VUs | Optional saturation probe; no capacity claim is made automatically |
| `concurrency.js` | 20 concurrent requests x 10 units | Exactly 5 accepted, 15 rejected, and both counters finish at 50 |
| `idempotency.js` | 20 concurrent identical requests plus one conflict | One logical 7-unit consumption; identical replay decisions; conflicting reuse returns 409 |

Quota rejection is a valid HTTP 200 business decision and is counted in `business_rejected`. It is not a technical failure. Unexpected statuses, malformed decisions, and network failures contribute to `technical_failure_rate`. The expected idempotency HTTP 409 is counted separately as `expected_conflicts`.

## Configuration

Use k6 environment variables with a direct `docker run` command when tuning a profile:

- `BASE_URL`: target API URL.
- `TEST_ENVIRONMENT`: hardware/environment label written into the report.
- `RUN_ID`: optional unique suffix; omit it for automatic isolation.
- `LOAD_VUS`: normal-load target, default `10`.
- `LOAD_RAMP_UP`, `LOAD_HOLD`, `LOAD_RAMP_DOWN`: normal-load durations.
- `THINK_TIME_SECONDS`: pause per normal-load iteration, default `0.2`.
- `STRESS_RAMP`, `STRESS_STAGE_10`, `STRESS_STAGE_25`, `STRESS_STAGE_50`, `STRESS_RAMP_DOWN`: stress durations.
- `STRESS_THINK_TIME_SECONDS`: stress pause, default `0.05`.
- `RESULT_FILE`: optional output path inside `/scripts`, for example `results/custom.json`.

Example:

```powershell
docker run --rm -i --add-host host.docker.internal:host-gateway `
  -v "${PWD}/load-tests:/scripts" -w /scripts `
  -e BASE_URL=http://host.docker.internal:3000 `
  -e LOAD_VUS=10 -e LOAD_HOLD=30s `
  grafana/k6:1.8.2 run load.js
```

## Reading reports

Each run writes a timestamped JSON summary under `load-tests/results/`. It contains the test name, UTC execution time, environment, peak VUs, HTTP request count, RPS, average/p95/p99 latency, technical failures, accepted/rejected response counts, expected and actual final usage, and assertion status.

- **VU**: a virtual user repeatedly executing the test function.
- **RPS**: completed HTTP requests per second, including fixture setup and final verification reads.
- **Average latency**: arithmetic mean; useful context but sensitive to outliers.
- **p95 / p99**: 95% / 99% of requests completed at or below this duration.
- **Technical failure**: an unexpected HTTP response, malformed decision, or network failure.
- **Business rejection**: the service correctly refused consumption because a quota rule applied.

Compare runs only when hardware, Docker allocation, database state, profile, and network path are equivalent. A local generator can become the bottleneck; these numbers do not establish universal service capacity.

To retain k6's native aggregate format as an additional artifact:

```powershell
k6 run --summary-export=results/native-summary.json smoke.js
```

## Resource observation

Run this in another terminal while a profile is active:

```powershell
docker stats usage-metering-and-quota-service-fts-api-1 usage-metering-and-quota-service-fts-postgres-1
```

Record CPU, memory, host hardware, Docker resource allocation, and the configured `DB_POOL_MAX`. PostgreSQL lock waits and a saturated connection pool can increase latency even while quota decisions remain correct. Do not compare resource figures without their environment context.
