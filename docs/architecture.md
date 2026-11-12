# PawInn architecture

The browser uses one origin served by Nginx. The frontend renders the HTML/Tailwind/Alpine pages, while Nginx routes JSON APIs to the relevant Express container.

| Paths | Service | Database responsibility |
| --- | --- | --- |
| /api/auth, /api/users, /api/pets | Account | Users, credentials and pet profiles |
| /api/room-types, /api/rooms | Room | Catalog and inventory |
| /api/availability, /api/bookings, /api/cancellations | Booking | Holds, payment status, cancellations and logs |

Each service has a database-aware /health endpoint. Only the frontend and the local PostgreSQL port are published on loopback by default. The three services use one PostgreSQL database and query shared related records where needed. This reduces course-project complexity; schema changes still require coordination.

Account issues expiring bearer tokens; the services verify issuer, audience and signature, then check the role from PostgreSQL. Pet access and booking access are scoped to the signed-in owner. Staff accounts are provisioned locally. Fixture accounts are disabled on a normal deployment.

Booking allocates available physical rooms and calculates prices in PostgreSQL. An advisory transaction lock serializes reservation and inventory changes for this small installation; exclusion constraints reject overlapping active holds even if another writer bypasses service logic. The service expires old holds before serving availability and booking operations. Checkout and refund actions are simulated and persist with their audit logs.

## Delivery

GitHub Actions and Jenkins execute `sh scripts/verify.sh` against a disposable Compose project. Jenkins tags the application images with the checked-out commit and deploys those same images on main on the same Docker engine. Configure a Linux multibranch Jenkins job with Docker Compose and curl, plus a secret-file credential named `pawinn-env` containing the deployment environment settings. The deployment project is named pawinn and preserves its database volume. Set the deployment port in that credential if necessary.

Run the verification script inside the assigned `tuchsanai/devtools:2569_1` course container using the instructor's startup instructions. Keep the commit, test output and Jenkins logs as evidence. Public internet hosting would need TLS and an operational review; the default setup is a local course deployment.
