# PawInn

PawInn is a pet hotel booking portal. The HTML/Tailwind/Alpine frontend talks to Account, Room and Booking Express services, backed by one shared PostgreSQL database. Customers manage pets, find available rooms, reserve stays, and request cancellation or rescheduling. Staff manage inventory, review requests, and record actual arrival, pickup, daily reports and individual care events. Customers can leave special-care instructions, read informal messages on **Pet Updates**, and open **Care during stay** from a booking for its dated history. Admins manage accounts and review account changes. Payments, reschedule adjustments and refunds are simulated.

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

### 4. Create the first Admin and add staff

Use an email that is new to PawInn and a password of at least 12 characters. Replace `admin@example.com` in the command you use. Run this once on your installation; there is no default PawInn Admin password.

Windows PowerShell 7

```powershell
$adminPassword = Read-Host "New PawInn Admin password" -MaskInput
$adminPassword | docker compose exec -T account node bootstrap-admin.js admin@example.com "PawInn Admin"
Remove-Variable adminPassword
```

macOS or Linux in Bash

```bash
read -r -s -p 'New PawInn Admin password: ' admin_password
printf '\n'
printf '%s\n' "$admin_password" | docker compose exec -T account node bootstrap-admin.js admin@example.com "PawInn Admin"
unset admin_password
```

Sign in with the Admin account to open **Account administration**. Create a Staff account there, then sign in with it to open the staff dashboard. For confirmed stays, use **All bookings → Stay care** to record attendance and care. Customers can open the same stay’s history from **My bookings → Details → Care during stay**.

### Stop, restart, and troubleshoot

- Run `docker compose stop` to stop PawInn and `docker compose up -d --wait` to start it again. PostgreSQL keeps accounts and bookings in its named volume.
- If a container fails to start, check `docker compose ps -a` and `docker compose logs --tail=100`.
- If port `8080` is occupied, set `FRONTEND_PORT` to a free port in `.env` and open PawInn on that port. If `5432` is occupied, change `POSTGRES_PORT`. Run the startup command again after editing `.env`.

## Run Jenkins in Docker

Complete the `.env` setup above. From the repository root, start the controller:

```sh
docker compose --env-file .env -f infra/jenkins/compose.yaml up -d --build
```

Open [local Jenkins](http://localhost:8081), sign in, and choose **pawinn → Build Now**. The local demo login is `admin` / `pawinn`. Set `JENKINS_ADMIN_PASSWORD` in `.env` before starting Jenkins to choose your own password.

Jenkins checks out `main`, runs the tests in Docker, and deploys the tested images. The controller mounts the existing `.env` read-only, so a deployment uses the same PostgreSQL credentials and ports as a manual startup. The Jenkins and PostgreSQL volumes retain their state when the containers stop. The setup uses Docker Compose and runs Node.js, PostgreSQL, and Jenkins in containers.

## Verify the release

From Linux or a Docker-capable course shell, run `sh scripts/verify.sh`. It creates a disposable stack, runs SQL and HTTP checks, and removes only its own test containers and volume. See the [verification walkthrough](docs/local-demo.md) and [deployment notes](docs/architecture.md#delivery) for Jenkins setup and the course container.

The GitHub Actions workflow runs the same verification on pushes and PRs. Jenkins builds and verifies the commit, then deploys the tested images from main using the configured deployment settings. Do not treat local checks as formal course-container results.

## Project map

| Folder | Purpose |
| --- | --- |
| frontend | Customer/staff pages and Nginx routes |
| services/account | Registration, sign-in, pets, and Admin account management |
| services/room | Catalog and inventory |
| services/booking | Reservations, simulated checkout and adjustments, change requests, stay care and audit history |
| database | Schema, initial room inventory, and optional test fixtures |
| scripts / tests | Disposable-stack verification |

See the [API agreement](docs/api.md), [database setup](database/README.md), and [team assignments](docs/team.md).
