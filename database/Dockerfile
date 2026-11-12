# PostgreSQL with the PawInn SQL baked in (same layout as the old ./database bind mount).
# init.sql runs once on an empty volume; PAWINN_SEED_DEMO decides whether demo fixtures load.
FROM postgres:17-alpine
COPY . /docker-entrypoint-initdb.d/
