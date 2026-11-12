import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Verify the admin controls and the resulting access across all three services.
export async function verifyAdmin({
  request, adminEmail, adminPassword, customer, customerPassword, staff, bookingId,
}) {
  assert.ok(adminEmail && adminPassword, "Provision an administrator for the disposable verification stack.");
  const login = (email, password, expected = 200) =>
    request("/api/auth/login", "POST", { email, password }, null, expected);
  const admin = await login(adminEmail, adminPassword);
  assert.equal(admin.user.role, "ADMIN");
  const users = "/api/admin/users";
  await request(users, "GET", null, null, 401);
  await request(users, "GET", null, customer.token, 403);
  await request(users, "GET", null, staff.token, 403);
  await request("/api/pets", "GET", null, admin.token, 403);
  const roomPath = "/api/rooms/" + (await request("/api/rooms"))[0].id;
  const bookingPath = "/api/bookings/" + bookingId;
  await request(roomPath, "PATCH", { isActive: true }, admin.token, 403);
  await request(bookingPath, "GET", null, admin.token, 403);

  // Create an independent employee and verify that search and filters find it.
  const email = randomUUID() + "@example.test";
  const password = randomUUID();
  const name = "Verification Employee " + email.slice(0, 8);
  const form = { name, email, password };
  await request("/api/auth/register", "POST", { ...form, role: "ADMIN" }, null, 400);
  const employee = await request(users, "POST", form, admin.token, 201);
  assert.equal(employee.role, "STAFF");
  assert.equal(employee.status, "ACTIVE");
  assert.ok(!Object.hasOwn(employee, "password") && !Object.hasOwn(employee, "password_hash"));
  await request(users, "POST", form, admin.token, 409);
  for (const query of [email.toUpperCase(), name.toUpperCase()]) {
    const found = await request(users + "?" + new URLSearchParams({
      q: query, role: "STAFF", status: "ACTIVE",
    }), "GET", null, admin.token);
    assert.deepEqual(found.users.map((user) => user.id), [employee.id]);
  }
  const employeePath = `${users}/${employee.id}`;
  const activeEmployee = await login(email, password);
  assert.equal((await request(bookingPath, "GET", null, activeEmployee.token)).id, bookingId);
  await request(employeePath, "PATCH", { role: "ADMIN" }, admin.token, 400);
  await request(`${users}/${admin.user.id}`, "PATCH", { status: "SUSPENDED" }, admin.token, 403);
  await request(employeePath, "PATCH", { role: "CUSTOMER" }, admin.token);
  await request(roomPath, "PATCH", { isActive: true }, activeEmployee.token, 401);
  const customerEmployee = await login(email, password);
  assert.equal(customerEmployee.user.role, "CUSTOMER");
  await request(roomPath, "PATCH", { isActive: true }, customerEmployee.token, 403);
  await request(employeePath, "PATCH", { role: "STAFF" }, admin.token);
  const restoredEmployee = await login(email, password);
  assert.equal(restoredEmployee.user.role, "STAFF");
  await request(employeePath, "PATCH", { status: "SUSPENDED" }, admin.token);
  await request(roomPath, "PATCH", { isActive: true }, restoredEmployee.token, 401);
  await request(bookingPath, "GET", null, restoredEmployee.token, 401);
  await login(email, password, 401);
  await request(employeePath, "PATCH", { status: "ACTIVE" }, admin.token);
  await request("/api/users/me", "GET", null, restoredEmployee.token, 401);
  const reactivatedEmployee = await login(email, password);
  assert.equal((await request(bookingPath, "GET", null, reactivatedEmployee.token)).id, bookingId);
  await request(employeePath, "PATCH", { status: "ACTIVE" }, admin.token);
  assert.equal((await request("/api/users/me", "GET", null, reactivatedEmployee.token)).id, employee.id);

  // A customer's booking and care feed survive a suspension and reactivation.
  const updatesPath = "/api/bookings/updates";
  const previousUpdates = await request(updatesPath, "GET", null, customer.token);
  assert.ok(previousUpdates.updates.some((update) => update.bookingId === bookingId));
  const customerPath = `${users}/${customer.user.id}`;
  await request(customerPath, "PATCH", { status: "SUSPENDED" }, admin.token);
  const suspended = await request(users + "?" + new URLSearchParams({
    q: customer.user.email, role: "CUSTOMER", status: "SUSPENDED",
  }), "GET", null, admin.token);
  assert.deepEqual(suspended.users.map((user) => user.id), [customer.user.id]);
  await request("/api/users/me", "GET", null, customer.token, 401);
  await request(bookingPath, "GET", null, customer.token, 401);
  await login(customer.user.email, customerPassword, 401);
  assert.equal((await request(bookingPath, "GET", null, staff.token)).id, bookingId);
  await request(customerPath, "PATCH", { status: "ACTIVE" }, admin.token);
  await request(updatesPath, "GET", null, customer.token, 401);
  const restoredCustomer = await login(customer.user.email, customerPassword);
  assert.equal((await request(bookingPath, "GET", null, restoredCustomer.token)).id, bookingId);
  assert.deepEqual(await request(updatesPath, "GET", null, restoredCustomer.token), previousUpdates);

  const audit = "/api/admin/audit?userId=" + employee.id;
  await request(audit, "GET", null, staff.token, 403);
  const history = await request(audit, "GET", null, admin.token);
  assert.deepEqual(history.entries.map((entry) => entry.action), [
    "ACCOUNT_REACTIVATED", "ACCOUNT_SUSPENDED", "STAFF_GRANTED", "STAFF_REVOKED", "STAFF_CREATED",
  ]);
  assert.deepEqual(history.entries[0].details, { from: "SUSPENDED", to: "ACTIVE" });
  for (const entry of history.entries) {
    assert.equal(entry.actor.id, admin.user.id);
    assert.equal(entry.target.id, employee.id);
    assert.ok(Number.isFinite(Date.parse(entry.createdAt)));
  }
  const bootstrap = await request("/api/admin/audit?userId=" + admin.user.id, "GET", null, admin.token);
  assert.deepEqual(bootstrap.entries.map((entry) => entry.action), ["ADMIN_BOOTSTRAPPED"]);
  assert.equal(bootstrap.entries[0].actor.id, admin.user.id);
  assert.deepEqual(bootstrap.entries[0].details, { source: "CLI" });
  console.log("PASS: administrator access, staff provisioning, role and status filters, session revocation, retained history and audit details.");
}
