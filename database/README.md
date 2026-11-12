# Shared PostgreSQL database

PawInn uses one PostgreSQL container with one database, `pawinn`. Account, Room and Booking each own writes to their tables, and share foreign keys and reads where needed.

- Account: users and pets.
- Room: room types and physical rooms.
- Booking: reservations, cancellation requests and booking logs.

From the repository root, set POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB and JWT_SECRET in .env, then run `docker compose up -d --build --wait`. On a fresh volume, init.sql creates the schema and inserts the initial 15 rooms. A normal deployment starts with no preloaded customer or staff accounts or bookings. Run `docker compose exec postgres psql -U pawinn -d pawinn` to inspect the schema, substituting your settings if different.

The Node services use postgres:5432 inside Compose. Host development uses the local published port. The database password is separate from an application password.

## Existing databases

PostgreSQL initialization runs only on a fresh data directory. The upgrade from the previous PawInn stack uses the same schema and preserves the existing volume and records. Do not delete the volume to apply this change. Fixture accounts and histories stay stored. Normal sign-in and staff booking views exclude them.

If you previously imported the original demo seed, run this once to release any rooms still reserved by those sample bookings. The script keeps their history and logs each previous status.

```sh
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/booking/retire-fixtures.sql'
```

## Test fixtures

Use `sh scripts/verify.sh` for a separate database named pawinn_test with the complete dataset. It sets PAWINN_SEED_DEMO=true on the disposable stack. The fixtures include two customers, one staff account, pets, 15 rooms and several booking states. Seed files are under the relevant service folders; seed.psql imports all of them. Never enable fixture accounts for a normal deployment.

The verified constraints include pet ownership, referenced-record deletion, date and price checks, and overlapping active bookings. Check-out dates are exclusive. Booking writes and Room inventory changes also acquire a short PostgreSQL transaction lock so that availability and inventory changes are ordered.
