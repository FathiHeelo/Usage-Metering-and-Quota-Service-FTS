#!/usr/bin/env bash

set -Eeuo pipefail

readonly health_url="http://127.0.0.1:3000/health"
readonly compose_service="api"
readonly environment_file=".env"

new_image="${1:-}"

if [[ ! "$new_image" =~ ^ghcr\.io/fathiheelo/usage-metering-and-quota-service-fts:sha-[0-9a-f]{40}$ ]]; then
  echo "Refusing to deploy a missing or mutable image reference." >&2
  exit 2
fi

if [[ ! -f docker-compose.yml || ! -f "$environment_file" ]]; then
  echo "docker-compose.yml and the server-owned .env file are required." >&2
  exit 2
fi

previous_container_id="$(docker compose ps -q "$compose_service")"
if [[ -z "$previous_container_id" ]]; then
  echo "Cannot determine the currently running API container for rollback." >&2
  exit 2
fi

previous_image="$(docker inspect --format '{{.Config.Image}}' "$previous_container_id")"
if [[ -z "$previous_image" ]]; then
  echo "Cannot determine the currently deployed API image for rollback." >&2
  exit 2
fi

wait_for_api() {
  local container_id
  local container_health

  for _ in $(seq 1 60); do
    container_id="$(docker compose ps -q "$compose_service")"
    if [[ -n "$container_id" ]]; then
      container_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$container_health" == "healthy" ]] && curl --fail --silent --show-error "$health_url" >/dev/null; then
        return 0
      fi
      if [[ "$container_health" == "unhealthy" || "$container_health" == "exited" || "$container_health" == "dead" ]]; then
        return 1
      fi
    fi
    sleep 3
  done

  return 1
}

start_api_image() {
  local image="$1"
  API_IMAGE="$image" docker compose up -d --no-deps --no-build --force-recreate "$compose_service"
}

persist_image_reference() {
  local image="$1"

  if grep -q '^API_IMAGE=' "$environment_file"; then
    sed -i "s|^API_IMAGE=.*$|API_IMAGE=$image|" "$environment_file"
  else
    printf '\nAPI_IMAGE=%s\n' "$image" >>"$environment_file"
  fi
}

rollback() {
  echo "Deployment health verification failed; restoring $previous_image." >&2
  if ! start_api_image "$previous_image"; then
    echo "ROLLBACK FAILED while restarting the previous image." >&2
    return 1
  fi
  if ! wait_for_api; then
    echo "ROLLBACK FAILED: the previous image did not become healthy." >&2
    return 1
  fi
  echo "Rollback completed successfully." >&2
}

echo "Pulling immutable image $new_image."
docker pull "$new_image"

echo "Replacing only the API service."
if ! start_api_image "$new_image" || ! wait_for_api; then
  rollback || true
  exit 1
fi

if ! persist_image_reference "$new_image"; then
  echo "Could not persist the deployed image reference." >&2
  rollback || true
  exit 1
fi

echo "Deployment succeeded and $health_url returned HTTP 2xx."
