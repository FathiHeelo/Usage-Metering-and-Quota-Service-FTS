# CI/CD Setup

This repository contains a GitHub Actions pipeline for validating the application, publishing an immutable container image to GitHub Container Registry (GHCR), and updating only the API service on the existing EC2 host through AWS Systems Manager (SSM).

The workflow files do not make an AWS deployment active by themselves. A repository owner must complete the one-time GitHub, AWS, GHCR, and EC2 configuration below. No long-lived AWS access key or SSH private key is required by GitHub Actions.

## Delivery flow

```text
pull request -> CI build + PostgreSQL integration tests

push to main -> CI build + PostgreSQL integration tests
             -> publish ghcr.io/...:sha-<40-character-commit>
             -> successful CI workflow_run
             -> GitHub OIDC assumes a restricted AWS role
             -> SSM runs scripts/deploy-api.sh on the one EC2 instance
             -> pull exact image, replace only api, wait for health
             -> retain deployment or automatically restore prior image
```

`.github/workflows/ci.yml` is the only publisher. It also writes `latest` for human convenience, but deployment never reads that mutable tag. `.github/workflows/deploy.yml` derives its image tag from the exact commit SHA reported by the successful CI run.

## What CI executes

Both pull requests targeting `main` and pushes to `main` receive:

1. Clean backend and frontend dependency installs with `npm ci`.
2. A disposable PostgreSQL 16 service named `quota_edge_test_ci`.
3. Database migrations and predefined-plan seed.
4. One backend/frontend production build.
5. The existing PostgreSQL integration suites, including static-route security and deterministic concurrency/rollback cases.

The edge-case suite receives both `QUOTA_EDGE_TEST_DATABASE=1` and a database name matching its destructive-test guard. It cannot target the Compose development database. Manual concurrency and k6 workloads are intentionally excluded.

## Required GitHub configuration

Create a GitHub Environment named `production`. Add deployment reviewers if appropriate, then define these **environment variables** (not repository secrets):

| Variable | Example | Purpose |
| --- | --- | --- |
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/github-quota-production-deploy` | Role assumed through GitHub OIDC. |
| `AWS_REGION` | `us-east-1` | Region containing the EC2 instance and SSM endpoint. |
| `EC2_INSTANCE_ID` | `i-0123456789abcdef0` | The only deployment target. |
| `EC2_APP_DIR` | `/opt/usage-metering-quota` | Directory containing the server-owned Compose files and `.env`. |

These values identify infrastructure but do not authenticate to it. Keep production passwords and application secrets only in the server-owned `.env`; the deployment workflow neither reads nor replaces them.

For branch protection, require the `Build and integration tests` status before merging to `main`. Environment approval can provide a second gate before the deploy job obtains its OIDC token.

## Configure GitHub OIDC in AWS

Create the GitHub Actions OIDC identity provider if the AWS account does not already have one:

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Create an IAM role with this trust policy, replacing the AWS account ID only where needed for your setup. The `sub` value deliberately binds the role to this repository's `production` GitHub Environment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:FathiHeelo/Usage-Metering-and-Quota-Service-FTS:environment:production"
        }
      }
    }
  ]
}
```

GitHub's OIDC subject format can evolve. Confirm the actual environment subject for this repository when creating the trust policy; do not widen it to all repositories or all branches to work around a mismatch.

