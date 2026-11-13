# Account service

Account handles customer registration, sign-in, and pet profiles in PostgreSQL. Start it with the root Compose stack. Protected routes check the current role, account status, and session version. Demo accounts can sign in when seed data is enabled.

Customers register in the app. To create a staff account from the running Account container, follow [Set up staff access](../../README.md#set-up-staff-access).

## API tests

Use a disposable seeded database named pawinn_test. Install locked dependencies with npm ci, set ACCOUNT_TEST_DATABASE_URL, and run npm test. The complete stack is checked by the root verification script.
