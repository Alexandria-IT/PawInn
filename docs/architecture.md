# PawInn architecture

The browser uses one origin served by Nginx. The frontend renders the HTML/Tailwind/Alpine pages, while Nginx routes JSON APIs to the relevant Express container.

| Paths | Service | Database responsibility |
| --- | --- | --- |
| /api/auth, /api/users, /api/pets | Account | Users, credentials, and pet profiles |
| /api/room-types, /api/rooms | Room | Catalog and inventory |
| /api/availability, /api/bookings, /api/cancellations | Booking | Holds, simulated payments, change requests, attendance and care records |

Each service has a database-aware /health endpoint. Only the frontend and the local PostgreSQL port are published on loopback by default. The three services use one PostgreSQL database and query shared related records where needed. This reduces course-project complexity; schema changes still require coordination.

Account issues expiring bearer tokens; the services verify issuer, audience and signature, then check the current role, account status and session version from PostgreSQL. Pet access and customer booking and care access are scoped to the signed-in owner. Customers register in the portal and operators create staff accounts from the Account container. Fixture accounts are disabled on a normal deployment.

Booking allocates available physical rooms and calculates prices in PostgreSQL. An advisory transaction lock serializes reservation and inventory changes for this small installation; exclusion constraints reject overlapping active holds even if another writer bypasses service logic. The service expires old holds before serving availability and booking operations. Checkout and refund actions are simulated and persist with their audit logs.

## Delivery

GitHub Actions and Jenkins execute `sh scripts/verify.sh` against a disposable Compose project. Jenkins tags the application images with the checked-out commit and deploys those same images on main on the same Docker engine. The [local Jenkins setup](../README.md#run-jenkins-in-docker) creates the job from code and mounts the PawInn `.env` read-only at `$JENKINS_HOME/pawinn-local.env`. A separately managed Jenkins installation can use a Secret file credential named `pawinn-env` with the same database settings. The credential takes precedence when configured.

Jenkins deploys to the `pawinn` Compose project by default. For a second local instance, set a distinct `PAWINN_DEPLOY_PROJECT` and unused `JENKINS_PORT`, `FRONTEND_PORT`, and `POSTGRES_PORT`. Start its Jenkins controller with a separate Compose project name using `-p`. For a manual app startup, use `-p` with the same app project name as `PAWINN_DEPLOY_PROJECT`. Before replacing the application containers, it verifies that the deployment settings can connect to the existing PostgreSQL service. If the check fails, correct the Jenkins settings to match the database. Changing `POSTGRES_PASSWORD` in an environment file only affects database initialization on an empty volume.

Run the verification script inside the assigned `tuchsanai/devtools:2569_1` course container using the instructor's startup instructions. Keep the commit, test output and Jenkins logs as evidence. Public internet hosting would need TLS and an operational review; the default setup is a local course deployment.
