# Final Engineering Audit

> [!IMPORTANT]
> **Historical audit snapshot.** This audit was completed on October 15, 2026 against commit [`419e7b43def86aa1073df7e17272f7672034bb20`](https://github.com/FathiHeelo/Usage-Metering-and-Quota-Service-FTS/commit/419e7b43def86aa1073df7e17272f7672034bb20). It is preserved as the original point-in-time review. Several findings were resolved afterward; use the summary below for current status and read the original findings in their historical context.

## Post-Audit Resolution Summary

This summary records repository-backed changes made after the audited commit. It does not rewrite the original evidence or imply that the remaining operational limitations are resolved.

| Original finding | Current status | Post-audit evidence |
| --- | --- | --- |
| P1-01: public account creation had no abuse control | **Resolved for the current single-instance deployment.** `POST /accounts` now has configurable per-client-IP rate limiting and proxy-aware IP handling. The limiter remains process-local. | [`src/config.ts`](../src/config.ts), [`src/app.ts`](../src/app.ts), [`account.routes.ts`](../src/modules/accounts/account.routes.ts), [`account-rate-limit.integration.test.ts`](../test/account-rate-limit.integration.test.ts) |
| P1-02: no HTTPS/public reverse-proxy deployment | **Resolved for the live demo deployment, not for default local Compose.** The deployed EC2 service is documented behind Caddy-managed HTTPS; the repository's normal Compose topology intentionally remains API plus PostgreSQL. | [`README.md`](../README.md#architecture), [`CI-CD-SETUP.md`](CI-CD-SETUP.md), [`deploy.yml`](../.github/workflows/deploy.yml) |
| P2-01 and P2-02: UTC rollover and concurrency/rollback edges lacked direct tests | **Resolved.** Deterministic PostgreSQL cases cover request-entry UTC month behavior, concurrent conflicting IDs, cross-user account contention, and transaction rollback after controlled history-persistence failure. | [`quota-edge-cases.integration.test.ts`](../test/quota-edge-cases.integration.test.ts), [`ci.yml`](../.github/workflows/ci.yml) |
| P2-03: normal/stress benchmark evidence was not repository-portable | **Resolved as evidence preservation.** Sanitized source-derived JSON summaries and their provenance are committed. These are local Docker measurements, not AWS capacity claims. | [`load-tests/results/README.md`](../load-tests/results/README.md), [`load-tests/results/verified/`](../load-tests/results/verified/) |
| P2-05: frontend workflows had no automated browser test | **Resolved with focused coverage.** Playwright exercises the real React UI and API against a disposable PostgreSQL container; CI installs Chromium and runs it as a separate required job. | [`quota-dashboard.spec.ts`](../test/e2e/quota-dashboard.spec.ts), [`run-e2e.ts`](../scripts/run-e2e.ts), [`playwright.config.ts`](../playwright.config.ts), [`ci.yml`](../.github/workflows/ci.yml) |
| P3-01: plan mutations did not advance `updated_at` | **Resolved.** Account-plan, user-plan, and custom-plan mutations update their timestamps and have a focused regression test. | [`account.service.ts`](../src/modules/accounts/account.service.ts), [`user.service.ts`](../src/modules/users/user.service.ts), [`plan.service.ts`](../src/modules/plans/plan.service.ts), [`updated-at.integration.test.ts`](../test/updated-at.integration.test.ts) |
| P3-03: current plan identity was inferred in the dashboard | **Partially resolved.** Authenticated account and usage responses now return authoritative active-plan identity and limits, and the UI consumes them. The absence of a paginated list-all-users endpoint remains. | [`api-key-auth.ts`](../src/plugins/api-key-auth.ts), [`usage.service.ts`](../src/modules/usage/usage.service.ts), [`App.tsx`](../client/src/App.tsx), [`active-plan.integration.test.ts`](../test/active-plan.integration.test.ts) |

### Remaining limitations after the audit

- `/health` is still a process liveness check rather than a database readiness probe.
- Account-creation throttling is in-memory and is not coordinated across multiple API replicas or restarts; broader admission controls and explicit identifier length limits remain future hardening.
- The browser demo still stores its API key in `sessionStorage`, and the API does not provide a paginated list-all-users endpoint.
- The deployment remains a single-host Docker Compose design without automated backups, production metrics/tracing, autoscaling, or multi-region failover.
- Playwright provides one focused Chromium workflow, not exhaustive browser, accessibility, or responsive-device coverage.
- The committed k6 results describe recorded local workloads only; they do not establish maximum throughput or AWS production capacity.
- Native ARM64 execution remains unverified, and base-image digest pinning remains an operational improvement.

---

Audit date: 2026-10-15  
Audited branch: `audit/final-engineering-review`  
Audited commit: `419e7b43def86aa1073df7e17272f7672034bb20`  
Scope: source, migrations, integration tests, React demo, k6 assets/results, dependencies, Docker configuration, and current local container health.

The original take-home assignment specification was not present in the repository. The compliance review is therefore limited to the 22 requirements supplied in the final-audit brief and to behavior documented in the repository. No additional requirements were inferred.

## 1. Executive Summary

Overall readiness: **READY WITH MINOR FIXES** for take-home submission.

The core implementation is credible and well tested. The production build passed, all 76 executed PostgreSQL integration tests passed, the running Compose services were healthy, and the production dependency audit reported zero vulnerabilities. The quota transaction uses a consistent account-first lock order, serializes plan changes with consumption, atomically updates both counters, and stores the decision snapshot in the same transaction. No confirmed lost-update, double-consumption, cross-account access, rollback, or deadlock defect was found.

The verdict does not mean the Compose stack is ready for unrestricted internet production. Public deployment still needs abuse controls for account creation, TLS/reverse-proxy and secret-management controls, database backups, monitoring, and resource governance. Before submission, the benchmark evidence should also be reconciled: normal-load and stress JSON exist in this working directory but are intentionally ignored, while the checked-in results summary still says those two profiles were not run.

Finding count:

| Priority | Count | Submission impact |
| --- | ---: | --- |
| P0 — Critical | 0 | None |
| P1 — High | 2 | Deployment blockers, not blockers for a local take-home review |
| P2 — Medium | 6 | One evidence issue should be resolved before submission; the rest are bounded design/test/operations gaps |
| P3 — Low | 4 | Quality and maintainability improvements |

## 2. Requirements Compliance

| Requirement | Status | Evidence | Missing Work |
| --- | --- | --- | --- |
| 1. Account creation and API-key authentication | PASS | Account and hashed key are created in one transaction (`src/modules/accounts/account.service.ts:35-78`). Authentication hashes `X-API-Key`, joins its account, and rejects missing, invalid, or revoked keys (`src/plugins/api-key-auth.ts:24-60`). Account/auth integration scripts passed. | None for stated scope. Key rotation/revocation APIs are not part of the supplied requirements. |
| 2. User creation and account ownership | PASS | User creation derives the tenant from the authenticated request and selects the predefined Basic USER plan (`src/modules/users/user.service.ts:69-99`). Database uniqueness is tenant-scoped (`src/db/schema.ts:123-127`). User integration tests passed. | None. |
| 3. Predefined account and user plans | PASS | Seed defines Starter/Pro ACCOUNT and Basic/Premium USER plans and inserts idempotently (`src/db/seed.ts:5-46`). | None. |
| 4. Custom plan creation and modification | PASS | Custom ownership is set from authenticated account context; list/update filters enforce ownership and predefined plans are immutable (`src/modules/plans/plan.service.ts:77-112,115-190`). Plan tests passed. | None. |
| 5. Dynamic plan updates without restarting | PASS | Plan records and assignments are read from PostgreSQL on each decision after quota locks (`src/modules/usage/usage.service.ts:225-245`). Deterministic plan-concurrency tests passed. | None. |
| 6. Monthly account quotas | PASS | One account counter per `(account_id, month_start)` and an account allowance check are implemented (`src/db/schema.ts:131-152`; `src/modules/usage/usage.service.ts:191-200,257-263`). | Month-rollover semantics need an explicit test; see P2-01. |
| 7. Monthly user quotas | PASS | One user counter per `(user_id, month_start)` and a user allowance check are implemented (`src/db/schema.ts:155-176`; `src/modules/usage/usage.service.ts:203-212,263-268`). | Month-rollover semantics need an explicit test; see P2-01. |
| 8. Maximum units per request | PASS | Account and user per-request limits are checked before monthly limits (`src/modules/usage/usage.service.ts:251-269`); both rejection paths passed integration tests. | None. |
| 9. All-or-nothing consumption | PASS | Accepted decisions update both counters; rejected decisions update neither, and decision persistence shares the transaction (`src/modules/usage/usage.service.ts:271-340`). | Failure-injection rollback is not directly tested; see P2-02. |
| 10. Atomic usage updates | PASS | Drizzle transaction plus ordered `FOR UPDATE` locks protect account, user, and monthly rows (`src/modules/usage/usage.service.ts:107-223`). Concurrent quota test passed with exact final counters. | None found. |
| 11. Idempotent retries | PASS | Existing decisions are replayed before and after locks; `(account_id, request_id)` is unique (`src/modules/usage/usage.service.ts:123-153,219-223`; `src/db/schema.ts:212-215`). Sequential integration and saved concurrent k6 evidence both pass. | A same-ID concurrent case is not in the Node integration suite; see P2-02. |
| 12. Conflicting request-ID handling | PASS | Stored user and units are compared and a mismatch maps to HTTP 409 (`src/modules/usage/usage.service.ts:93-100`; `src/modules/usage/usage.routes.ts:43-45`). Integration test passed. | Concurrent conflicting payloads are not directly tested; see P2-02. |
| 13. Correct concurrent consumption | PASS | Account-first lock ordering serializes all quota mutations; 20 concurrent requests produced 10 accepted/10 rejected in the integration test, and saved k6 evidence produced 5/15 with final usage 50. | Cross-user account contention and month-boundary overlap are not directly tested. |
| 14. Usage reporting | PASS | Account and user reads use current plan limits, return zero without a row, clamp remaining to zero, and serialize BIGINT as strings (`src/modules/usage/usage.service.ts:346-430`). Usage-read tests passed. | None. |
| 15. Usage history and pagination | PASS | History is newest-first, filtered, tenant-scoped, and paginated with a maximum limit of 100 (`src/modules/usage/usage.schema.ts:27-35`; `src/modules/usage/usage.service.ts:433-511`). Tests passed. | None. |
| 16. Account isolation | PASS | Authenticated account ID is injected server-side; service queries include account predicates; history has a composite account/user foreign key (`src/db/schema.ts:216-220`). Cross-tenant tests passed across users, plans, usage, and history. | None found. |
| 17. PostgreSQL persistence | PASS | Drizzle schema and committed migration define seven relational tables, constraints, indexes, and foreign keys; Compose uses a named volume (`docker-compose.yml:9-10,56-57`). | Backup/restore is an operations gap, not a persistence implementation failure. |
| 18. Automatic migrations and seeding | PASS | Runtime command runs migrations then seed before starting Fastify (`Dockerfile:38`); both succeeded against the disposable audit database. | Multi-replica migration coordination would be needed beyond this single-service Compose deployment. |
| 19. One-command Docker startup | PASS | README documents `docker compose up --build`; Compose orders API startup after PostgreSQL health (`docker-compose.yml:24-36`). Current config parsed and both services were healthy. | Internet-production edge configuration is intentionally absent. |
| 20. Working demo client | PARTIAL | React/Vite production build and static-security tests passed. Source uses the real API for onboarding, plans, users, usage, consume, history, filters, pagination, and idempotent retry (`client/src/api.ts:69-151`). | No browser E2E suite was present or executed, and two small UX caveats remain (P3-02/P3-03). |
| 21. Load and performance tests | PARTIAL | k6 smoke, load, stress, quota-concurrency, and idempotency profiles exist and distinguish business rejection from technical failure (`load-tests/helpers.js:149-168`). Local saved JSON supports all reported figures. | Normal/stress raw results are ignored and the tracked summary says NOT RUN; see P2-03. k6 was not rerun during this audit. |
| 22. Documentation and reproducibility | PARTIAL | README covers architecture, schema, API, quick start, Docker, tests, concurrency, security, trade-offs, and known limits. | Original assignment spec is absent; there is no aggregate integration command; performance evidence is split between tracked and ignored files. |

## 3. Architecture and Code Quality

### Backend

The service is compact and follows a clear module boundary: Fastify routes validate and map HTTP behavior, services own database/business operations, and Drizzle owns schema/query composition. Route handlers are thin and consistently convert known domain errors to 4xx responses while logging unexpected errors and returning generic 500 responses. Public routes are explicitly limited to health and account creation; all other API routes attach the reusable authentication pre-handler (`src/modules/*/*.routes.ts`).

Zod coverage is appropriate for the defined API. It trims required identifiers, rejects empty values, validates UUIDs and `YYYY-MM`, restricts plan/status enums, caps pagination, uses strict request bodies, and rejects unsafe or non-positive consumption units (`src/modules/usage/usage.schema.ts:3-35`; `src/modules/plans/plan.schema.ts:3-29`). PostgreSQL `BIGINT` values remain `bigint` internally and are returned as decimal strings, preventing JSON serialization and precision failures (`src/modules/usage/usage.service.ts:65-90,377-382,488-510`).

No unnecessary infrastructure or background processes were found. The runtime is one Fastify process plus PostgreSQL. The pool has a validated positive maximum (default 10) and a five-second connection timeout (`src/db/index.ts:5-26`).

### Frontend

The demo client calls the real endpoints rather than using fixtures. It supports account creation/existing-key connection, live dashboard counters, user creation and lookup, account/user plan assignment, custom plan create/update, accepted and rejected consume examples, identical retry, and history filters/pagination. Loading and API error states are generally visible, and CSS includes responsive breakpoints at 1180, 900, and 680 pixels (`client/src/styles.css:350-402`).

The client intentionally persists the raw API key in `sessionStorage` (`client/src/App.tsx:72-79,146-159`). This is acceptable for the documented local demo but not a safe hosted-administration model. It also infers current plan identity from a monthly limit when an explicit preferred plan ID is unavailable (`client/src/App.tsx:120-135,189-204`), which is ambiguous when plans share the same allowance. The README discloses both limitations.

One UI error-handling issue is concrete: the playground suppresses plan/account context-load failures while no user is selected (`client/src/App.tsx:747-755`). This can leave placeholder values without explaining that the API call failed.

## 4. Database and Concurrency

### Schema integrity

The schema provides strong final-line protections:

- non-negative plan limits and usage counters;
- month rows constrained to the first day of a month;
- unique user identifiers per account;
- unique predefined plan names per scope and custom plan names per owner/scope;
- exactly one account decision per request ID;
- positive request units;
- consistency between accepted/rejected status and rejection fields;
- a composite `(account_id, user_id)` foreign key that prevents cross-tenant history associations (`src/db/schema.ts:29-66,104-176,179-242`).

Scope and plan-ownership compatibility for account/user assignments are service-level invariants rather than cross-table database constraints. The assignment services consistently validate those rules before update (`src/modules/accounts/account.service.ts:106-132`; `src/modules/users/user.service.ts:148-174`).

### Transaction and lock analysis

Consumption acquires locks in the documented order: account, user, account-month row, user-month row. Account plan switches lock the account; user plan switches lock account then user; custom-plan updates lock the owning account. This gives all quota-affecting mutations the same leading serialization point and prevents plan values from being mixed within a decision (`src/modules/usage/usage.service.ts:155-245`; `src/modules/accounts/account.service.ts:93-132`; `src/modules/users/user.service.ts:119-174`; `src/modules/plans/plan.service.ts:137-176`).

First use is safe: counter inserts use `ON CONFLICT DO NOTHING`, then the rows are locked and read. Accepted requests compute and write both new counters inside the same transaction; rejected requests do not write either counter. The request snapshot is inserted before commit. Any database error rejects the transaction and therefore rolls back counter and history mutations together.

Idempotency has two reads by design. The first cheaply returns a completed decision. The second occurs after serialization locks, catches a simultaneous identical request, and either replays it or raises conflict for another user/units payload. The unique database constraint is the final protection.

No inconsistent lock order, lost-update path, overspend path, or deadlock was found in reviewed code or executed tests. Serializing every consume on the account row intentionally limits parallelism for a hot tenant, including different users under the same account. This is a correctness trade-off, not a defect; the saved local stress result did not show technical failures at the tested scale.

### Remaining boundary risks

The consume month is captured from the application clock before the transaction and before any lock wait (`src/modules/usage/usage.service.ts:46-49,103-107`). A request admitted immediately before a UTC rollover can therefore commit afterward while still charging the prior month. That may be a valid “request receipt month” policy, but the policy is not explicit and no clock-controlled rollover test exists. It must be documented and tested before treating boundary behavior as verified.

The Node integration suite covers concurrent quota exhaustion and deterministic plan/consume ordering with real PostgreSQL lock waiters (`test/usage.integration.test.ts:397-413`; `test/plan-concurrency.integration.test.ts:264-309,392-569`). It does not directly cover simultaneous conflicting payloads sharing one request ID, concurrent consumption by different users under the same account, UTC rollover during a lock wait, or injected persistence failure to prove rollback. These are recommended tests rather than confirmed implementation bugs.

## 5. Security

### Verified controls

- API keys contain 32 cryptographically random secret bytes plus a non-secret prefix; only SHA-256 hash and prefix are stored (`src/modules/accounts/account.service.ts:30-39,69-77`). SHA-256 without a salt is appropriate here because the source secret has high entropy and must support deterministic lookup.
- Authentication returns one generic 401 shape for missing, invalid, and revoked keys and does not expose hashes (`src/plugins/api-key-auth.ts:18-60`).
- Fastify's normal request logging does not deliberately log the raw key; no application log statement containing the header or raw key was found.
- Tenant and plan authorization checks derive ownership from authenticated context, not client-provided account IDs.
- Static serving uses enumerated routes (`wildcard: false`), and the static-security integration test passed encoded/non-canonical API path checks (`src/app.ts:21-26`; `test/static-security.integration.test.ts:24-76`).
- The database is not published to the host in Compose. API health logging is reduced only for successful health requests; other route logging remains enabled (`src/app.ts:11-19`).
- `npm audit --omit=dev --json` reported **0 production vulnerabilities** on 2026-10-15.

### Dependency risks

The full `npm audit --json` reported **4 moderate development dependency findings**: direct `drizzle-kit` plus transitive `@esbuild-kit/esm-loader`, `@esbuild-kit/core-utils`, and `esbuild` (GHSA-67mh-4wv8-2f99). The advisory concerns an esbuild development server. These packages are excluded from the production image (`Dockerfile:27-28`). npm proposed a semver-major change to `drizzle-kit@0.18.1`; that is a downgrade from the installed 0.31.5 and should not be applied blindly. Keep development servers bound locally and track a compatible Drizzle toolchain resolution.

Resolved key production versions at audit time were `fastify@5.12.5`, `@fastify/static@10.1.6`, `drizzle-orm@0.45.4`, `pg@8.23.1`, and `zod@4.6.6`.

### Public-deployment risks

`POST /accounts` is deliberately unauthenticated and has no rate limit, invitation control, CAPTCHA, or upstream admission policy (`src/modules/accounts/account.routes.ts:15-37`). Names and other text identifiers have a non-empty check but no field-length cap. On an exposed host, automated account creation can produce persistent accounts and keys and consume database/storage resources. This is not a failure of the stated local demo flow, but it is a high-priority public-exposure risk.

Compose binds the API port on all host interfaces and supplies development database defaults (`docker-compose.yml:5-7,29-36`; `.env.example:1-7`). There is no TLS terminator, reverse proxy, CSP/security-header layer, managed secret integration, or network firewall definition in this repository. The raw key in browser `sessionStorage` is exposed to any script executing in the same origin. A hosted demo therefore needs HTTPS, controlled account onboarding, restrictive firewall rules, secrets outside source/Compose defaults, and an XSS-conscious delivery policy.

These deployment recommendations are separate from assignment correctness. The API and PostgreSQL behavior tested locally is not evidence that the service is safe to expose directly to the internet.

## 6. Testing Results

### Environment and isolation

Tests ran against a disposable PostgreSQL 16 container named specifically for this audit. It used a random localhost port and `tmpfs` database storage; it did not mount, reset, or inspect the project's existing `postgres_data` volume. Migrations and seed ran successfully, all scripts completed, and the disposable container was then verified by its audit label and removed automatically. Existing Compose services and data remained running.

### Executed integration scripts

| Command | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| `npm.cmd run test:accounts` | 2 | 2 | 0 | 0 |
| `npm.cmd run test:auth` | 7 | 7 | 0 | 0 |
| `npm.cmd run test:users` | 7 | 7 | 0 | 0 |
| `npm.cmd run test:user-plan` | 8 | 8 | 0 | 0 |
| `npm.cmd run test:plans` | 10 | 10 | 0 | 0 |
| `npm.cmd run test:account-plan` | 8 | 8 | 0 | 0 |
| `npm.cmd run test:usage` | 10 | 10 | 0 | 0 |
| `npm.cmd run test:usage-read` | 10 | 10 | 0 | 0 |
| `npm.cmd run test:plan-concurrency` | 10 | 10 | 0 | 0 |
| `npm.cmd run test:static-security` | 4 | 4 | 0 | 0 |
| **Total** | **76** | **76** | **0** | **0** |

There were no failed assertions, deadlocks, or database errors. The deterministic concurrency suite exercises both serialization orders using a real held account-row lock and PostgreSQL lock-wait observation rather than arbitrary delay alone.

### Other executed verification

- `npm.cmd run build` — passed once. Server TypeScript compiled; client typechecks and Vite production build passed (1,921 modules, 279.73 kB JS / 84.97 kB gzip, 27.76 kB CSS / 6.79 kB gzip).
- `npm.cmd run db:migrate` and `npm.cmd run db:seed` with an isolated, redacted `DATABASE_URL` — passed.
- `npm.cmd audit --omit=dev --json` — passed with 0 production findings.
- `npm.cmd audit --json` — completed with 4 moderate development findings and exit code 1, as expected for findings.
- `docker compose config --quiet` — passed.
- `docker compose ps` — API and PostgreSQL both reported running/healthy.
- Live `GET http://127.0.0.1:3000/health` — HTTP 200 with `{"status":"ok"}`.
- Live unauthenticated `GET /me` — HTTP 401.
- `docker buildx imagetools inspect node:22-alpine` and `postgres:16` — both current manifests include Linux ARM64/v8.
- `docker stats --no-stream` — current idle snapshot: API 32.79 MiB, PostgreSQL 26.09 MiB, both 0.00% CPU at the sample instant. This is not peak usage.

The initial sandboxed audit calls could not reach the npm registry or Docker named pipe. They were rerun with approved network/Docker access and succeeded. An initial cleanup label-template command had a PowerShell/Docker quoting error; its safety guard refused to stop anything. JSON inspection then verified the exact ephemeral container label before cleanup. These were audit-environment issues, not application or database failures.

No k6 profile was rerun. No browser E2E or manual cross-device responsive test exists. ARM64 images were verified by manifest only; this audit host is AMD64, so native ARM execution remains unverified.

The existing Compose image was not rebuilt during this audit. Its health proves the already-running stack was operational; the separate successful `npm.cmd run build` proves the audited checkout compiled, but this run did not independently repeat the Docker packaging build.

## 7. Performance

The newest successful local result file for each profile matches the supplied figures:

| Profile | Evidence status | Requests / RPS | Avg / p95 / p99 | Business and correctness result |
| --- | --- | --- | --- | --- |
| Smoke | Verified in local JSON and tracked summary | 14 / 73.86 | 14.50 / 23.98 / 29.58 ms | 5 accepted; expected/account/user usage 10/10/10; 0 technical failures |
| Quota concurrency | Verified in local JSON and tracked summary | 29 / 106.97 | 41.00 / 71.99 / 91.00 ms | 5 accepted, 15 rejected; usage 50/50/50; 0 technical failures |
| Idempotency concurrency | Verified in latest local JSON and tracked summary | 30 / 182.29 | 18.53 / 61.96 / 77.29 ms | 20 identical accepted responses, 1 expected conflict, one 7-unit charge; 0 technical failures |
| Normal load | Verified in local ignored JSON; not retained by tracked summary | 1,795 / 35.77 | 26.16 / 116.32 / 217.69 ms | 1,786 accepted; usage 1,786/1,786/1,786; 0 technical failures |
| Controlled stress | Verified in local ignored JSON; not retained by tracked summary | 5,319 / 132.72 | 98.43 / 279.34 / 328.04 ms | 5,310 accepted; usage 5,310/5,310/5,310; 0 technical failures |

The local JSON files report passing thresholds and zero failed assertions for the selected runs: 11 smoke assertions, 44 concurrency assertions, 45 idempotency assertions, 3,573 normal-load assertions, and 10,621 stress assertions. Two earlier idempotency JSON files record failed harness versions; the later `idempotency-2026-10-15T16-51-31-920Z.json` is the successful result selected above. Historical failure files should not be silently presented as passing evidence.

The harness correctly separates quota decisions from transport/application failures. `business_rejected` is a counter, while malformed/unexpected/network behavior increments `technical_failure_rate`; expected 409 idempotency conflicts are counted separately (`load-tests/helpers.js:149-168`). Final account/user reads must equal expected accepted consumption (`load-tests/helpers.js:189-209`), so the profiles test correctness as well as latency.

The conclusions are appropriately bounded to local Docker Compose. They do not establish maximum capacity, sustained production behavior, multi-account fairness, ARM64 performance, or peak memory. Host CPU and Docker CPU allocation were not recorded. Most importantly for submission reproducibility, generated JSON is ignored and only three results are represented as PASS in `load-tests/results/README.md:9-13`; the main README accurately labels normal/stress values as supplied but still displays them (`README.md:722-759`).

## 8. Docker and Deployment

The Dockerfile is a proper three-stage production build. Separate server and client stages install development toolchains and produce artifacts; the runtime stage installs only production dependencies, copies migrations and compiled assets, and runs as non-root `node` (`Dockerfile:1-38`). The React application is therefore already served as static files from the Fastify runtime; no separate frontend process is needed.

Compose provides a persistent PostgreSQL volume, health-gated API dependency, restart policies, bounded `json-file` logging, a 30-second API health interval, and configurable pool size (`docker-compose.yml:1-57`). The API startup sequence fails closed if migration or seed fails. The current running API and database were both healthy, and Compose configuration validation succeeded.

Both base-image tags currently publish Linux ARM64/v8 manifests, and no obvious native production addon (for example `bcrypt`, `sharp`, `canvas`, or native SQLite bindings) was found in the installed production tree. An Ubuntu ARM64 Oracle Ampere A1 deployment is therefore plausible. Remaining caveats are that the tags are floating, the image was not built/run on ARM64 in this audit, and registry availability plus future tag contents can change.

Before public deployment:

1. Place a maintained TLS reverse proxy or managed ingress in front of the API; expose only 80/443, keep PostgreSQL private, and restrict SSH by firewall/source.
2. Replace Compose defaults with generated secrets delivered outside Git and rotate any credential ever used on a public host.
3. Gate/rate-limit public account creation and set request/body/identifier limits.
4. Add scheduled PostgreSQL backups, off-host retention, and a tested restore procedure before relying on the named volume.
5. Add bounded CPU/memory settings based on measured peak workloads, plus disk, pool, lock-wait, error-rate, restart, and backup monitoring.
6. Keep one migration owner at startup; if scaling replicas, separate migration/seed execution from concurrent application startup.

The existing `/health` route proves only that the Node process can answer; it does not prove PostgreSQL readiness (`src/app.ts:15`; `README.md:647`). A separate bounded database readiness check is advisable for orchestration without making liveness depend on a transient database outage.

## 9. Documentation

The README is unusually complete for a take-home: it documents architecture, design rationale, database entities, API examples, environment variables, quick start and safe shutdown, transaction ordering, idempotency, testing, performance interpretation, security controls, deployment structure, and known limitations. Its claims about account/user isolation, current-plan reporting, BIGINT serialization, static serving, pool behavior, and startup were checked against source and are accurate.

The diagram sections are clearly marked as planned visuals rather than implemented evidence and contain no broken links. This keeps the document readable before assets are added.

Documentation gaps are evidence-related rather than structural:

- No original assignment specification is checked in, so future reviewers cannot perform an independent requirement-by-requirement trace against the source brief.
- `load-tests/results/README.md:12-13` says normal load and stress were not run, while ignored local JSON and the main README contain those values. The main README discloses that distinction, but a fresh clone cannot independently inspect those raw runs.
- There is no one-command integration-suite script; the README correctly says the scripts are independent (`README.md:674-702`). This makes CI/reviewer reproduction more error-prone.
- The README explicitly documents local demo security limitations, which is good; it should continue to avoid calling the current Compose setup production-ready.

## 10. Issues to Fix Before Submission

### P0 — Critical

None found.

### P1 — High

#### P1-01 — Public account creation has no abuse control

- **Problem:** Anyone reaching the API can create persistent accounts and API keys without throttling or admission control; text fields also have no explicit maximum length.
- **Evidence:** `src/modules/accounts/account.routes.ts:15-37`; `src/modules/accounts/account.schema.ts:3-5`; `docker-compose.yml:35-36`.
- **Impact:** A public demo can be used for database/storage growth and resource exhaustion. This does not break the intended local onboarding flow.
- **Recommended minimal fix:** At deployment, rate-limit `POST /accounts` at the edge and require an invite/demo token or disable it after provisioning. Add conservative maximum lengths for names, external IDs, and request IDs.
- **Blocks submission:** No for a local take-home. Yes for unrestricted public exposure.

#### P1-02 — Compose is not an internet security boundary

- **Problem:** The repository has no HTTPS termination, reverse proxy/security headers, managed secret delivery, or firewall policy; the demo keeps the API key in browser session storage.
- **Evidence:** `docker-compose.yml:5-7,29-36`; `.env.example:1-7`; `client/src/App.tsx:72-79,146-159`.
- **Impact:** Direct public exposure risks credential interception/misconfiguration and key theft after any same-origin script compromise.
- **Recommended minimal fix:** Put the stack behind TLS, restrict host ports/firewall, inject strong secrets outside Git, add a restrictive CSP, and use a server-side session/BFF for any non-demo console.
- **Blocks submission:** No if clearly presented as local/demo deployment. Yes for production or uncontrolled public demo claims.

### P2 — Medium

#### P2-01 — UTC rollover semantics are implicit and untested

- **Problem:** Consume chooses `monthStart` before entering the transaction and potentially waiting for locks. The intended rule—request receipt time versus serialization time—is not stated.
- **Evidence:** `src/modules/usage/usage.service.ts:46-49,103-107`; no clock-controlled boundary case in `test/usage.integration.test.ts` or `test/plan-concurrency.integration.test.ts`.
- **Impact:** A request received just before midnight UTC may commit after midnight against the prior month. This is deterministic but may surprise clients if serialization-month semantics were expected.
- **Recommended minimal fix:** Define the policy, inject/parameterize the clock for tests, and add a lock-gated rollover integration case. Move month selection after the leading lock only if serialization-month behavior is the requirement.
- **Blocks submission:** No, unless the unavailable original specification defines the opposite policy.

#### P2-02 — Important concurrency/rollback edges lack direct PostgreSQL integration cases

- **Problem:** The suite does not directly cover simultaneous conflicting payloads with one request ID, simultaneous consumes for different users under one account, rollover during lock wait, or injected history-persistence failure/rollback.
- **Evidence:** Existing coverage is concentrated at `test/usage.integration.test.ts:234-413` and `test/plan-concurrency.integration.test.ts:312-652`; saved k6 covers simultaneous identical retries but is not part of the Node integration suite.
- **Impact:** The reviewed code appears correct, but regression confidence for these boundaries is lower than for covered paths.
- **Recommended minimal fix:** Add four deterministic real-PostgreSQL tests using the existing row-lock gate pattern; do not add sleeps or mocks that hide database behavior.
- **Blocks submission:** No, but the month and conflicting-ID cases are worth adding before claiming exhaustive concurrency coverage.

#### P2-03 — Normal/stress evidence is not repository-portable

- **Problem:** Normal-load and stress JSON exist locally but are ignored; the tracked result summary marks them NOT RUN while the main README shows their supplied figures.
- **Evidence:** `load-tests/results/.gitignore`; `load-tests/results/README.md:3,12-13`; `README.md:722-759`.
- **Impact:** A reviewer cloning the repository cannot validate two headline benchmark profiles and may question otherwise valid performance claims.
- **Recommended minimal fix:** After one deliberate re-validation, update the tracked summary with the exact environment/date and commit small sanitized summaries (not secrets or bulky raw output), or remove those two headline claims.
- **Blocks submission:** Recommended to resolve before submission because it affects evidence credibility, not runtime correctness.

#### P2-04 — Healthcheck is liveness-only

- **Problem:** `/health` returns a constant response without a bounded database check.
- **Evidence:** `src/app.ts:15`; `docker-compose.yml:37-48`.
- **Impact:** The API container can remain healthy while authenticated/database-backed requests fail.
- **Recommended minimal fix:** Keep the current endpoint for liveness and add a separate readiness endpoint that performs a short-timeout trivial query; point deployment readiness, not liveness, at it.
- **Blocks submission:** No. Deployment reliability improvement.

#### P2-05 — Frontend workflows have no automated behavior tests

- **Problem:** Only build/static delivery is automated; onboarding, plan forms, consume/retry, filtering, and error states have no component or browser tests.
- **Evidence:** `client/package.json` contains build/dev scripts but no test script; `test/static-security.integration.test.ts:24-76` validates serving and API protection, not UI interaction.
- **Impact:** UI/API wiring regressions may pass TypeScript and backend tests.
- **Recommended minimal fix:** Add a very small browser smoke covering create/connect, create user, consume/retry, and history using an isolated database. Avoid broad snapshot testing.
- **Blocks submission:** No, provided the demo is manually exercised before handoff.

#### P2-06 — Production operations are not yet defined

- **Problem:** There are no resource ceilings, backup/restore workflow, metrics/alerts, or controlled migration strategy for multiple replicas.
- **Evidence:** `docker-compose.yml:1-57`; README known limitations at `README.md:775-789`.
- **Impact:** A disk, hot tenant, runaway process, or failed host can cause prolonged outage or data loss; scaling startup can create avoidable migration contention.
- **Recommended minimal fix:** For the target VM, add measured resource reservations/limits, off-host backups with restore drill, disk/pool/lock/error monitoring, and one migration owner.
- **Blocks submission:** No for take-home scope. Yes before relying on it as a production service.

### P3 — Low

#### P3-01 — Entity `updated_at` values do not change on plan mutations

- **Problem:** Accounts, users, and plans define `updated_at`, but plan assignment/update statements do not set it.
- **Evidence:** `src/db/schema.ts:46-48,78-80,118-120`; `src/modules/accounts/account.service.ts:129-133`; `src/modules/users/user.service.ts:171-175`; `src/modules/plans/plan.service.ts:172-176`.
- **Impact:** Audit/debug timestamps are misleading even though quota behavior is correct.
- **Recommended minimal fix:** Set `updatedAt: new Date()` in those three mutations or use a database trigger consistently.
- **Blocks submission:** No.

#### P3-02 — Playground can hide initial context-load failures

- **Problem:** A plans/account-usage failure is shown only when the user field is non-empty.
- **Evidence:** `client/src/App.tsx:747-755`.
- **Impact:** The page can display unresolved placeholders without telling the user the API is unavailable.
- **Recommended minimal fix:** Always surface plan/account load failure; keep user-not-found handling specific when a user lookup was requested.
- **Blocks submission:** No.

#### P3-03 — Current plan display and user discovery are browser-local approximations

- **Problem:** Existing-key sessions infer current plan by allowance and only remember users created/looked up in that browser session.
- **Evidence:** `client/src/App.tsx:83-89,120-135,168-179,189-204`; `README.md:779-781`.
- **Impact:** Equal-limit plans can show no resolved current plan, and existing server users are not discoverable as a list.
- **Recommended minimal fix:** When product scope allows, return current plan identity from account/user detail and add paginated user listing. Preserve tenant scoping.
- **Blocks submission:** No; already documented.

#### P3-04 — Reproduction requires running ten independent test commands

- **Problem:** There is no aggregate integration script or CI workflow tying the isolated database, migration/seed, build, and ten suites together.
- **Evidence:** `package.json:9-28`; `README.md:674-702`.
- **Impact:** Reviewers can accidentally omit a suite and there is no single recorded regression gate.
- **Recommended minimal fix:** Add a non-destructive CI/aggregate command that requires an explicit test `DATABASE_URL` and refuses known development database names before running the scripts once.
- **Blocks submission:** No.

## 11. Final Submission Checklist

### Required before handoff

- [ ] Reconcile the tracked k6 summary with normal-load/stress claims, or remove claims that are not portable.
- [ ] Manually exercise the built React demo once in a browser: onboarding, existing-key connection, user, plans, consume/retry, rejection, history/filter/pagination, and a narrow viewport.
- [ ] Confirm no `.env`, API key, raw database URL, ignored benchmark artifact containing secrets, or local database data is staged.
- [ ] Keep the production audit result at zero; review the four dev-only moderate findings without using `npm audit fix --force`.
- [ ] Ensure the final submission points reviewers to the exact tested commit and states that the original specification is not stored in the repository.

### Recommended correctness hardening

- [ ] Define receipt-month versus serialization-month semantics and add a deterministic UTC rollover test.
- [ ] Add concurrent conflicting-ID, cross-user same-account, and rollback failure-injection integration cases.
- [ ] Fix misleading `updated_at` values.
- [ ] Add a small aggregate/CI integration runner guarded against development databases.

### Required before any public deployment

- [ ] Gate and rate-limit account creation; add identifier/body limits.
- [ ] Deploy behind HTTPS with reverse proxy/security headers and a restrictive firewall; do not expose PostgreSQL.
- [ ] Replace all development defaults with externally managed secrets.
- [ ] Do not use browser `sessionStorage` as the secret model for a production administration console.
- [ ] Add database readiness, backups plus restore testing, resource governance, and operational monitoring.
- [ ] Build and smoke-test the exact image on Linux ARM64; pin image digests for a repeatable release.

Subject to the evidence reconciliation above, the project is safe to submit as a strong take-home implementation. It should be described as a locally validated, concurrency-safe service and demo—not as an internet-production platform without the deployment controls listed here.
