#!/bin/sh
set -eu
project="pawinn-verify-$(date +%s)-$$"
export POSTGRES_DB=pawinn_test POSTGRES_USER=pawinn_test
export POSTGRES_PASSWORD=temporary-verification-only
export JWT_SECRET=temporary-verification-signing-key-only-for-test
export POSTGRES_PORT=0 FRONTEND_PORT=0 PAWINN_SEED_DEMO=true
export PAWINN_TAG="${PAWINN_TAG:-verification}"
# Run Compose commands against this verification project.
compose() {
  docker compose --env-file .env.example -p "$project" -f compose.yaml -f tests/compose.verify.yaml "$@"
}
# Remove the disposable containers and volume when verification exits.
cleanup() {
  # This name was generated above and is never the deployment project.
  case "$project" in pawinn-verify-*) compose down --volumes --remove-orphans ;; esac
}
trap cleanup EXIT
compose up -d --build --wait postgres account room booking frontend
compose exec -T postgres psql -U pawinn_test -d pawinn_test -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/tests/verify.sql
export PAWINN_TEST_ADMIN_EMAIL="verify-admin@pawinn.test"
export PAWINN_TEST_ADMIN_PASSWORD="$(compose exec -T account node -p 'require("node:crypto").randomBytes(24).toString("hex")')"
printf '%s\n' "$PAWINN_TEST_ADMIN_PASSWORD" | compose exec -T account node bootstrap-admin.js "$PAWINN_TEST_ADMIN_EMAIL" "Verification Administrator"
compose run --rm --no-deps --build -e PAWINN_TEST_ADMIN_EMAIL -e PAWINN_TEST_ADMIN_PASSWORD verify
unset PAWINN_TEST_ADMIN_PASSWORD
# Confirm that a completed write survives both database and service restarts.
compose restart postgres booking
compose up -d --wait --no-deps postgres booking
compose exec -T postgres psql -U pawinn_test -d pawinn_test -Atqc "SELECT count(*) > 0 FROM booking_logs WHERE details = 'Full simulated refund recorded.'" | grep -qx t
echo 'PASS: booking history persisted through database and service restart.'
