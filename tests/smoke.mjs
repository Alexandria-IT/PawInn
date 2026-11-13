import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifyCare } from "./requirements-care.mjs";

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
const availableDogs = async () =>
  (await availability()).find((type) => type.roomTypeId === dog.id).available;
if (!write) {
  assert.ok(Number.isInteger(await availableDogs()));
  console.log(
    "PASS: public UI, room catalog and database-backed availability.",
  );
} else {
  await verifyBookings();
}

// Exercise inventory, reservation, payment, and cancellation behavior.
async function verifyBookings() {
  const staff = await request("/api/auth/login", "POST", {
    email: "verify-staff@pawinn.test",
    password: "SmokeStaffOnly123!",
  });
  assert.equal(staff.user.role, "STAFF");
  await request("/api/admin/users", "GET", null, staff.token, 404);
  const removedPage = await fetch(origin + "/pages/admin.html", { signal: AbortSignal.timeout(15000) });
  assert.equal(removedPage.status, 404);
  const inventoryPath = "/api/rooms/inventory";
  // Check the expired hold before the Booking API sweeps it.
  const inventoryRoom = async (id) =>
    (await request(inventoryPath, "GET", null, staff.token)).find((entry) => entry.id === String(id));
  assert.equal((await inventoryRoom(301)).reservationStatus, null);
  const initial = await availableDogs();
  await verifyClosures(staff, inventoryRoom);
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
  const password = "SmokeTestOnly123!";
  const missingPhone = { name: "Smoke Customer", email: randomUUID() + "@example.test", password };
  await request("/api/auth/register", "POST", missingPhone, null, 400);
  await request("/api/auth/register", "POST", { ...missingPhone, phone: "not a phone" }, null, 400);
  // Register a test customer and create its pet.
  async function participant() {
    const account = await request(
      "/api/auth/register",
      "POST",
      {
        name: "Smoke Customer",
        email: randomUUID() + "@example.test",
        password,
        phone: "+66 81 234 5678",
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
  await request(inventoryPath, "GET", null, null, 401);
  await request(inventoryPath, "GET", null, people[0].token, 403);
  const unreservedRoom = await inventoryRoom(room.id);
  assert.equal(unreservedRoom.reservationStatus, null);
  assert.equal(unreservedRoom.reservationBookingId, null);
  assert.equal(unreservedRoom.reservationGuestName, null);
  assert.equal(unreservedRoom.reservationPetName, null);
  const seededRoom = await inventoryRoom(101);
  assert.equal(seededRoom.reservationStatus, "RESERVED");
  // The pet still in-house takes precedence over the future booking for C101.
  assert.equal(seededRoom.reservationBookingId, "3999");
  assert.equal(seededRoom.reservationGuestName, "Jamie Parker");
  assert.equal(seededRoom.reservationPetName, "Mochi");
  const publicRoom = (await request("/api/rooms")).find(({ id }) => id === "101");
  for (const field of ["reservationStatus", "reservationBookingId", "reservationGuestName", "reservationPetName"]) {
    assert.equal(publicRoom[field], undefined);
  }
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
            specialCare: "Offer a quiet rest after each meal.",
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
  assert.equal((await request("/api/bookings/" + booking.id, "GET", null, staff.token)).customerPhone, "+66 81 234 5678");
  assert.ok(Math.abs(booking.expiresAt - Date.parse(booking.createdAt) - 120_000) < 1);
  await request("/api/bookings/" + booking.id, "GET", null, foreign.token, 404);
  const duplicate = await fetch(origin + "/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + p.token },
    body: JSON.stringify({ petId: p.pet.id, roomTypeId: dog.id, start, end }),
  });
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).message, /already has a reservation/i);
  const catPet = await request("/api/pets", "POST", { name: "Miso", species: "Cat" }, foreign.token, 201);
  const held = await request("/api/bookings", "POST", {
    petId: catPet.id, roomTypeId: cat.id, start: days(offset + 80), end: days(offset + 82),
  }, foreign.token, 201);
  const heldInventory = await inventoryRoom(held.roomId);
  assert.equal(heldInventory.reservationStatus, "HELD");
  assert.equal(heldInventory.reservationBookingId, held.id);
  assert.equal(heldInventory.reservationGuestName, "Smoke Customer");
  assert.equal(heldInventory.reservationPetName, "Miso");
  await request("/api/rooms/" + held.roomId + "/closures", "POST",
    { start: held.start, reopen: held.end }, staff.token, 409);
  await request("/api/rooms/" + held.roomId, "PATCH", { isActive: false }, staff.token, 409);
  assert.ok(Math.abs(Date.parse(heldInventory.holdExpiresAt) - held.expiresAt) < 1);
  const cancelledHoldPath = "/api/bookings/" + held.id + "/hold";
  await request(cancelledHoldPath, "DELETE", null, p.token, 404);
  assert.equal((await request(cancelledHoldPath, "DELETE", null, foreign.token)).status, "CANCELLED");
  assert.equal((await request(cancelledHoldPath, "DELETE", null, foreign.token)).status, "CANCELLED");
  assert.equal((await inventoryRoom(held.roomId)).reservationStatus, null);
  await request("/api/bookings/" + held.id + "/checkout", "POST",
    { outcome: "SUCCESS", attemptId: randomUUID() }, foreign.token, 409);
  await request(
    "/api/rooms/" + booking.roomId,
    "PATCH",
    { isActive: false },
    staff.token,
    409,
  );
  assert.equal(booking.specialCare, "Offer a quiet rest after each meal.");
  await postUpdate(booking.id, staff.token, "Too early", null, 409);
  const holdPath = "/api/bookings/" + booking.id + "/hold";
  const edited = { petId: p.pet.id, roomTypeId: booking.roomTypeId, start, end: days(offset + 3), specialCare: booking.specialCare };
  await request(holdPath, "PATCH", edited, foreign.token, 404);
  const updatedHold = await request(holdPath, "PATCH", edited, p.token);
  assert.equal(updatedHold.id, booking.id);
  assert.equal(updatedHold.expiresAt, booking.expiresAt);
  assert.equal(updatedHold.total, booking.nightlyRate * 3);
  await request(holdPath, "PATCH", { ...edited, end }, p.token);
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
  const closurePath = "/api/rooms/" + confirmed.roomId + "/closures";
  await request(closurePath, "POST", { start: confirmed.end, reopen: days(offset + 3) }, staff.token, 409);
  const booked = await request("/api/bookings/" + confirmed.id, "GET", null, p.token);
  assert.equal(booked.status, "CONFIRMED");
  assert.equal(booked.roomId, confirmed.roomId);
  assert.equal(booked.end, confirmed.end);
  const reservedInventory = await inventoryRoom(confirmed.roomId);
  assert.equal(reservedInventory.reservationStatus, "RESERVED");
  assert.equal(reservedInventory.holdExpiresAt, null);
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
  const staffBooking = await request(
    "/api/bookings/" + confirmed.id,
    "GET",
    null,
    staff.token,
  );
  assert.equal(staffBooking.specialCare, booking.specialCare);
  await verifyPetUpdates(confirmed, p, foreign, staff);
  await verifyRescheduling(confirmed, p, foreign, staff);
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
    "PASS: catalog and inventory controls, concurrent last-room reservation, ownership, editable holds, payment retries, cancellation decisions, one refund and restored availability.",
  );
  const careBooking = await request("/api/bookings", "POST", {
    petId: p.pet.id,
    roomTypeId: booking.roomTypeId,
    start: days(offset + 60),
    end: days(offset + 63),
    specialCare: "Use the pet's usual feeding routine.",
  }, p.token, 201);
  await request("/api/bookings/" + careBooking.id + "/checkout", "POST",
    { outcome: "SUCCESS", attemptId: randomUUID() }, p.token);
  await request("/api/bookings/" + careBooking.id + "/care/arrival", "PATCH", {}, staff.token, 409);
  const careCustomer = await request("/api/auth/login", "POST", {
    email: "jamie@pawinn.demo", password: "PawInnDemo123!",
  });
  await postUpdate("3999", staff.token, "Care history test update.", null);
  await verifyCare({ request, staff, customer: careCustomer, foreign, booking: { id: "3999" }, origin });
  await verifyAttendancePolicy(staff, careCustomer, inventoryRoom);
  await verifyPetArchive(careCustomer.token, foreign.token, { start: days(offset + 100), end: days(offset + 101) });

}


