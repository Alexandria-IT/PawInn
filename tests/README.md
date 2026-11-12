# Verification

Run `sh scripts/verify.sh` from the root with Docker Compose. The script uses an isolated test database, runs SQL checks, tests the HTTP routes through Nginx, and checks persistence after a service restart.

For a read-only deployment smoke check, set BASE_URL to the frontend and run `node tests/smoke.mjs` with PAWINN_TEST unset. PAWINN_TEST=1 registers customers and makes reservations; use that mode only in a disposable seeded stack.

Use the [course walkthrough](../docs/local-demo.md) to collect browser evidence.
