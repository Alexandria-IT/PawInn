# PawInn

PawInn is a pet hotel booking portal for dogs and cats. Customers can check room availability, book a stay, and leave special-care instructions. Staff manage rooms, review booking changes, and record how pets are doing during their stay. Admins manage accounts and review account changes.

**Payments, reschedule adjustments, and refunds are simulated.** PawInn does not collect card details or charge money.

## Run inside the DevTools course container

**Required for grading.** Run PawInn’s Docker Compose stack inside `tuchsanai/devtools:2569_1`. The course container runs its own Docker engine. Your computer connects to PawInn through the SSH tunnel below. [DevTools course image](https://github.com/Tuchsanai/DevTools/blob/main/00_Tool/00_Reference/readme.md)

### 1. Start and connect to the course container

Run these commands on your computer with Docker running:

```powershell
docker run -dit --name devtools --privileged -p 127.0.0.1:2222:22 tuchsanai/devtools:2569_1
ssh -o ExitOnForwardFailure=yes -p 2222 -L 127.0.0.1:8082:127.0.0.1:8080 root@127.0.0.1
```

If `devtools` already exists with SSH mapped to port `2222`, skip `docker run`. If it is stopped, run `docker start devtools` before connecting. Use the SSH password from the course guide.

### 2. Clone PawInn and configure the environment

Run these commands **inside the SSH session**:

```sh
docker info --format '{{.ServerVersion}}'
cd /workspace
git clone https://github.com/Alexandria-IT/PawInn.git
cd PawInn

if [ ! -f .env ]; then
  cp .env.example .env
  db_password="$(node -p "require('node:crypto').randomBytes(24).toString('hex')")"
  jwt_secret="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
  sed -i -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$db_password/" \
    -e "s/^JWT_SECRET=.*/JWT_SECRET=$jwt_secret/" .env
  unset db_password jwt_secret
fi
```

If you already cloned PawInn inside the course container, enter that directory and run the `.env` setup there. The SSH command assumes `FRONTEND_PORT=8080` inside the course container.

### 3. Choose whether to load demo data

Before the first `docker compose up`, open `.env` and choose a value for `PAWINN_SEED_DEMO`:

- **`false` (default)** starts with 15 rooms and an empty user table. Customers can register in the app. Follow the [Admin and Staff setup](#set-up-admin-and-staff-access) to create those accounts.
- **`true`** also loads sample users, pets, and bookings. Use this for grading if you want accounts and bookings ready to try.

The demo accounts all use the password **`PawInnDemo123!`**.

| Role | Name | Sign-in email |
| --- | --- | --- |
| Customer | Jamie Parker | `jamie@pawinn.demo` |
| Customer | Alex Morgan | `alex@pawinn.demo` |
| Staff | PawInn Team | `team@pawinn.demo` |

Create the first **Admin** separately using the [setup below](#set-up-admin-and-staff-access). PostgreSQL loads the demo accounts only when it initializes a **fresh database volume**. Changing the flag and restarting an existing database won’t add them. [Seed accounts](database/account/seed.sql) · [Database setup](database/README.md)

### 4. Start PawInn and open it on your computer

In the SSH session, run:

```sh
docker compose up -d --build --wait
docker compose ps
curl -fsS http://127.0.0.1:8080/api/room-types
```

Keep the SSH session open and visit [PawInn at 127.0.0.1:8082](http://127.0.0.1:8082) in your computer’s browser. If you change `FRONTEND_PORT`, update the last port in the SSH `-L` option and the `curl` URL to match. If your computer’s port `8082` is busy, change the first port in `-L` and use that port in your browser.

## Set up Admin and Staff access

If you enabled demo data, you can sign in as Staff with the account above. For Admin access, run the following once **inside the course container**, from the PawInn directory. Replace `admin@example.com` with an unused email address and choose a password of at least 12 characters (up to 72 bytes).

```bash
read -r -s -p 'New PawInn Admin password: ' admin_password
printf '\n'
printf '%s\n' "$admin_password" | docker compose exec -T account node bootstrap-admin.js admin@example.com "PawInn Admin"
unset admin_password
```

Sign in to PawInn with the new Admin account. To add a staff member, choose **Create staff account** in **Account administration**, then sign in as that Staff user to open the dashboard. Admins can also change staff access, suspend or reactivate accounts, and see changes in **Audit history**.

## Try a booking

1. **Customer:** Choose **Sign in → Create an account** and add a dog or cat under **My pets**. Go to **Our rooms**, select your saved pet and dates, and choose a room. Add any special-care instructions and complete the simulated checkout. Use **Edit booking details** during checkout if you need to change the reservation before paying.
2. **Booking changes:** Open **My bookings → View details** on an upcoming confirmed stay to request cancellation or new dates. For a reschedule, review the new total and any simulated charge or refund before sending. The original dates stay booked while staff reviews the request.
3. **Staff:** Use **Change requests** to review booking changes. Under **All bookings → Stay care**, record actual arrival and pickup, publish daily reports with photos, and log individual care events. Use **Send a quick update** in the same screen to send an extra message or photo.
4. **Customer:** Open **Pet Updates** for published daily reports and quick updates. Select **View stay care** to open the booking's full care history, which is also available under **My bookings → View details → Care during stay**. The history stays available after pickup.

## Stop or troubleshoot

- **Stop:** `docker compose stop`. **Start again:** `docker compose up -d --wait`. PostgreSQL keeps your data in its Docker volume. Avoid `docker compose down -v` if you want to keep your data.
- **Check startup:** `docker compose ps -a` shows container status. Use `docker compose logs --tail=100` to see recent errors.
- **Change ports:** If `8080` or `5432` is busy inside the course container, change `FRONTEND_PORT` or `POSTGRES_PORT` in `.env` and rerun the startup command. If you changed `FRONTEND_PORT`, reconnect with the new destination port in the SSH command.

## Tests and Jenkins

- **Run tests:** Inside the course container, run `sh scripts/verify.sh` from the repository root. It builds an isolated test stack, checks the database, booking, care, and Admin flows, and removes its own test containers and database.
- **GitHub Actions** runs the verification script on pushes and pull requests.
- **Jenkins** checks out `main` by default, tests it, and deploys the tested images to the local Docker stack. Jenkins uses the same `.env` as a manual startup. Keep the original database settings when deploying over an existing PostgreSQL volume.

To start Jenkins for the CI/CD demo, set `JENKINS_ADMIN_PASSWORD` in `.env`, then run this **inside the course container**:

```sh
docker compose --env-file .env -f infra/jenkins/compose.yaml up -d --build
```

From a second terminal **on your computer**, forward the Jenkins port:

```powershell
ssh -N -o ExitOnForwardFailure=yes -p 2222 -L 127.0.0.1:8083:127.0.0.1:8081 root@127.0.0.1
```

Open [Jenkins at 127.0.0.1:8083](http://127.0.0.1:8083), sign in as `admin` with the password you set, then choose **pawinn → Build Now**. See the [verification walkthrough](docs/local-demo.md) for the course demo.

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
