# Account API tests

The tests use a disposable, seeded PostgreSQL database named pawinn_test. Follow the [Account test setup](../README.md#run-api-tests), set ACCOUNT_TEST_DATABASE_URL and run npm test.

The suite covers database readiness, bcrypt login, token expiry, customer-only registration, duplicate email, pet CRUD, role and ownership checks, invalid dates and booking history protection. Run the shared SQL verification separately from database/tests/verify.sql.