// Check pet deletion, active booking protection, and history after archiving.
async function verifyPetArchive(token, foreignToken, dates) {
  const unused = await request("/api/pets", "POST", { name: "Unused profile", species: "Dog" }, token, 201);
  const unusedPath = "/api/pets/" + unused.id;
  await request(unusedPath + "/archive", "PATCH", { archived: true }, token, 409);
  await request(unusedPath, "DELETE", null, token, 204);
  await request(unusedPath, "GET", null, token, 404);

  // Mochi still has a future stay. Miso has only cancelled stays.
  await request("/api/pets/2001/archive", "PATCH", { archived: true }, token, 409);
  const path = "/api/pets/2002";
  const draft = { petId: "2002", roomTypeId: "3", ...dates };
  const hold = await request("/api/bookings", "POST", draft, token, 201);
  await request(path + "/archive", "PATCH", { archived: true }, token, 409);
  await request("/api/bookings/" + hold.id + "/hold", "DELETE", null, token);
  await request(path, "DELETE", null, token, 409);
  await request(path + "/archive", "PATCH", { archived: true }, foreignToken, 404);
  await request(path + "/archive", "PATCH", { archived: true }, token, 204);
  await request(path + "/archive", "PATCH", { archived: true }, token, 204);
  assert.ok(!(await request("/api/pets", "GET", null, token)).some((pet) => pet.id === "2002"));
  assert.ok((await request("/api/pets?includeArchived=true", "GET", null, token))
    .find((pet) => pet.id === "2002").archivedAt);
  assert.equal((await request("/api/bookings/3998", "GET", null, token)).petId, "2002");
  await request("/api/bookings", "POST", draft, token, 409);
  await request(path + "/archive", "PATCH", { archived: false }, token, 204);
  assert.ok((await request("/api/pets", "GET", null, token)).some((pet) => pet.id === "2002"));
  await request("/api/bookings", "POST", draft, token, 201);
  console.log("PASS: unused pet deletion, active booking protection, archival, and restoration.");
}

