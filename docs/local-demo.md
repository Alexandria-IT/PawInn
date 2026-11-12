# Course verification walkthrough

PawInn's application uses PostgreSQL throughout. The only simulation is payment and refund processing. Use invented data for the course walkthrough.

1. Run `sh scripts/verify.sh` inside the course container. It checks the seven-table schema, ownership, real availability, the last-room conflict, checkout retry, staff cancellation and data persistence.
2. Start the normal stack and create a customer account, pet profile and staff account (see the [Account guide](../services/account/README.md)).
3. As the customer, select dates and a compatible room. Reserve it, try the declined payment option, then complete a successful simulated payment. Reload to see the saved confirmation.
4. Request cancellation. Sign in as staff to approve it, then verify the booking status and restored availability. Staff can also activate/deactivate a room with no active reservation.
5. Capture the actual run: commit SHA, expected and actual results, test output and any defects. Record a real Jenkins run separately.

The optional fixture accounts and seed data are intended only for the disposable verification environment. Normal startup does not create them.
