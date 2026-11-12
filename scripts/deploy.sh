#!/bin/sh
set -eu

env_file=${1:?Pass the deployment environment file}
project=${2:-pawinn}

compose() {
    docker compose --env-file "$env_file" -p "$project" "$@"
}

# Validate the saved settings over the same network that the app services use.
existing_database=$(compose ps --all --quiet postgres)
if [ -n "$existing_database" ]; then
    running_database=$(compose ps --status running --quiet postgres)
    if [ -z "$running_database" ]; then
        compose start --wait --wait-timeout 60 postgres
    fi

    if ! compose run --rm --no-deps -T --entrypoint sh postgres -ec \
        'PGPASSWORD="$POSTGRES_PASSWORD" psql -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -w -Atqc "SELECT 1" >/dev/null'; then
        echo 'PostgreSQL rejected the deployment connection. Check that pawinn-env or pawinn-local.env matches the existing database.' >&2
        exit 1
    fi
fi

compose up -d --no-build --wait --remove-orphans
compose ps