Attach a deployment policy like the following to the role. Replace region, account ID, and instance ID. `GetCommandInvocation` requires `Resource: "*"`; `SendCommand` remains restricted to AWS's shell document and the single target instance.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RunDeploymentOnOneInstance",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ssm:us-east-1::document/AWS-RunShellScript",
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0"
      ]
    },
    {
      "Sid": "ReadDeploymentResult",
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

Do not grant this GitHub role EC2 SSH, broad `ssm:*`, IAM administration, or access to application secrets.

## Prepare the EC2 instance

1. Attach an EC2 instance profile containing `AmazonSSMManagedInstanceCore`, or an equivalent narrower policy that lets SSM Agent register and receive commands.
2. Confirm the managed node appears online in Systems Manager and that SSM Agent is running:

   ```bash
   sudo systemctl status amazon-ssm-agent
   ```

3. Confirm Docker, the Compose plugin, `curl`, `base64`, `grep`, and `sed` are installed. SSM's standard shell document runs with elevated privileges, so tightly restricting who may call `SendCommand` is essential.
4. Keep the existing application checkout, `docker-compose.yml`, server-only `docker-compose.override.yml`, and `.env` in `EC2_APP_DIR`. Never commit the override or production `.env`.
5. Add the currently deployed immutable image to the server `.env` when activating image-based deployment:

   ```dotenv
   API_IMAGE=ghcr.io/fathiheelo/usage-metering-and-quota-service-fts:sha-<40-character-commit>
   ```

6. Preserve the server-only override's Caddy/network settings, but ensure it does not hard-code a different `api.image`. The base Compose file already resolves `${API_IMAGE}` and still supports `docker compose up --build` locally.
7. Keep the API published only on `127.0.0.1:3000`; Caddy remains the public entry point. Set `TRUSTED_PROXY_IPS` to the actual proxy-side address or CIDR observed by Fastify.

The deployment script executes `docker compose up --no-deps --no-build` for the `api` service. It does not recreate PostgreSQL, Caddy, the Compose network, or named volumes. Container startup still runs the existing migrations and seed before starting Fastify, so future migrations must remain backward compatible with the immediately previous image for rollback to be safe.

## Configure GHCR access

The CI workflow publishes with its scoped `GITHUB_TOKEN`; no package token is stored in the repository.

The simplest EC2 setup is to make the GHCR package public, allowing anonymous `docker pull`. If the package remains private, authenticate Docker on the instance ahead of deployment with a read-only GitHub Packages credential. Store that credential only in the instance's root-owned Docker credential store or retrieve it from an instance-authorized secret service. Do not add it to Compose, the repository, workflow output, or SSM command text.

Verify access on EC2 with an immutable tag before enabling deployment:

```bash
docker pull ghcr.io/fathiheelo/usage-metering-and-quota-service-fts:sha-<40-character-commit>
```

## Activate and verify

1. Merge the workflow changes and confirm a pull request run passes.
2. Confirm a push to `main` publishes both the immutable SHA tag and the optional `latest` tag in GHCR.
3. Complete the AWS role, instance profile, GitHub Environment, variables, package visibility, and EC2 preparation above.
4. Manually dispatch is intentionally not configured. The first deployment begins only after the next successful `CI` run caused by a push to `main`.
5. Watch the `Deploy production` workflow. It reports the SSM command ID, remote status, and sanitized deployment output.
6. Verify `https://quota-fts.duckdns.org/health` and one authenticated read-only endpoint after deployment.

This repository change was validated locally only. It does not assert that the AWS role, SSM managed node, GHCR visibility, or first live deployment has been configured successfully.

## Health verification and rollback

The remote script:

- rejects `latest` and any image not matching the expected 40-character SHA tag;
- records the running container's actual image before making a change;
- pulls the new image before replacing anything;
- recreates only `api` without building on EC2;
- waits up to three minutes for Docker health plus an HTTP 2xx from `http://127.0.0.1:3000/health`;
- restores the previous image automatically if startup or health verification fails; and
- writes only the successful immutable `API_IMAGE` value back to `.env`, leaving all other values intact.

If both deployment and automatic rollback fail, the workflow fails loudly and the EC2 host requires operator intervention. To roll back a healthy release deliberately, run `scripts/deploy-api.sh` on the instance with an older known-good immutable SHA image. The script's current guard permits only this repository's SHA-tagged images.

## Monitoring and troubleshooting

Start with the GitHub Actions run and its SSM command ID, then inspect the command in Systems Manager. On the instance, useful read-only checks are:

```bash
cd /opt/usage-metering-quota
docker compose ps
docker compose logs --tail=100 api
curl --fail --show-error http://127.0.0.1:3000/health
sudo systemctl status amazon-ssm-agent
```

Common failure causes:

| Symptom | Check |
| --- | --- |
| OIDC credential step fails | Trust-policy `aud`/`sub`, role ARN, GitHub Environment name, and `id-token: write`. |
| `AccessDeniedException` from SSM | Role policy region/account/instance ARN and `AWS-RunShellScript` document permission. |
| Instance is not online | Instance profile, SSM Agent, outbound HTTPS/DNS, and AWS region. |
| `docker pull` is denied | GHCR package visibility or the instance's read-only registry login. |
| New container is unhealthy | API logs, database health, migrations, `.env`, and loopback health endpoint. |
| Deployment rolls back | The new image failed Docker or HTTP health checks; inspect SSM output and API logs before retrying. |
| Workflow does not deploy | Confirm the triggering `CI` run was a successful push to `main`, not a pull request run. |

Deployment concurrency is serialized with `cancel-in-progress: false`; a newer release waits instead of interrupting an active deployment and its rollback window.
