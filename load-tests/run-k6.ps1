param(
  [Parameter(Position = 0)]
  [ValidateSet("smoke", "load", "stress", "concurrency", "idempotency")]
  [string]$Test = "smoke",

  [string]$BaseUrl = "http://host.docker.internal:3000",

  [string]$Environment = "local Docker Compose"
)

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$mount = "${scriptDirectory}:/scripts"

docker run --rm -i `
  --add-host host.docker.internal:host-gateway `
  --volume $mount `
  --workdir /scripts `
  --env "BASE_URL=$BaseUrl" `
  --env "TEST_ENVIRONMENT=$Environment" `
  grafana/k6:1.8.2 run "$Test.js"

exit $LASTEXITCODE
