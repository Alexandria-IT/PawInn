import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.BASE_URL;
const write = process.env.PAWINN_TEST === "1";
assert.ok(origin, "Set BASE_URL to the frontend URL.");
// Call an API endpoint and assert the expected status.
async function request(path, method = "GET", body, token, expected = 200) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      ...(token && { Authorization: "Bearer " + token }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const payload =
    r.status === 204
      ? null
      : await r
          .json()
          .catch(
            /* Treat an empty or non-JSON response as missing data. */ () =>
              null,
          );
  assert.equal(
    r.status,
    expected,
    method + " " + path + ": " + (payload?.message || ""),
  );
  return payload?.data;
}
const accountPages = [
  "/",
  "/pages/rooms.html",
  "/pages/pets.html",
  "/pages/bookings.html",
];
const scripts = await Promise.all(
  accountPages.map(
    /* Check a page's cache headers, account menu, and asset links. */ async (
      path,
    ) => {
      const response = await fetch(origin + path, {
        headers: { "If-Modified-Since": "Fri, 01 Jan 2100 00:00:00 GMT" },
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(
        response.status,
        200,
        path + " must return the current page",
      );
      assert.match(
        response.headers.get("cache-control") || "",
        /\bno-store\b/,
        path,
      );
      const html = await response.text();
      assert.match(html, /aria-label="Open account options"/, path);
      const script = html.match(/src="(\/assets\/app\.js\?v=[a-f0-9]+)"/)?.[1];
      assert.ok(script, path + " must load a versioned app script");
      const home = html.match(/href="(\/\?v=[a-f0-9]+)"/)?.[1];
      assert.ok(home, path + " must link to a fresh Home URL");
      return { script, home };
    },
  ),
);
const [{ script, home }] = scripts;
for (const page of scripts) assert.deepEqual(page, { script, home });
const homeResponse = await fetch(origin + home, {
  signal: AbortSignal.timeout(15000),
});
assert.equal(homeResponse.status, 200);
assert.match(homeResponse.headers.get("cache-control") || "", /\bno-store\b/);
assert.ok((await homeResponse.text()).includes(`src="${script}"`));
const types = await request("/api/room-types");
assert.ok(types.length > 0);
const dog = types.find(
  /* Select a dog room type for the reservation flow. */ (x) =>
    x.species === "Dog",
);
assert.ok(dog);
// Return an ISO date offset from today.
const days = (n) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const offset = Number(process.env.SMOKE_OFFSET || 20);
const start = days(offset),
  end = days(offset + 2);
// Fetch availability for the common test dates.
const availability = () =>
  request("/api/availability?start=" + start + "&end=" + end);
const initial = (await availability()).find(
  /* Find the selected dog room type in the availability results. */ (t) =>
    t.roomTypeId === dog.id,
).available;
if (!write) {
  console.log(
    "PASS: public UI, room catalog and database-backed availability.",
  );
} else {
  await verifyBookings();
}

// Exercise inventory, reservation, payment, and cancellation behavior.
async function verifyBookings() {
  assert.ok(
    initial >= 1 && initial <= 15,
    "Use a disposable database with seeded inventory.",
  );
  assert.equal(types.length, 3);
  for (const type of types) {
    assert.equal(
      (await request("/api/rooms?roomTypeId=" + type.id + "&active=true"))
        .length,
      5,
    );
  }
  await request(
    "/api/availability?start=" + end + "&end=" + start,
    "GET",
    null,
    null,
    400,
  );
  const staff = await request("/api/auth/login", "POST", {
    email: "team@pawinn.demo",
    password: "PawInnDemo123!",
  });
  const password = "SmokeTestOnly123!";
  // Register a test customer and create its pet.
  async function participant() {
    const account = await request(
      "/api/auth/register",
      "POST",
      {
        name: "Smoke Customer",
        email: randomUUID() + "@example.test",
        password,
      },
      null,
      201,
    );
    const pet = await request(
      "/api/pets",
      "POST",
      { name: "Mochi", species: "Dog" },
      account.token,
      201,
    );
    return { ...account, pet };
  }
  // Create one more customer than the number of available rooms to exercise the race.
  const people = await Promise.all(
    Array.from({ length: initial + 1 }, participant),
  );
  const cat = types.find(
    /* Select the cat room type for inventory checks. */ (type) =>
      type.species === "Cat",
  );
  const room = (
    await request("/api/rooms?roomTypeId=" + cat.id + "&active=true")
  ).at(-1);
  // Read cat availability and verify the species filter.
  const catAvailability = async () => {
    const [result] = await request(
      "/api/availability?start=" + start + "&end=" + end + "&species=Cat",
    );
    assert.equal(result.roomTypeId, cat.id);
    return result.available;
  };
  const availableCats = await catAvailability();
  const roomPath = "/api/rooms/" + room.id;
  await request(roomPath, "PATCH", { isActive: false }, null, 401);
  await request(roomPath, "PATCH", { isActive: false }, people[0].token, 403);
  assert.equal(
    (await request(roomPath, "PATCH", { isActive: false }, staff.token))
      .isActive,
    false,
  );
  assert.equal(
    (await request("/api/rooms?roomTypeId=" + cat.id + "&active=false")).length,
    1,
  );
  assert.equal(await catAvailability(), availableCats - 1);
  assert.equal(
    (await request(roomPath, "PATCH", { isActive: true }, staff.token))
      .isActive,
    true,
  );
  assert.equal(await catAvailability(), availableCats);
  await request(
    "/api/bookings",
    "POST",
    { petId: people[0].pet.id, roomTypeId: cat.id, start, end },
    people[0].token,
    400,
  );
  const outcomes = await Promise.all(
    people.map(
      /* Submit one participant's reservation in the parallel race. */ async (
        p,
      ) => {
        const response = await fetch(origin + "/api/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + p.token,
          },
          body: JSON.stringify({
            petId: p.pet.id,
            roomTypeId: dog.id,
            start,
            end,
          }),
        });
        return {
          p,
          status: response.status,
          booking: (await response.json()).data,
        };
      },
    ),
  );
  assert.equal(
    outcomes.filter(/* Count accepted reservations. */ (r) => r.status === 201)
      .length,
    initial,
  );
  assert.equal(
    outcomes.filter(
      /* Count requests that lost the availability race. */ (r) =>
        r.status === 409,
    ).length,
    1,
  );
  const { p, booking } = outcomes.find(
    /* Pick a successful booking for the remaining tests. */ (r) =>
      r.status === 201,
  );
  const foreign = outcomes.find(
    /* Pick the customer whose request lost the race. */ (r) =>
      r.status === 409,
  ).p;
  await request("/api/bookings/" + booking.id, "GET", null, foreign.token, 404);
  await request(
    "/api/rooms/" + booking.roomId,
    "PATCH",
    { isActive: false },
    staff.token,
    409,
  );
  const checkoutPath = "/api/bookings/" + booking.id + "/checkout";
  const failedAttempt = {
    outcome: "FAILED",
    attemptId: "earlier-SIM-" + booking.id + "-confirm",
  };
  const failed = await request(checkoutPath, "POST", failedAttempt, p.token);
  assert.equal(failed.status, "PENDING");
  assert.equal(failed.paymentStatus, "FAILED");
  const failedReplay = await request(
    checkoutPath,
    "POST",
    failedAttempt,
    p.token,
  );
  assert.equal(
    failedReplay.logs.filter(
      /* Count failed payment entries after replay. */ (x) =>
        x.action === "PAYMENT_FAILED",
    ).length,
    1,
  );
  const confirmed = await request(
    "/api/bookings/" + booking.id + "/checkout",
    "POST",
    { outcome: "SUCCESS", attemptId: "confirm" },
    p.token,
  );
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.total, dog.pricePerNight * 2);
  const replay = await request(
    "/api/bookings/" + booking.id + "/checkout",
    "POST",
    { outcome: "SUCCESS", attemptId: "confirm" },
    p.token,
  );
  assert.equal(
    replay.logs.filter(
      /* Count successful payment entries after replay. */ (x) =>
        x.action === "PAYMENT_SUCCEEDED",
    ).length,
    1,
  );
  const cancellationPath = "/api/bookings/" + booking.id + "/cancellations";
  const firstRequest = await request(
    cancellationPath,
    "POST",
    { reason: "Plans changed" },
    p.token,
    201,
  );
  await request(
    cancellationPath,
    "POST",
    { reason: "Duplicate request" },
    p.token,
    409,
  );
  const declined = await request(
    "/api/cancellations/" + firstRequest.cancellation.id,
    "PATCH",
    { decision: "DECLINED", notes: "Keep the stay" },
    staff.token,
  );
  assert.equal(declined.status, "CONFIRMED");
  assert.equal(declined.cancellation.status, "DECLINED");
  assert.equal(declined.refundStatus, "NOT_REQUESTED");
  assert.equal(
    (await availability()).find(
      /* Find remaining dog availability after the decline. */ (t) =>
        t.roomTypeId === dog.id,
    ).available,
    0,
  );
  const requested = await request(
    cancellationPath,
    "POST",
    { reason: "Plans changed again" },
    p.token,
    201,
  );
  await request(
    "/api/cancellations/" + requested.cancellation.id,
    "PATCH",
    { decision: "APPROVED" },
    p.token,
    403,
  );
  const reviewed = await request(
    "/api/cancellations/" + requested.cancellation.id,
    "PATCH",
    { decision: "APPROVED", notes: "Approved" },
    staff.token,
  );
  assert.equal(reviewed.status, "CANCELLED");
  assert.equal(reviewed.refundAmount, confirmed.total);
  const reviewedAgain = await request(
    "/api/cancellations/" + requested.cancellation.id,
    "PATCH",
    { decision: "APPROVED" },
    staff.token,
  );
  assert.equal(
    reviewedAgain.logs.filter(
      /* Count refund entries after replaying approval. */ (x) =>
        x.action === "REFUND_SUCCEEDED",
    ).length,
    1,
  );
  assert.equal(
    (await availability()).find(
      /* Find restored dog availability after approval. */ (t) =>
        t.roomTypeId === dog.id,
    ).available,
    1,
  );
  console.log(
    "PASS: catalog and inventory controls, concurrent last-room reservation, ownership, payment retries, cancellation decisions, one refund and restored availability.",
  );
}
