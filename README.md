# PawInn

PawInn is a pet hotel booking portal for dogs and cats. Customers can check room availability, book a stay, and leave special-care instructions. Staff can manage room inventory, review booking changes, and send customers private text or photo updates.

**Payments and refunds are simulated.** PawInn does not collect card details or charge money.

## Start PawInn with Docker

You'll need **Git** and **Docker Compose**. Start Docker Desktop on Windows or macOS, or Docker Engine on Linux. You don't need to install Node.js or PostgreSQL separately.

1. Clone the repository:

   ```sh
   git clone https://github.com/Alexandria-IT/PawInn.git
   cd PawInn
   ```

2. Copy `.env.example` to `.env`: run `Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` on macOS/Linux. Open `.env` and set:
   - `POSTGRES_PASSWORD`: a password for your local database.
   - `JWT_SECRET`: a unique signing secret. Run the command below and paste its output as the value.

   ```sh
   docker run --rm node:24-alpine node -p "require('node:crypto').randomBytes(32).toString('hex')"
   ```

   Keep `PAWINN_SEED_DEMO=false` for regular use and keep `.env` out of Git.

3. Build and start the app:

   ```sh
   docker compose up -d --build --wait
   docker compose ps
   ```

4. Open [PawInn at localhost:8080](http://localhost:8080). On first startup, PawInn creates its database tables and adds **15 rooms** (five per room type).

## Try a booking

1. **Customer:** Choose **Sign in → Create an account**, then add a dog or cat under **My pets**. In **Our rooms**, choose dates and a compatible room. Select your pet and add any optional care instructions, then complete the simulated checkout.
2. **Booking changes:** Open **My bookings → View details** to request cancellation or reschedule an upcoming confirmed stay. Rescheduling moves the dates while keeping the same number of nights. The current reservation stays in place while staff reviews the request.
3. **Staff:** Sign in with a staff account (see below). Use **Change requests** to review requests. To read care instructions or send an update, go to **All bookings → Care & updates** on a confirmed booking.
4. **Customer:** Open **Pet Updates** to see your pet's messages and photos. Other customers cannot see them.

### Create a staff account

Use an email address that is new to PawInn and a password of at least 12 characters. Replace `staff@example.com` with the staff email.

**Windows (PowerShell 7):**

```powershell
$staffPassword = Read-Host "New staff password" -MaskInput
$staffPassword | docker compose exec -T account node staff.js staff@example.com "PawInn Staff"
Remove-Variable staffPassword
```

**macOS or Linux (Bash):**

```bash
read -r -s -p 'New staff password: ' staff_password
printf '\n'
printf '%s\n' "$staff_password" | docker compose exec -T account node staff.js staff@example.com "PawInn Staff"
unset staff_password
```

Sign in with that account to open the staff dashboard.

> **Release note:** The Admin portal, actual arrival and pickup, daily photo reports, individual care records, and rescheduling with price adjustments are not yet part of GitHub's `main` branch. The steps above work with the code available here today.

## Stop or troubleshoot

- **Stop:** `docker compose stop`. **Start again:** `docker compose up -d --wait`. PostgreSQL keeps your data in its Docker volume. Avoid `docker compose down -v` if you want to keep your data.
- **Check startup:** `docker compose ps -a` shows container status. Use `docker compose logs --tail=100` to see recent errors.
- **Change ports:** If `8080` or `5432` is in use, change `FRONTEND_PORT` or `POSTGRES_PORT` in `.env`, then rerun the startup command. Open the app on the new frontend port.

## Tests and Jenkins

- **Run tests locally:** In a shell with Docker access, run `sh scripts/verify.sh` from the repository root. It builds an isolated test stack, checks the database and booking flows, and removes its own test containers and database.
- **GitHub Actions** runs the verification script on pushes and pull requests.
- **Jenkins** checks out `main` by default, tests it, and deploys the tested images to the local Docker stack. Jenkins uses the same `.env` as a manual startup. Keep the original database settings when deploying over an existing PostgreSQL volume.

To start Jenkins, set `JENKINS_ADMIN_PASSWORD` in `.env`, then run:

```sh
docker compose --env-file .env -f infra/jenkins/compose.yaml up -d --build
```

Open [Jenkins at localhost:8081](http://localhost:8081), sign in as `admin` with that password, then choose **pawinn → Build Now**. See the [verification walkthrough](docs/local-demo.md) for the course demo.

## Project layout

| Folder | What's inside |
| --- | --- |
| `frontend/` | HTML, Tailwind CSS, Alpine.js, and Nginx |
| `services/account/` | Sign-in, registration, and pet profiles |
| `services/room/` | Room catalog and inventory |
| `services/booking/` | Availability, reservations, simulated checkout, change requests, and pet updates |
| `database/` | Shared PostgreSQL schema, room inventory, and optional test data |
| `scripts/` and `tests/` | Docker verification and integration tests |

The three backend services use Node.js and Express with one shared PostgreSQL database. See the [API guide](docs/api.md), [database guide](database/README.md), and [team assignments](docs/team.md).
