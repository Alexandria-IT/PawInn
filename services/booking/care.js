import express from "express";
import {
  body,
  fail,
  id,
  send,
  text,
  today,
  transaction,
} from "../shared/runtime.js";
import { sweepNoShows } from "../shared/attendance.js";
import { readMultipartForm, readPhoto } from "./updates.js";

const bangkokDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const zonedTimestamp =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const carePath = "/bookings/:id/care";
const dayPath = `${carePath}/days/:date`;
const eventFields = [
  "time", "careType", "action", "observation", "status", "reason", "followUp",
];

// Accept only real ISO calendar dates.
function careDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000")
  )
    fail(400, "Choose a valid care date.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value)
    fail(400, "Choose a valid care date.");
  return value;
}

// Use the provided actual time, or the time of the request.
function attendanceTime(at) {
  if (at === undefined) return new Date();
  if (typeof at !== "string" || !zonedTimestamp.test(at))
    fail(400, "Enter a time with its timezone.");
  careDate(at.slice(0, 10));
  const parsed = new Date(at);
  if (!Number.isFinite(+parsed) || parsed.getUTCFullYear() < 1 || +parsed > Date.now())
    fail(400, "Enter an actual time in the past or now.");
  return parsed;
}

// Format a Bangkok date with the four-digit year expected by care routes.
function localCareDate(value) {
  return bangkokDate.format(new Date(value)).padStart(10, "0");
}

// Derive the Bangkok care period from actual attendance.
function carePeriod({ arrivedAt, pickedUpAt }) {
  if (!arrivedAt) return null;
  return {
    start: localCareDate(arrivedAt),
    end: pickedUpAt ? localCareDate(pickedUpAt) : today(),
  };
}

// Validate that a write belongs to a day in the actual stay.
function requireCareDay(booking, date) {
  const period = carePeriod(booking);
  if (!period || date < period.start || date > period.end)
    fail(409, "Choose a date during the actual stay.");
}

