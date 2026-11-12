# PawInn

PawInn is a pet hotel booking portal for dogs and cats. Customers can check room availability, book a stay, and leave special-care instructions. Staff manage rooms, review booking changes, and record how pets are doing during their stay. Admins manage accounts and review account changes.

**Payments, reschedule adjustments, and refunds are simulated.** PawInn does not collect card details or charge money.

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

## Set up Admin and Staff access

The customer flow works without an Admin account. To try the staff dashboard, first create one Admin for your database. Use an unused email address and a password of at least 12 characters (up to 72 bytes). Replace `admin@example.com` with your email.

**Windows (PowerShell 7):**

```powershell
$adminPassword = Read-Host "New PawInn Admin password" -MaskInput
$adminPassword | docker compose exec -T account node bootstrap-admin.js admin@example.com "PawInn Admin"
Remove-Variable adminPassword
```

**macOS or Linux (Bash):**

```bash
read -r -s -p 'New PawInn Admin password: ' admin_password
printf '\n'
printf '%s\n' "$admin_password" | docker compose exec -T account node bootstrap-admin.js admin@example.com "PawInn Admin"
unset admin_password
```

Sign in to PawInn with the new Admin account. In **Account administration**, choose **Create staff account**. Use that Staff account to sign in to the staff dashboard. Admins can also change staff access, suspend or reactivate accounts, and see changes in **Audit history**.

## Try a booking

1. **Customer:** Choose **Sign in → Create an account** and add a dog or cat under **My pets**. Go to **Our rooms**, select your saved pet and dates, and choose a room. Add any special-care instructions and complete the simulated checkout. Use **Edit booking details** during checkout if you need to change the reservation before paying.
2. **Booking changes:** Open **My bookings → View details** on an upcoming confirmed stay to request cancellation or new dates. For a reschedule, review the new total and any simulated charge or refund before sending. The original dates stay booked while staff reviews the request.
3. **Staff:** Use **Change requests** to review booking changes. Under **All bookings → Stay care**, record actual arrival and pickup, publish daily reports with photos, and log individual care events. Use **Send a quick update** in the same screen to send an extra message or photo.
4. **Customer:** Open **Pet Updates** for published daily reports and quick updates. Select **View stay care** to open the booking's full care history, which is also available under **My bookings → View details → Care during stay**. The history stays available after pickup.

## Stop or troubleshoot

- **Stop:** `docker compose stop`. **Start again:** `docker compose up -d --wait`. PostgreSQL keeps your data in its Docker volume. Avoid `docker compose down -v` if you want to keep your data.
- **Check startup:** `docker compose ps -a` shows container status. Use `docker compose logs --tail=100` to see recent errors.
- **Change ports:** If `8080` or `5432` is in use, change `FRONTEND_PORT` or `POSTGRES_PORT` in `.env`, then rerun the startup command. Open the app on the new frontend port.

## Tests and Jenkins

- **Run tests locally:** In a shell with Docker access, run `sh scripts/verify.sh` from the repository root. It builds an isolated test stack, checks the database, booking, care, and Admin flows, and removes its own test containers and database.
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
| `services/account/` | Sign-in, registration, pet profiles, and Admin account management |
| `services/room/` | Room catalog and inventory |
| `services/booking/` | Availability, reservations, simulated checkout, change requests, stay care, and pet updates |
| `database/` | Shared PostgreSQL schema, room inventory, and optional test data |
| `scripts/` and `tests/` | Docker verification and integration tests |

The three backend services use Node.js and Express with one shared PostgreSQL database. See the [API guide](docs/api.md), [database guide](database/README.md), and [team assignments](docs/team.md).
