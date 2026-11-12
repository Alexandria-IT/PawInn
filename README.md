# PawInn

PawInn is a pet hotel booking portal. The HTML/Tailwind/Alpine frontend talks to Account, Room and Booking Express services, backed by one shared PostgreSQL database. Customers manage pets, find available rooms, reserve stays and request cancellation. Staff manage inventory and review requests. Checkout and refunds are simulated and collect no payment details.

## Run from scratch

Install Git and Docker with the `docker compose` command. Start Docker Desktop on Windows or macOS, or start Docker Engine on Linux. Docker builds the app and runs PostgreSQL, so you can use the same setup on each platform.

### 1. Clone the repository

```sh
git clone https://github.com/Alexandria-IT/PawInn.git
cd PawInn
```

### 2. Configure your local environment

Create `.env` from the template. On Windows PowerShell, run `Copy-Item .env.example .env`. On macOS or Linux, run `cp .env.example .env`.

- Set `POSTGRES_PASSWORD` to a password for your local database.
- Set `JWT_SECRET` to a unique signing secret of at least 32 bytes. Run the command below and paste its output as the value.

```sh
docker run --rm node:24-alpine node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Keep `PAWINN_SEED_DEMO=false` for regular use and keep `.env` out of Git.

### 3. Start PawInn

```sh
docker compose up -d --build --wait
docker compose ps
```

Open [PawInn](http://localhost:8080) when the containers are healthy. The first startup creates the database tables and adds 15 rooms. To try the customer flow, choose **Sign in**, create an account, add a pet under **My Pets**, then choose a room and dates under **Our Rooms**.

### 4. Create a staff account

Use an email that is new to PawInn and a password of at least 12 characters. Replace `staff@example.com` in the command you use.

Windows PowerShell 7

```powershell
$staffPassword = Read-Host "New staff password" -MaskInput
$staffPassword | docker compose exec -T account node staff.js staff@example.com "PawInn Staff"
Remove-Variable staffPassword
```

macOS or Linux in Bash

```bash
read -r -s -p 'New staff password: ' staff_password
printf '\n'
printf '%s\n' "$staff_password" | docker compose exec -T account node staff.js staff@example.com "PawInn Staff"
unset staff_password
```

Sign in with the new staff account to open the dashboard.

### Stop, restart, and troubleshoot

- Run `docker compose stop` to stop PawInn and `docker compose up -d --wait` to start it again. PostgreSQL keeps accounts and bookings in its named volume.
- If a container fails to start, check `docker compose ps -a` and `docker compose logs --tail=100`.
- If port `8080` is occupied, set `FRONTEND_PORT` to a free port in `.env` and open PawInn on that port. If `5432` is occupied, change `POSTGRES_PORT`. Run the startup command again after editing `.env`.

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