// List each local calendar date, including arrival and pickup dates.
function emptyDays(booking) {
  const period = carePeriod(booking);
  const days = new Map();
  if (!period) return days;
  const date = new Date(`${period.start}T00:00:00Z`);
  const last = Date.parse(`${period.end}T00:00:00Z`);
  while (+date <= last) {
    const key = date.toISOString().slice(0, 10);
    days.set(key, { date: key, report: null, events: [] });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

// Load report metadata and its currently published photos without image bytes.
async function reports(db, bookingId, date = null) {
  const { rows } = await db.query(
    `SELECT r.report_id::text AS id, r.care_date::text AS date,
            r.message, r.created_at AS "createdAt",
            json_build_object('id', u.user_id::text, 'name', u.full_name) AS "recordedBy",
            (SELECT coalesce(json_agg(json_build_object('id', p.photo_id::text,
              'contentType', p.content_type) ORDER BY p.photo_id), '[]')
             FROM booking_care_photos p WHERE p.report_id=r.report_id AND p.is_current) AS photos
     FROM booking_care_reports r JOIN users u ON u.user_id=r.staff_user_id
     WHERE r.booking_id=$1 AND ($2::date IS NULL OR r.care_date=$2)`,
    [bookingId, date],
  );
  return rows;
}

// Load events in local care time, with creation order breaking ties.
async function events(db, bookingId, date = null, eventId = null) {
  const { rows } = await db.query(
    `SELECT e.event_id::text AS id, e.care_date::text AS date,
            left(e.event_time::text, 5) AS time, e.care_type AS "careType",
            e.action, e.observation, e.status, e.reason, e.follow_up AS "followUp",
            json_build_object('id', u.user_id::text, 'name', u.full_name) AS "recordedBy",
            e.created_at AS "createdAt"
     FROM booking_care_events e JOIN users u ON u.user_id=e.staff_user_id
     WHERE e.booking_id=$1 AND ($2::date IS NULL OR e.care_date=$2)
       AND ($3::int IS NULL OR e.event_id=$3)
     ORDER BY e.care_date, e.event_time, e.event_id`,
    [bookingId, date, eventId],
  );
  return rows;
}

// Preserve the complete previous record alongside the editor and edit time.
async function audit(db, bookingId, date, kind, before, actor) {
  await db.query(
    `INSERT INTO booking_care_corrections
      (booking_id, care_date, kind, record_id, before_values, editor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [bookingId, date, kind, before.id, before, actor],
  );
}

// Read previous versions only for the staff history response.
async function corrections(db, bookingId) {
  const { rows } = await db.query(
    `SELECT c.correction_id::text AS id, c.care_date::text AS date, c.kind,
            c.record_id::text AS "recordId", c.before_values AS "before",
            json_build_object('id', u.user_id::text, 'name', u.full_name) AS "editedBy",
            c.edited_at AS "editedAt"
     FROM booking_care_corrections c JOIN users u ON u.user_id=c.editor_user_id
     WHERE c.booking_id=$1 ORDER BY c.correction_id`,
    [bookingId],
  );
  return rows;
}

// Return the owner filter used for any booking-scoped read.
function owner({ user }) {
  return user.role === "STAFF" ? null : user.user_id;
}

// Parse a daily message with any uploaded report photos.
async function readReport(req) {
  const form = await readMultipartForm(req, "daily report");
  for (const key of form.keys()) {
    if (key !== "photo" && key !== "message")
      fail(400, "Check the report fields.");
  }
  if (form.getAll("message").length !== 1)
    fail(400, "Enter a daily report message.");
  return {
    message: text(form.get("message"), 2000),
    photos: await Promise.all(form.getAll("photo").map(readPhoto)),
  };
}

// Publish a report or correct it while retaining the replaced images for audit.
async function saveReport(db, bookingId, date, { message, photos }, actor) {
  const [before] = await reports(db, bookingId, date);
  if (!before && !photos.length)
    fail(400, "Attach at least one daily report photo.");
  if (before && before.message === message && !photos.length)
    return { report: before, status: 200 };
  let reportId = before?.id;
  if (before) {
    await audit(db, bookingId, date, "REPORT", before, actor);
    await db.query(
      "UPDATE booking_care_reports SET message=$2 WHERE report_id=$1",
      [reportId, message],
    );
    if (photos.length) {
      await db.query(
        "UPDATE booking_care_photos SET is_current=FALSE WHERE report_id=$1 AND is_current",
        [reportId],
      );
    }
  } else {
    const { rows: [created] } = await db.query(
      `INSERT INTO booking_care_reports (booking_id, care_date, message, staff_user_id)
       VALUES ($1, $2, $3, $4) RETURNING report_id`,
      [bookingId, date, message, actor],
    );
    reportId = created.report_id;
  }
  for (const { photo, photoType } of photos) {
    await db.query(
      `INSERT INTO booking_care_photos (report_id, content, content_type) VALUES ($1, $2, $3)`,
      [reportId, photo, photoType],
    );
  }
  const [report] = await reports(db, bookingId, date);
  return { report, status: before ? 200 : 201 };
}

// Validate structured care event details in SQL parameter order.
function readEvent(req) {
  const event = body(req, eventFields);
  if (typeof event.time !== "string" || !clockTime.test(event.time))
    fail(400, "Choose a valid event time.");
  const status = event.status ?? "PERFORMED";
  if (!["PERFORMED", "NOT_PERFORMED"].includes(status))
    fail(400, "Choose a valid event status.");
  const performed = status === "PERFORMED";
  const reason = text(event.reason, 1000, performed) || null;
  const followUp = text(event.followUp, 1000, performed) || null;
  if (performed && (reason || followUp))
    fail(400, "Give a reason and follow-up only when care was not performed.");
  return [
    event.time,
    text(event.careType, 100),
    text(event.action, 1000),
    text(event.observation, 1000),
    status,
    reason,
    followUp,
  ];
}

// Record actual arrival or pickup, preserving the legacy completion log on pickup.
async function saveAttendance(db, booking, actor, kind, at, supplied, log) {
  const pickup = kind === "pickup";
  const previous = pickup ? booking.pickedUpAt : booking.arrivedAt;
  const { id: bookingId, arrivedAt, pickedUpAt, status, latePickupFee } = booking;
  if (previous) {
    if (!supplied || +new Date(previous) === +at)
      return { arrivedAt, pickedUpAt, status, latePickupFee };
    fail(409, "That attendance time is already recorded.");
  }
  if (booking.noShowAt)
    fail(409, "The check-in day has passed. The room was released without a refund.");
  if (status !== "CONFIRMED")
    fail(409, "Attendance can only be recorded for confirmed bookings.");
  const date = localCareDate(at);
  if (!pickup) {
    if (date !== booking.start || today() !== booking.start)
      fail(409, "Record arrival on the first day of the booking (Bangkok time).");
    const opensAt = Date.parse(`${booking.start}T${booking.checkInOpensAt}:00+07:00`);
    if (+at < opensAt)
      fail(409, `Check-in opens at ${booking.checkInOpensAt} Bangkok time.`);
    const { rowCount } = await db.query(
      "SELECT 1 FROM bookings WHERE room_id=$1 AND booking_id<>$2 AND status='CONFIRMED' AND arrived_at IS NOT NULL AND picked_up_at IS NULL LIMIT 1",
      [booking.roomId, bookingId],
    );
    if (rowCount) fail(409, "This room is still occupied. Record the previous stay's pickup first.");
    await db.query("UPDATE bookings SET arrived_at=$2 WHERE booking_id=$1", [
      bookingId,
      at,
    ]);
    await log(db, bookingId, actor, "STAY_ARRIVED", "Actual arrival recorded.");
    return { arrivedAt: at, pickedUpAt, status, latePickupFee };
  }
  if (!arrivedAt || +at < +new Date(arrivedAt))
    fail(409, "Record arrival before pickup.");
  if (
    booking.cancellation?.status === "PENDING" ||
    booking.reschedule?.status === "PENDING"
  )
    fail(409, "Review the open booking request before recording pickup.");
  const {
    rows: [{ hasLaterCare }],
  } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM booking_care_reports WHERE booking_id=$1 AND care_date>$2
                    UNION ALL
                    SELECT 1 FROM booking_care_events WHERE booking_id=$1 AND care_date>$2) AS "hasLaterCare"`,
    [bookingId, date],
  );
  if (hasLaterCare)
    fail(409, "The pickup date cannot precede an existing care record.");
  const deadline = Date.parse(`${booking.end}T${booking.pickupDeadline}:00+07:00`);
  const lateHours = Math.max(0, Math.ceil((+at - deadline) / 3_600_000));
  const fee = lateHours * booking.latePickupHourlyRate;
  await db.query(
    "UPDATE bookings SET picked_up_at=$2, status='COMPLETED', late_pickup_fee=$3 WHERE booking_id=$1",
    [bookingId, at, fee],
  );
  await log(db, bookingId, actor, "STAY_COMPLETED", "Actual pickup recorded. Stay marked completed.");
  if (fee > 0) {
    await log(db, bookingId, actor, "LATE_PICKUP_CHARGED",
      `Simulated late pickup charge of THB ${fee} for ${lateHours} started hour(s).`);
  }
  return { arrivedAt, pickedUpAt: at, status: "COMPLETED", latePickupFee: fee };
}

// Register the attendance, daily care history, and private photo endpoints.
export function registerCareRoutes(router, pool, auth, { getBooking, log }) {
  router.get(carePath, auth(), async (req, res) => {
    const bookingId = id(req.params.id);
    await sweepNoShows(pool);
    const history = await transaction(pool, async (db) => {
      const booking = await getBooking(db, bookingId, owner(req));
      const { petId, petName, status, arrivedAt, pickedUpAt } = booking;
      const byDate = emptyDays(booking);
      for (const report of await reports(db, bookingId)) {
        const day = byDate.get(report.date);
        if (day) day.report = report;
      }
      for (const event of await events(db, bookingId))
        byDate.get(event.date)?.events.push(event);
      const days = [...byDate.values()];
      const result = {
        bookingId: booking.id,
        petId,
        petName,
        status,
        arrivedAt,
        pickedUpAt,
        noShowAt: booking.noShowAt,
        latePickupFee: booking.latePickupFee,
        checkInOpensAt: booking.checkInOpensAt,
        pickupDeadline: booking.pickupDeadline,
        latePickupHourlyRate: booking.latePickupHourlyRate,
        days,
        missingReportDates: days.filter((day) => !day.report).map((day) => day.date),
      };
      if (req.user.role === "STAFF")
        result.corrections = await corrections(db, bookingId);
      return result;
    });
    send(res, history);
  });

  router.get(`${carePath}/photos/:photoId`, auth(), async (req, res) => {
    const bookingId = id(req.params.id);
    const photoId = id(req.params.photoId);
    await getBooking(pool, bookingId, owner(req));
    const { rows: [photo] } = await pool.query(
      `SELECT p.content, p.content_type
       FROM booking_care_photos p JOIN booking_care_reports r USING (report_id)
       WHERE r.booking_id=$1 AND p.photo_id=$2 AND (p.is_current OR $3::boolean)`,
      [bookingId, photoId, req.user.role === "STAFF"],
    );
    if (!photo) fail(404, "Photo not found.");
    res.type(photo.content_type).send(photo.content);
  });

  for (const kind of ["arrival", "pickup"]) {
    router.patch(`${carePath}/${kind}`, auth("STAFF"), async (req, res) => {
      const bookingId = id(req.params.id);
      const { at } = body(req, ["at"]);
      const timestamp = attendanceTime(at);
      await sweepNoShows(pool);
      const attendance = await transaction(pool, async (db) => {
        const booking = await getBooking(db, bookingId, null);
        return saveAttendance(
          db,
          booking,
          req.user.user_id,
          kind,
          timestamp,
          at !== undefined,
          log,
        );
      });
      send(res, attendance);
    });
  }

  router.put(
    `${dayPath}/report`,
    auth("STAFF"),
    express.raw({ type: "multipart/form-data", limit: "3mb" }),
    async (req, res) => {
      const bookingId = id(req.params.id);
      const date = careDate(req.params.date);
      const input = await readReport(req);
      const result = await transaction(pool, async (db) => {
        requireCareDay(await getBooking(db, bookingId, null), date);
        return saveReport(db, bookingId, date, input, req.user.user_id);
      });
      send(res, result.report, result.status);
    },
  );

  router.post(`${dayPath}/events`, auth("STAFF"), async (req, res) => {
    const bookingId = id(req.params.id);
    const date = careDate(req.params.date);
    const input = readEvent(req);
    const event = await transaction(pool, async (db) => {
      requireCareDay(await getBooking(db, bookingId, null), date);
      const { rows: [created] } = await db.query(
        `INSERT INTO booking_care_events (booking_id, care_date, event_time, care_type, action,
                                         observation, status, reason, follow_up, staff_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING event_id`,
        [bookingId, date, ...input, req.user.user_id],
      );
      const [record] = await events(db, bookingId, date, created.event_id);
      return record;
    });
    send(res, event, 201);
  });

  router.patch(`${dayPath}/events/:eventId`, auth("STAFF"), async (req, res) => {
    const bookingId = id(req.params.id);
    const date = careDate(req.params.date);
    const eventId = id(req.params.eventId);
    const input = readEvent(req);
    const event = await transaction(pool, async (db) => {
      requireCareDay(await getBooking(db, bookingId, null), date);
      const [before] = await events(db, bookingId, date, eventId);
      if (!before) fail(404, "Care event not found.");
      if (eventFields.every((field, index) => before[field] === input[index]))
        return before;
      await audit(db, bookingId, date, "EVENT", before, req.user.user_id);
      await db.query(
        `UPDATE booking_care_events SET event_time=$2, care_type=$3, action=$4,
                 observation=$5, status=$6, reason=$7, follow_up=$8 WHERE event_id=$1`,
        [eventId, ...input],
      );
      const [record] = await events(db, bookingId, date, eventId);
      return record;
    });
    send(res, event);
  });
}
