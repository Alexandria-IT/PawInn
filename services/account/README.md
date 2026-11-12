# Account service

Account handles customer registration, bcrypt login, bearer tokens and pet profiles in PostgreSQL. Start it with the root Compose stack. Protected routes check the current role and ownership. Accounts reserved for fixtures cannot sign in unless the test stack enables fixtures.

## Provision staff

Create staff through the local operator CLI, never through public registration. In PowerShell, use a new staff email and choose a password of at least 12 characters:

```powershell
$staffPassword = Read-Host "New staff password" -MaskInput
$staffPassword | docker compose exec -T account node staff.js staff@example.test "PawInn Staff"
Remove-Variable staffPassword
```

Use that email and password on the normal sign-in page. The CLI rejects an existing email. Account stores only the bcrypt hash.

## API tests

Use a disposable seeded database named pawinn_test. Install locked dependencies with npm ci, set ACCOUNT_TEST_DATABASE_URL, and run npm test. The complete stack is checked by the root verification script.
