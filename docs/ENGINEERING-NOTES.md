# Engineering Notes

This file preserves deeper implementation context that is intentionally omitted from the reviewer-focused README.

## Transaction and locking model

Quota consumption runs in one PostgreSQL transaction. It captures the UTC month at request start, locks the authenticated account first, resolves and locks the user under that account, reads the current account and user plans, initializes monthly counter rows when absent, and locks those counters before deciding. Accepted requests update both counters and insert one `usage_requests` snapshot. Rejected requests update neither counter but still insert the decision snapshot. A failure at any persistence step rolls back the transaction.

Account-first ordering is also used by account plan changes, user plan changes, and owned custom-plan updates. That common serialization point prevents a consume transaction from combining old and new plan fields. It also means high traffic concentrated on one account can experience lock contention even when requests concern different users.

## Idempotency model

`usage_requests` has a unique `(account_id, request_id)` constraint. A retry with the same user and units returns the stored decision and snapshots. A retry that changes either field returns HTTP `409`. Concurrent inserts rely on PostgreSQL uniqueness as the final arbiter; the losing transaction re-reads the winning record and applies the same comparison. This design keeps idempotency account-scoped and durable across API restarts.

## Plan semantics

Predefined plans are global, have no owner, and are read-only. Custom plans belong to one account. Assignment checks both scope and ownership. Updating or switching a plan changes subsequent quota decisions without deleting or resetting monthly counters. Usage read endpoints return the current plan, while history returns immutable decision-time snapshots.

## Test evidence

- Real PostgreSQL integration tests cover accepted/rejected accounting, rollback, request conflicts, account isolation, plan-change serialization, UTC rollover, and cross-user contention.
- `npm run test:e2e` uses a labeled, ephemeral PostgreSQL 16 container with `tmpfs`, applies migrations and seed data, runs one Chromium workflow, and removes only that generated container.
- CI runs the active-plan and timestamp regressions against its isolated PostgreSQL service and runs Playwright in a separate required job with its own disposable database.
- k6 evidence and limitations are documented in [`../load-tests/results/README.md`](../load-tests/results/README.md); compact source-derived JSON summaries live in [`../load-tests/results/verified/`](../load-tests/results/verified/).
- The [October 15, 2026 final audit](FINAL_AUDIT_REPORT.md) is retained as a historical snapshot with a post-audit resolution summary.

## Operations

The production image is multi-stage and runs as a non-root user with production dependencies only. PostgreSQL pool size is configurable through `DB_POOL_MAX`; connection attempts have a finite timeout. Successful `/health` requests use a higher log level to avoid routine noise, while failures remain visible. Docker applies bounded `json-file` rotation to the API and database services.

Deployment details, IAM/OIDC setup, SSM commands, health verification, and rollback procedures are maintained in [CI-CD-SETUP.md](CI-CD-SETUP.md).