// Check the no-show release, overdue occupancy, and retry-safe late pickup fee.
async function verifyAttendancePolicy(staff, customer, inventoryRoom) {
  const now = new Date().toISOString();
  const sameDayPath = "/api/bookings/3996/care";
  const checkIn = await request(sameDayPath, "GET", null, staff.token);
  assert.deepEqual(checkIn.days, []);
  assert.equal(checkIn.checkInOpensAt, "12:30");
  await request(sameDayPath + "/pickup", "PATCH", { at: now }, staff.token, 409);
  const bangkok = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" });
  const today = bangkok.format(new Date(now));
  const opening = new Date(today + "T12:30:00+07:00");
  const beforeOpening = new Date(Math.min(Date.parse(now), +opening - 1));
  await request(sameDayPath + "/arrival", "PATCH", { at: beforeOpening.toISOString() }, staff.token, 409);
  if (+opening <= Date.parse(now)) {
    const arrival = await request(sameDayPath + "/arrival", "PATCH", { at: opening.toISOString() }, staff.token);
    assert.equal(arrival.arrivedAt, opening.toISOString());
  } else {
    await request(sameDayPath + "/arrival", "PATCH", { at: opening.toISOString() }, staff.token, 400);
  }

  const noShowPath = "/api/bookings/3998";
  await request(noShowPath + "/care/arrival", "PATCH", { at: now }, staff.token, 409);
  const missed = await request(noShowPath, "GET", null, customer.token);
  assert.equal(missed.status, "CANCELLED");
  assert.equal(missed.paymentStatus, "SUCCESS");
  assert.equal(missed.refundStatus, "NOT_REQUESTED");
  assert.equal(missed.cancellation.status, "EXPIRED");
  assert.equal(missed.logs.filter(({ action }) => action === "NO_SHOW").length, 1);
  assert.equal((await inventoryRoom(305)).reservationStatus, null);
  await request("/api/cancellations/" + missed.cancellation.id, "PATCH",
    { decision: "APPROVED" }, staff.token, 409);

  const tomorrow = bangkok.format(new Date(Date.parse(now) + 86_400_000));
  const gardenAvailability = async () => {
    const rows = await request("/api/availability?start=" + today + "&end=" + tomorrow);
    return rows.find(({ roomTypeId }) => roomTypeId === "2").available;
  };
  const availableBeforePickup = await gardenAvailability();
  const latePath = "/api/bookings/3997";
  assert.equal((await inventoryRoom(205)).reservationStatus, "RESERVED");
  await request("/api/rooms/205", "PATCH", { isActive: false }, staff.token, 409);
  const late = await request(latePath, "GET", null, staff.token);
  const at = late.end + "T13:01:00+07:00";
  const completed = await request(latePath + "/care/pickup", "PATCH", { at }, staff.token);
  assert.equal(completed.latePickupFee, 200);
  assert.deepEqual(await request(latePath + "/care/pickup", "PATCH", { at }, staff.token), completed);
  const billed = await request(latePath, "GET", null, staff.token);
  assert.equal(billed.totalWithFees, late.total + 200);
  assert.equal(billed.logs.filter(({ action }) => action === "LATE_PICKUP_CHARGED").length, 1);
  assert.equal((await inventoryRoom(205)).reservationStatus, null);
  assert.equal(await gardenAvailability(), availableBeforePickup + 1);
  console.log("PASS: no-show release without refund, overdue occupancy, rounded late pickup fee, and safe retry.");
}

