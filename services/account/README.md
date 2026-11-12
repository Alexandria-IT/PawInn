# Account service

Account handles customer registration, sign-in, pet profiles, account administration and account audit history in PostgreSQL. Start it with the root Compose stack. Protected routes check the current role, account status and session version. Demo accounts can sign in when the verification stack enables fixtures.

## Provision the administrator

Once Account is running, use the local operator CLI with an unused administrator email and a password of 12 characters or more, up to 72 bytes. The command reads the password from standard input and accepts one successful bootstrap per database.

```powershell
$adminPassword = Read-Host "New administrator password" -MaskInput
$adminPassword | docker compose exec -T account node bootstrap-admin.js admin@example.test "PawInn Administrator"
Remove-Variable adminPassword
```

Sign in with the new account to open the Admin portal. Use **Create staff account** for new staff, or find an existing customer and choose **Grant staff access**. Account changes record the administrator, the affected account, the changed values and the time in **Audit history**. A role or status change ends the affected account's existing sessions.

## API tests

Use a disposable seeded database named pawinn_test. Install locked dependencies with npm ci, set ACCOUNT_TEST_DATABASE_URL, and run npm test. The complete stack is checked by the root verification script.
