# Usage Metering and Quota Service

Backend foundation built with Node.js, TypeScript, Fastify, PostgreSQL, and Drizzle ORM.

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
   docker compose up -d
   ```

4. Start the API in development mode:

   ```bash
   npm run dev
   ```

5. Test the health endpoint:

   ```bash
   curl http://localhost:3000/health
   ```

   Expected response: `{"status":"ok"}`

## Build and run

```bash
npm run build
npm start
```

Database commands are available as `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, and `npm run db:studio`.

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

`POST /usage/consume` atomically evaluates account and user quotas for the authenticated account. Requests are idempotent per account and `requestId`. Account usage is locked before user usage to prevent overspending under concurrency. BIGINT units, usage, and remaining values are returned as decimal strings.