// Check that closures protect future inventory without changing existing stays.
async function verifyClosures(staff, inventoryRoom) {
  const bangkokDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" });
  const localDate = (n) => bangkokDate.format(new Date(Date.now() + n * 86_400_000));
  const path = "/api/rooms/101/closures";
  const window = { start: localDate(1), reopen: localDate(3) };
  const availabilityFor = async (from, to) => {
    const rows = await request("/api/availability?start=" + from + "&end=" + to);
    return rows.find(({ roomTypeId }) => roomTypeId === dog.id).available;
  };
  const before = await availabilityFor(window.start, window.reopen);
  const reopening = await availabilityFor(window.reopen, localDate(4));
  await request(path, "POST", window, null, 401);
  const customer = await request("/api/auth/login", "POST", {
    email: "jamie@pawinn.demo", password: "PawInnDemo123!",
  });
  await request(path, "POST", window, customer.token, 403);
  await request(path, "POST", { ...window, start: localDate(0) }, staff.token, 400);
  await request(path, "POST", { ...window, reopen: window.start }, staff.token, 400);

  const closure = await request(path, "POST", window, staff.token, 201);
  assert.deepEqual((await inventoryRoom(101)).closures, [closure]);
  assert.equal((await request(path, "POST", window, staff.token, 201)).id, closure.id);
  await request(path, "POST", { start: localDate(2), reopen: localDate(4) }, staff.token, 409);
  assert.equal(await availabilityFor(window.start, window.reopen), before - 1);
  assert.equal(await availabilityFor(window.reopen, localDate(4)), reopening);

  const pet = (await request("/api/pets", "GET", null, customer.token)).find(({ species }) => species === "Dog");
  const booking = await request("/api/bookings", "POST", {
    petId: pet.id, roomTypeId: dog.id, start: window.start, end: window.reopen,
  }, customer.token, 201);
  assert.notEqual(booking.roomId, "101");
  await request("/api/bookings/" + booking.id + "/hold", "DELETE", null, customer.token);
  await request(path + "/" + closure.id, "DELETE", null, staff.token, 204);
  assert.equal(await availabilityFor(window.start, window.reopen), before);
  assert.deepEqual((await inventoryRoom(101)).closures, []);
  console.log("PASS: staff-only planned room closures, date boundaries, availability, allocation and removal.");
}

