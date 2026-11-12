# Course verification walkthrough

PawInn's application uses PostgreSQL throughout. The only simulation is payment and refund processing. Use invented data for the course walkthrough.

1. Run `sh scripts/verify.sh` inside the course container. Save the results for booking races, payment retries, rescheduling and cancellation, care history, account auditing and permissions, and restart persistence.
2. Start the stack, register a customer and a pet, bootstrap an Admin, and create a Staff account (see the [Account guide](../services/account/README.md)).
3. At a 360 px viewport, select the saved pet and dates, hold a room and edit the hold in checkout. Confirm labels, visible keyboard focus, and no horizontal scrolling in search, review and booking details. Try an invalid date and cancel an unpaid hold, then make a new booking and complete simulated checkout.
4. Request a change of length and review the quoted price. As staff, filter bookings and review the request. Check both views and search the original room type again to confirm the dates and availability agree. Repeat with cancellation on a separate booking; while it is pending, both views should show confirmed booking and pending request.
5. On another confirmed stay, record actual arrival, a daily photo report and multiple care events. Leave another date without a report. Record pickup, correct an entry, and verify the customer can see the dated history after pickup. Staff should see the previous value in the correction history.
6. As Admin, suspend an account and confirm its existing session stops working; reactivate it and check the retained history and audit log. Capture the commit, expected and observed behavior, and screenshots. Record a real Jenkins run separately.

The optional fixture accounts and seed data are intended only for the disposable verification environment. Normal startup does not create them.
