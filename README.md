# PawInn

PawInn is a pet hotel booking portal. The HTML/Tailwind/Alpine frontend talks to Account, Room and Booking Express services, backed by one shared PostgreSQL database. Customers manage pets, find available rooms, reserve stays and request cancellation. Staff manage inventory and review requests. Checkout and refunds are simulated and collect no payment details.

## Run locally

Start Docker Desktop. Copy .env.example to .env if needed; use a local database password and a unique JWT_SECRET (at least 32 bytes). Keep .env out of Git.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build --wait
```

Open http://localhost:8080 (or FRONTEND_PORT), then register your customer account and add a pet. On a fresh volume PostgreSQL loads the schema and the initial catalog of 15 rooms. Test customers, staff and bookings are opt-in; normal startup does not seed them. Existing volumes are preserved.

To create a staff account, follow the [Account guide](services/account/README.md#provision-staff). Customers cannot register as staff.

## Verify the release

From Linux or a Docker-capable course shell, run `sh scripts/verify.sh`. It creates a disposable stack, runs SQL and HTTP checks, and removes only its own test containers and volume. See the [verification walkthrough](docs/local-demo.md) and [deployment notes](docs/architecture.md#delivery) for Jenkins setup and the course container.

The GitHub Actions workflow runs the same verification on pushes and PRs. Jenkins builds and verifies the commit, then deploys the tested images on main using the deployment .env credential. Do not treat local checks as formal course-container results.

## Project map

| Folder | Purpose |
| --- | --- |
| frontend | Customer/staff pages and Nginx routes |
| services/account | Registration, sign-in and pets |
| services/room | Catalog and inventory |
| services/booking | Reservations, simulated checkout, cancellations and audit history |
| database | Schema, initial room inventory, and optional test fixtures |
| scripts / tests | Disposable-stack verification |

See the [API agreement](docs/api.md), [database setup](database/README.md), and [team assignments](docs/team.md).