// Post text or a photo through the same multipart route the staff dashboard uses.
async function postUpdate(bookingId, token, message, photo, expected = 201) {
  const form = new FormData();
  form.set("message", message);
  if (photo) form.set("photo", photo, "test-photo.png");
  const response = await fetch(
    origin + "/api/bookings/" + bookingId + "/updates",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: form,
      signal: AbortSignal.timeout(15000),
    },
  );
  const result = await response.json();
  assert.equal(response.status, expected, result.message);
  return result.data;
}

// Check that the owner receives text and photos while another customer cannot access either.
async function verifyPetUpdates(booking, owner, other, staff) {
  const feedPath = "/api/bookings/updates";
  await request(feedPath, "GET", null, null, 401);
  await request(feedPath, "GET", null, staff.token, 403);
  await postUpdate(booking.id, owner.token, "I cannot post this.", null, 403);
  await postUpdate(booking.id, staff.token, "   ", null, 400);
  await postUpdate(
    booking.id,
    staff.token,
    "",
    new Blob(["Not an image"], { type: "image/png" }),
    400,
  );
  await postUpdate(
    booking.id,
    staff.token,
    "",
    new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" }),
    413,
  );

  const message = "Care completed. Your pet finished their meal.";
  const written = await postUpdate(booking.id, staff.token, message);
  assert.equal(written.hasPhoto, false);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLZkAAAAASUVORK5CYII=",
    "base64",
  );
  const photographed = await postUpdate(
    booking.id,
    staff.token,
    "",
    new Blob([png], { type: "image/png" }),
  );
  assert.equal(photographed.hasPhoto, true);
  const both = await postUpdate(
    booking.id,
    staff.token,
    "Resting after lunch.",
    new Blob([png], { type: "image/png" }),
  );
  assert.equal(both.hasPhoto, true);
  assert.equal(both.message, "Resting after lunch.");

  const feed = await request(feedPath, "GET", null, owner.token);
  assert.deepEqual(
    feed.updates.map(/* Check newest-first ordering. */ (update) => update.id),
    [both.id, photographed.id, written.id],
  );
  assert.equal(feed.updates[2].message, message);
  assert.equal(feed.updates[2].petName, booking.petName);
  assert.equal(feed.updates[2].bookingId, booking.id);
  assert.equal(
    (await request(feedPath + "?before=" + both.id, "GET", null, owner.token))
      .updates.length,
    2,
  );
  assert.deepEqual(
    (await request(feedPath, "GET", null, other.token)).updates,
    [],
  );
  const photoPath = feedPath + "/" + photographed.id + "/photo";
  await request(photoPath, "GET", null, null, 401);
  await request(photoPath, "GET", null, other.token, 404);
  const image = await fetch(origin + photoPath, {
    headers: { Authorization: "Bearer " + owner.token },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  console.log(
    "PASS: special-care instructions, staff-only updates, photo validation, and private customer inbox.",
  );
}

// Exercise both directions, declined requests, and conflicts on approval.
async function verifyRescheduling(confirmed, customer, foreign, staff) {
  const path = "/api/bookings/" + confirmed.id + "/reschedules";
  const reason = "We need to move the stay";
  const earlier = { start: days(offset - 1), end: days(offset + 1), reason };
  const original = { start: confirmed.start, end: confirmed.end, reason };
  await request(path, "POST", earlier, foreign.token, 404);
  await request(
    path,
    "POST",
    { ...earlier, end: earlier.start },
    customer.token,
    400,
  );

  const extended = { ...earlier, end: confirmed.end };
  const quote = await request(
    path + "/quote?start=" + extended.start + "&end=" + extended.end,
    "GET",
    undefined,
    customer.token,
  );
  assert.equal(quote.newTotal, confirmed.total + confirmed.nightlyRate);
  assert.equal(quote.difference, confirmed.nightlyRate);
  await request(path, "POST", { ...extended, confirmedTotal: 0 }, customer.token, 409);
  const pending = await request(path, "POST", { ...extended, confirmedTotal: quote.newTotal }, customer.token, 201);
  assert.equal(pending.start, confirmed.start);
  assert.equal(pending.reschedule.status, "PENDING");
  await request(path, "POST", earlier, customer.token, 409);
  await request(
    "/api/bookings/" + confirmed.id + "/cancellations",
    "POST",
    { reason },
    customer.token,
    409,
  );

  const reviewPath = path + "/" + pending.reschedule.id;
  const approve = { decision: "APPROVED", notes: "New dates approved" };
  await request(reviewPath, "PATCH", approve, customer.token, 403);
  const closurePath = "/api/rooms/" + confirmed.roomId + "/closures";
  const closure = await request(closurePath, "POST",
    { start: earlier.start, reopen: confirmed.start }, staff.token, 201);
  await request(reviewPath, "PATCH", approve, staff.token, 409);
  const stillConfirmed = await request("/api/bookings/" + confirmed.id, "GET", null, customer.token);
  assert.equal(stillConfirmed.start, confirmed.start);
  assert.equal(stillConfirmed.roomId, confirmed.roomId);
  assert.equal(stillConfirmed.reschedule.status, "PENDING");
  await request(closurePath + "/" + closure.id, "DELETE", null, staff.token, 204);
  const moved = await request(reviewPath, "PATCH", approve, staff.token);
  assert.equal(moved.start, earlier.start);
  assert.equal(moved.end, extended.end);
  assert.equal(moved.roomId, confirmed.roomId);
  assert.equal(moved.total, quote.newTotal);
  assert.equal(moved.reschedule.difference, quote.difference);
  assert.ok(moved.reschedule.adjustmentReference);
  assert.equal(moved.specialCare, confirmed.specialCare);
  assert.equal(moved.paymentStatus, "SUCCESS");
  assert.equal(moved.reschedule.originalStart, confirmed.start);
  assert.equal(moved.reschedule.status, "APPROVED");

  const replay = await request(reviewPath, "PATCH", approve, staff.token);
  assert.equal(
    replay.logs.filter(
      /* Count approval events after replay. */ (entry) =>
        entry.action === "RESCHEDULE_APPROVED",
    ).length,
    1,
  );

  const later = await request(path, "POST", { ...original, confirmedTotal: confirmed.total }, customer.token, 201);
  const movedBack = await request(
    path + "/" + later.reschedule.id,
    "PATCH",
    approve,
    staff.token,
  );
  assert.equal(movedBack.start, confirmed.start);
  assert.equal(movedBack.end, confirmed.end);
  assert.equal(movedBack.total, confirmed.total);
  assert.equal(movedBack.reschedule.difference, -confirmed.nightlyRate);
  assert.ok(movedBack.reschedule.adjustmentReference);

  const occupied = { start: days(offset + 35), end: days(offset + 37), reason };
  await request(
    "/api/bookings",
    "POST",
    {
      petId: customer.pet.id,
      roomTypeId: confirmed.roomTypeId,
      start: occupied.start,
      end: occupied.end,
    },
    customer.token,
    201,
  );
  const conflict = await request(path, "POST", { ...occupied, confirmedTotal: confirmed.total }, customer.token, 201);
  const conflictPath = path + "/" + conflict.reschedule.id;
  await request(conflictPath, "PATCH", approve, staff.token, 409);
  await request(conflictPath, "PATCH", { decision: "DECLINED", notes: " " }, staff.token, 400);
  const declined = await request(
    conflictPath,
    "PATCH",
    { decision: "DECLINED", notes: "The pet already has another stay." },
    staff.token,
  );
  assert.equal(declined.start, confirmed.start);
  assert.equal(declined.end, confirmed.end);
  assert.equal(declined.status, "CONFIRMED");
  assert.equal(declined.reschedule.status, "DECLINED");
  assert.equal(declined.reschedule.note, "The pet already has another stay.");
  console.log(
    "PASS: earlier and later reschedules, ownership, simulated price adjustments, retry, overlap conflict, and decline.",
  );
}
