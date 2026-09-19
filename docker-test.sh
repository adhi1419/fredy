#!/bin/sh
set -eu

RUN_SUFFIX=$$
APP_CONTAINER="fredy-test-$RUN_SUFFIX"
EMULATOR_CONTAINER="fredy-firestore-emulator-test-$RUN_SUFFIX"
NETWORK="fredy-test-$RUN_SUFFIX"

cleanup() {
  docker rm -f "$APP_CONTAINER" "$EMULATOR_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup

docker network create "$NETWORK" >/dev/null

docker run -d \
  --name "$EMULATOR_CONTAINER" \
  --network "$NETWORK" \
  gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud emulators firestore start --host-port=0.0.0.0:8080 >/dev/null

printf '%s\n' 'Waiting for the Firestore emulator...'
for i in $(seq 1 30); do
  if docker exec "$EMULATOR_CONTAINER" curl -sf http://127.0.0.1:8080/ >/dev/null 2>&1; then
    break
  fi
  if [ "$i" = "30" ]; then
    printf '%s\n' 'Firestore emulator did not become ready'
    docker logs "$EMULATOR_CONTAINER"
    exit 1
  fi
  sleep 2
done

# On Apple Silicon, force linux/amd64 to match production CI and avoid an
# arm64/x86_64 Chrome mismatch under Rosetta. Native Linux uses its own platform.
PLATFORM=""
if [ "$(uname -m)" = "arm64" ] && [ "$(uname -s)" = "Darwin" ]; then
  PLATFORM="linux/amd64"
fi

if [ "${SKIP_BUILD:-false}" != "true" ]; then
  printf '%s\n' 'Building the Firestore-only image...'
  if [ -n "$PLATFORM" ]; then
    docker build --no-cache --platform "$PLATFORM" -t fredy:local .
  else
    docker build --no-cache -t fredy:local .
  fi
fi

RUN_ARGS="--name $APP_CONTAINER --network $NETWORK -e NODE_ENV=development -e FIRESTORE_EMULATOR_HOST=$EMULATOR_CONTAINER:8080 -e FIRESTORE_PROJECT_ID=fredy-docker-test"
if [ -n "$PLATFORM" ]; then
  # shellcheck disable=SC2086
  docker run -d $RUN_ARGS --platform "$PLATFORM" fredy:local >/dev/null
else
  # shellcheck disable=SC2086
  docker run -d $RUN_ARGS fredy:local >/dev/null
fi

printf '%s\n' 'Waiting for Fredy...'
for i in $(seq 1 30); do
  if docker exec "$APP_CONTAINER" curl -sf http://localhost:9998/ >/dev/null 2>&1; then
    break
  fi
  if [ "$i" = "30" ]; then
    printf '%s\n' 'Fredy did not become ready'
    docker logs "$APP_CONTAINER"
    exit 1
  fi
  sleep 2
done

printf '%s\n' 'Testing Firestore through /api/demo...'
DEMO_RESPONSE=$(docker exec "$APP_CONTAINER" curl -sf http://localhost:9998/api/demo 2>&1)
case "$DEMO_RESPONSE" in
  '{}'|*'"demoMode"'*) printf '%s\n' 'Firestore settings are readable through the API' ;;
  *)
    printf '%s\n' "Firestore read check failed: $DEMO_RESPONSE"
    docker logs "$APP_CONTAINER"
    exit 1
    ;;
esac

# Write and read a disposable marker through the emulator REST API. This validates
# storage independently of the removed password/admin bootstrap path.
MARKER_URL='http://127.0.0.1:8080/v1/projects/fredy-docker-test/databases/(default)/documents/docker_smoke/marker'
MARKER_RESPONSE=$(docker exec "$EMULATOR_CONTAINER" curl -sf -X PATCH "$MARKER_URL" \
  -H 'Content-Type: application/json' \
  -d '{"fields":{"status":{"stringValue":"ok"}}}')
if echo "$MARKER_RESPONSE" | grep -q '"status"'; then
  printf '%s\n' 'Firestore write check passed'
else
  printf '%s\n' "Firestore write check failed: $MARKER_RESPONSE"
  exit 1
fi

printf '%s\n' 'Testing the bundled browser...'
CHROME=$(docker exec "$APP_CONTAINER" sh -c "find /root/.cloakbrowser /root/.cache /home -type f \\( -name chrome -o -name chromium \\) 2>/dev/null | head -1")
if [ -z "$CHROME" ]; then
  printf '%s\n' 'Chrome/Chromium binary not found'
  exit 1
fi
if docker exec "$APP_CONTAINER" "$CHROME" --headless --no-sandbox --disable-gpu --dump-dom https://example.com 2>&1 | grep -q '<html'; then
  printf '%s\n' 'Bundled browser works'
else
  printf '%s\n' 'Bundled browser failed to render a page'
  exit 1
fi

printf '\n%s\n' 'All Docker smoke checks passed.'
