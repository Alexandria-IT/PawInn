import assert from "node:assert/strict";

const bangkokDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});

// Verify actual stay dates, daily records, privacy, and correction history.
export async function verifyCare({ request, staff, customer, foreign, booking, origin }) {
  const staffToken = staff.token ?? staff;
  const customerToken = customer.token ?? customer;
  const foreignToken = foreign.token ?? foreign;
  const path = `/api/bookings/${booking.id}/care`;
  const now = Date.now();
  const calendarDate = (offset) => bangkokDate.format(new Date(now - offset * 86_400_000));
  const [arrivalDay, middleDay, pickupDay] = [calendarDate(3), calendarDate(2), calendarDate(1)];
  const arrival = `${arrivalDay}T00:30:00+07:00`;
  const pickup = `${pickupDay}T00:30:00+07:00`;
  const reportPath = (date) => `${path}/days/${date}/report`;
  const eventPath = `${path}/days/${arrivalDay}/events`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY/i/lOE/AAbvAqQmCdQ0AAAAAElFTkSuQmCC",
    "base64",
  );
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3iiiiv8+j+mz/2Q==",
    "base64",
  );

  // Use the browser-compatible multipart request path for staff report writes.
  async function report(date, message, photo, type, expected = 200) {
    const form = new FormData();
    if (message !== null) form.append("message", message);
    if (photo) form.append("photo", new Blob([photo], { type }), "care-photo");
    const response = await fetch(origin + reportPath(date), {
      method: "PUT", headers: { Authorization: `Bearer ${staffToken}` },
      body: form, signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, payload.message);
    return payload.data;
  }

  // Verify private photo responses through the same public API as the UI.
  async function photo(photoId, token, expected, contentType, bytes) {
    const response = await fetch(`${origin}${path}/photos/${photoId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, expected);
    if (expected === 200) {
      assert.equal(response.headers.get("content-type"), contentType);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
  }

  assert.deepEqual((await request(path, "GET", null, customerToken)).days, []);
  await request(path, "GET", null, foreignToken, 404);
  await request(`${path}/arrival`, "PATCH", { at: arrival }, customerToken, 403);
  await request(`${path}/pickup`, "PATCH", { at: pickup }, staffToken, 409);
  assert.equal(
    (await request(`${path}/arrival`, "PATCH", { at: arrival }, staffToken)).arrivedAt,
    new Date(arrival).toISOString(),
  );
  await request(`${path}/pickup`, "PATCH", { at: `${arrivalDay}T00:15:00+07:00` }, staffToken, 409);
  await request(`/api/bookings/${booking.id}/complete`, "PATCH", null, staffToken, 409);
  await report(arrivalDay, "Missing photo", null, null, 400);
  await report(arrivalDay, null, png, "image/png", 400);
  await report(arrivalDay, "Invalid image", Buffer.from("not an image"), "image/png", 400);
  await report(calendarDate(4), "Before arrival", png, "image/png", 409);
  const originalReport = await report(arrivalDay, "Ate dinner normally.", png, "image/png", 201);
  const originalPhoto = originalReport.photos[0].id;
  await photo(originalPhoto, customerToken, 200, "image/png", png);
  await photo(originalPhoto, staffToken, 200, "image/png", png);
  await photo(originalPhoto, foreignToken, 404);
  await photo(originalPhoto, null, 401);

  const firstEvent = {
    time: "17:00", careType: "Feeding", action: "Served dinner",
    observation: "Ate normally", status: "PERFORMED",
  };
  const secondEvent = {
    time: "07:00", careType: "Exercise", action: "Morning walk",
    observation: "Resting comfortably", status: "NOT_PERFORMED", reason: "Rain",
    followUp: "Try again at noon",
  };
  await request(eventPath, "POST", firstEvent, customerToken, 403);
  const event = await request(eventPath, "POST", firstEvent, staffToken, 201);
  await request(eventPath, "POST", { ...firstEvent, reason: "Not applicable" }, staffToken, 400);
  await request(eventPath, "POST", { ...secondEvent, followUp: "" }, staffToken, 400);
  await request(eventPath, "POST", secondEvent, staffToken, 201);
  const active = await request(path, "GET", null, customerToken);
  assert.equal(active.days[0].date, arrivalDay);
  assert.deepEqual(active.days[0].events.map((entry) => entry.time), ["07:00", "17:00"]);
  assert.equal(active.days[0].events[0].followUp, "Try again at noon");
  assert.ok(active.days[0].events[1].recordedBy.id);
  assert.equal(active.corrections, undefined);

  await request(`${path}/days/${middleDay}/events`, "POST", firstEvent, staffToken, 201);
  await request(`${path}/pickup`, "PATCH", { at: arrival }, staffToken, 409);
  const checkout = await request(`${path}/pickup`, "PATCH", { at: pickup }, staffToken);
  assert.equal(checkout.status, "COMPLETED");
  assert.equal(checkout.pickedUpAt, new Date(pickup).toISOString());
  assert.equal((await request(`/api/bookings/${booking.id}`, "GET", null, customerToken)).status, "COMPLETED");
  await report(calendarDate(0), "After pickup", png, "image/png", 409);
  const replacement = await report(arrivalDay, "Ate the full meal.", jpeg, "image/png");
  assert.equal(replacement.id, originalReport.id);
  assert.deepEqual(
    (await report(arrivalDay, "Ate the full meal.")).photos,
    replacement.photos,
  );
  await request(`${eventPath}/${event.id}`, "PATCH", { ...firstEvent, observation: "Ate all food" }, staffToken);

  const ownerHistory = await request(path, "GET", null, customerToken);
  assert.deepEqual(ownerHistory.days.map((day) => day.date), [arrivalDay, middleDay, pickupDay]);
  assert.deepEqual(ownerHistory.missingReportDates, [middleDay, pickupDay]);
  assert.equal(ownerHistory.days[0].report.message, "Ate the full meal.");
  assert.equal(ownerHistory.days[0].events[1].observation, "Ate all food");
  assert.equal(ownerHistory.corrections, undefined);
  await photo(replacement.photos[0].id, customerToken, 200, "image/jpeg", jpeg);
  await photo(originalPhoto, customerToken, 404);
  await photo(originalPhoto, staffToken, 200, "image/png", png);
  await report(pickupDay, "Ready to go home.", png, "image/png", 201);
  assert.deepEqual((await request(path, "GET", null, customerToken)).missingReportDates, [middleDay]);
  const staffHistory = await request(path, "GET", null, staffToken);
  assert.equal(staffHistory.corrections.length, 2);
  const reportAudit = staffHistory.corrections.find((entry) => entry.kind === "REPORT");
  const eventAudit = staffHistory.corrections.find((entry) => entry.kind === "EVENT");
  assert.equal(reportAudit.before.message, "Ate dinner normally.");
  assert.equal(reportAudit.before.photos[0].id, originalPhoto);
  assert.equal(eventAudit.before.observation, "Ate normally");
  assert.ok(reportAudit.editedBy.id && eventAudit.editedBy.id);
  assert.ok(Date.parse(reportAudit.editedAt) && Date.parse(eventAudit.editedAt));
  console.log("PASS: actual attendance, Bangkok care dates, reports, events, photo privacy, and correction audit.");
}
