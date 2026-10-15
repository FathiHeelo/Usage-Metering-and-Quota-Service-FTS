# Usage Metering and Quota Service

A quota-safe metering API with a React demo console, built with Node.js, TypeScript, Fastify, PostgreSQL, Drizzle ORM, and Vite.

## Development setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env`.

3. Start PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

4. Start the API in development mode:

   ```bash
   npm run dev
   ```

   In another terminal, start the Vite client:

   ```bash
   npm run dev:client
   ```

   The development UI is available at `http://localhost:5173` and proxies API calls to the Fastify server.

5. Test the health endpoint:

   ```bash
   curl http://localhost:3000/health
   ```

   Expected response: `{"status":"ok"}`

## Docker setup

Build and start the demo UI, API, and PostgreSQL together:

```bash
docker compose up --build
```

Compose builds the React client as static assets and serves it from the existing Fastify runtime, so no separate frontend process runs in production. It waits for PostgreSQL to become healthy, then applies committed migrations, seeds the predefined plans, and starts Fastify. Migration or seed failures stop API startup instead of launching against an incomplete database.

Open the demo UI at `http://localhost:3000`. The API uses the same origin; for example, health is available at `http://localhost:3000/health`. PostgreSQL is available only to containers on the Compose network, and its persistent data remains in the `postgres_data` volume.

In another terminal, inspect service health and API logs:

```bash
docker compose ps
docker compose logs -f api
curl http://localhost:3000/health
```

Stop the stack safely with `Ctrl+C` followed by:

```bash
docker compose down
```

PostgreSQL data is stored in the named `postgres_data` volume, so normal stops, restarts, and `docker compose down` preserve existing data. Do not use `docker compose down -v` casually: the `-v` option permanently deletes the database volume and all data stored in it.

## Build and run

```bash
npm run build
npm start
```

Database commands are available as `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, and `npm run db:studio`.

## Demo walkthrough

1. Open `http://localhost:3000` and create a demo account. Save the API key shown once; the backend stores only its SHA-256 hash.
2. To reconnect later, paste the key into **Existing key**. The demo keeps it only in browser session storage and sends it in the `X-API-Key` header—never in URLs or console logs.
3. Open **Users**, create an external identifier such as `user_001`, and inspect its live monthly usage.
4. Open **Plans** to compare predefined and custom plans, create or edit a custom plan, or change an account/user assignment. Plan changes preserve existing usage.
5. Open **Usage playground**, select a user, enter units, and submit a unique request ID. The result explains whether both account and user quota checks accepted or rejected the request.
6. Choose **Retry same request** to reuse the exact identifier and payload. The API returns the original idempotent decision without consuming twice.
7. Open **Request history** to filter and page through accepted and rejected decisions, including their stored usage snapshots.

The dashboard explains quota terminology inline. Monthly allowances use UTC calendar months. The current backend has no user-list endpoint, so the demo remembers only user identifiers created or successfully looked up during the active browser session; all usage and decision data is still fetched from the API.

## Database schema

Generate and apply migrations, then seed the predefined plans:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

The seed is idempotent and can be run multiple times safely. PostgreSQL `bigint` values are represented as JavaScript `bigint` values by the Drizzle schema.

## Create an account

`POST /accounts` accepts a JSON body such as `{"name":"DocuApp"}`. A new account starts on the predefined Starter ACCOUNT plan and receives a newly generated API key. The raw API key is returned only in this creation response; PostgreSQL stores only its SHA-256 hash and identification prefix.

## API-key authentication

Protected endpoints accept the raw API key in the `X-API-Key` header. `GET /me` is a small protected endpoint that returns the authenticated account. Missing, invalid, and revoked keys receive `401 Unauthorized`; `GET /health` and `POST /accounts` remain public.

## Create a user

`POST /users` requires `X-API-Key` and accepts `{"externalUserId":"user_001"}`. The user belongs to the authenticated account and starts on the predefined Basic USER plan. The same external user ID may be used by different accounts, but it must be unique within each account.

`PATCH /users/:externalUserId/plan` changes an authenticated account's own user to an accessible USER plan. It updates only the user's current plan; existing monthly usage remains unchanged.

## Custom plans

Authenticated accounts can create custom plans with `POST /plans`, list global and account-owned plans with `GET /plans`, and update their own custom plans with `PATCH /plans/:planId`. Predefined plans are read-only and return HTTP 403 when an update is attempted. BIGINT limits are returned as decimal strings for lossless JSON serialization.

`PATCH /account/plan` changes the authenticated account to an accessible ACCOUNT plan. It updates only the account's current plan and preserves existing monthly usage.

## Consume usage

`POST /usage/consume` atomically evaluates account and user quotas for the authenticated account. Requests are idempotent per account and `requestId`. Quota-affecting operations lock in the order account, user when applicable, account monthly usage, then user monthly usage. Account/user plan switches and custom-plan updates share the account lock, so the transaction that obtains it first determines whether old or new limits apply; consume re-reads assignments and limits after that lock. BIGINT units, usage, and remaining values are returned as decimal strings.

Authenticated usage reads are available from `GET /usage/account`, `GET /usage/users/:externalUserId`, and the paginated `GET /usage/history`. Monthly summaries use current plan limits, while history returns stored decision snapshots. BIGINT fields are serialized as decimal strings.
