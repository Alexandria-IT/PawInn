import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import jwt from "jsonwebtoken";
import { createApp } from "../server.js";

test("Account API with a disposable seeded pawinn_test database", /* Run Account API tests against a seeded disposable database. */ async (t) => {
  const url = process.env.ACCOUNT_TEST_DATABASE_URL;
  assert.ok(
    url,
    "Set ACCOUNT_TEST_DATABASE_URL to a disposable pawinn_test database.",
  );
  assert.equal(new URL(url).pathname, "/pawinn_test");
  const pool = new pg.Pool({ connectionString: url });
  const secret = "disposable-test-signing-key-not-used-by-the-application";
  const server = createApp({ pool, secret, allowFixtures: true }).listen(
    0,
    "127.0.0.1",
  );
  t.after(
    /* Release the HTTP server and pool after the suite. */ async () => {
      await new Promise(
        /* Wait until the test server finishes closing. */ (resolve) =>
          server.close(resolve),
      );
      await pool.end();
    },
  );
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const password = "PawInnDemo123!";
  // Send a test request and return its status and body.
  async function call(path, method = "GET", body, token) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body && { "Content-Type": "application/json" }),
        ...(token && { Authorization: "Bearer " + token }),
      },
      body: body && JSON.stringify(body),
    });
    return [res.status, res.status === 204 ? null : await res.json()];
  }
  // Sign in a fixture user and return its session.
  async function login(email) {
    const [status, result] = await call("/api/auth/login", "POST", {
      email,
      password,
    });
    assert.equal(status, 200);
    return result.data;
  }

  await t.test(
    "health, bcrypt login and protected session",
    /* Check readiness, credentials, and protected sessions. */ async () => {
      assert.equal((await call("/health"))[0], 200);
      assert.equal(
        (
          await call("/api/auth/login", "POST", {
            email: "jamie@pawinn.demo",
            password: "wrong-password",
          })
        )[0],
        401,
      );
      assert.equal((await call("/api/users/me"))[0], 401);
      const { token, user } = await login(" JAMIE@pawinn.demo ");
      assert.deepEqual(Object.keys(user).sort(), [
        "email",
        "id",
        "name",
        "phone",
        "role",
      ]);
      assert.deepEqual(await call("/api/users/me", "GET", undefined, token), [
        200,
        { data: user },
      ]);
      const expired = jwt.sign({}, secret, {
        subject: user.id,
        expiresIn: -10,
        issuer: "pawinn-account",
        audience: "pawinn",
        algorithm: "HS256",
      });
      assert.equal(
        (await call("/api/users/me", "GET", undefined, expired))[0],
        401,
      );
    },
  );

  await t.test(
    "registration is customer-only, unique and stores a hash",
    /* Check registration defaults, duplicate email, and password hashing. */ async () => {
      const form = {
        name: "Integration Customer",
        email: randomUUID() + "@example.test",
        password,
        phone: "081 234 5678",
      };
      assert.equal(
        (
          await call("/api/auth/register", "POST", { ...form, role: "STAFF" })
        )[0],
        400,
      );
      assert.equal(
        (
          await call("/api/auth/register", "POST", {
            ...form,
            password: "é".repeat(40),
          })
        )[0],
        400,
      );
      const [status, { data }] = await call("/api/auth/register", "POST", form);
      assert.equal(status, 201);
      assert.equal(data.user.role, "CUSTOMER");
      assert.equal(
        (
          await call("/api/auth/register", "POST", {
            ...form,
            email: form.email.toUpperCase(),
          })
        )[0],
        409,
      );
      const {
        rows: [row],
      } = await pool.query("SELECT password_hash FROM users WHERE user_id=$1", [
        data.user.id,
      ]);
      assert.match(row.password_hash, /^\$2[aby]\$/);
      assert.equal((await login(form.email)).user.id, data.user.id);
      assert.deepEqual(await call("/api/pets", "GET", undefined, data.token), [
        200,
        { data: [] },
      ]);
    },
  );

  await t.test(
    "pet CRUD is scoped to its owner and respects booking history",
    /* Check pet ownership, editing, and booking history protection. */ async () => {
      const { token, user } = await login("jamie@pawinn.demo");
      const alex = await login("alex@pawinn.demo");
      const staff = await login("team@pawinn.demo");
      const [listStatus, list] = await call(
        "/api/pets",
        "GET",
        undefined,
        token,
      );
      assert.equal(listStatus, 200);
      assert.deepEqual(
        list.data
          .map(
            /* Collect pet names for the ownership assertion. */ (pet) =>
              pet.name,
          )
          .sort(),
        ["Miso", "Mochi"],
      );
      assert.equal(
        (await call("/api/pets", "GET", undefined, staff.token))[0],
        403,
      );
      assert.equal(
        (await call("/api/pets/2001", "PATCH", { species: "Cat" }, token))[0],
        409,
      );
      assert.equal(
        (await call("/api/pets/2001", "DELETE", undefined, token))[0],
        409,
      );
      assert.equal(
        (
          await call(
            "/api/pets",
            "POST",
            { name: "Bad date", species: "Dog", birthDate: "2024-02-31" },
            token,
          )
        )[0],
        400,
      );
      assert.equal(
        (
          await call(
            "/api/pets",
            "POST",
            { name: "Wrong owner", species: "Dog", ownerId: alex.user.id },
            token,
          )
        )[0],
        400,
      );
      const [status, { data: pet }] = await call(
        "/api/pets",
        "POST",
        { name: "Pippin", species: "Dog", birthDate: "2020-03-15" },
        token,
      );
      assert.equal(status, 201);
      assert.equal(pet.ownerId, user.id);
      assert.equal(pet.birthDate, "2020-03-15");
      const path = "/api/pets/" + pet.id;
      assert.deepEqual(await call(path, "GET", undefined, token), [
        200,
        { data: pet },
      ]);
      for (const method of ["GET", "PATCH", "DELETE"]) {
        assert.equal(
          (
            await call(
              path,
              method,
              method === "PATCH" ? { name: "Not yours" } : undefined,
              alex.token,
            )
          )[0],
          404,
        );
      }
      const [updatedStatus, updated] = await call(
        path,
        "PATCH",
        { notes: "Gentle walks", birthDate: null },
        token,
      );
      assert.equal(updatedStatus, 200);
      assert.equal(updated.data.name, "Pippin");
      assert.equal(updated.data.notes, "Gentle walks");
      assert.equal(updated.data.birthDate, null);
      assert.deepEqual(await call(path, "DELETE", undefined, token), [
        204,
        null,
      ]);
      assert.equal((await call(path, "GET", undefined, token))[0], 404);
    },
  );
});
