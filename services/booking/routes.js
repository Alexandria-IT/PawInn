import {
  fail,
  id,
  send,
  body,
  transaction,
  today,
  stay,
  text,
  holdMinutes,
} from "../shared/runtime.js";
import {
  checkInOpensAt,
  hotelDateSql,
  pickupDeadline,
  latePickupHourlyRate,
  releaseNoShows,
  sweepNoShows,
} from "../shared/attendance.js";
import { registerUpdateRoutes } from "./updates.js";
import { registerCareRoutes } from "./care.js";
import { registerBookingEvents } from "./live.js";

const showFixtures = /^(1|true)$/i.test(process.env.PAWINN_SEED_DEMO || "");
const visibleCustomer = showFixtures
  ? "TRUE"
  : "lower(u.email) NOT LIKE '%@pawinn.demo'";

const paymentLogPrefix = {
  SUCCESS: "Simulated payment accepted. ",
  FAILED: "Simulated payment declined. ",
};

// Keep list, detail, and mutation responses on the same projection.
const selection = `
  SELECT
    b.booking_id::text AS id,
    b.user_id::text AS "userId",
    b.pet_id::text AS "petId",
    b.room_id::text AS "roomId",
    r.room_type_id::text AS "roomTypeId",
    r.room_number AS "roomNumber",
    t.name AS "roomName",
    t.species,
    p.name AS "petName",
    u.full_name AS "customerName",
    u.phone AS "customerPhone",
    b.check_in_date::text AS start,
    b.check_out_date::text AS end,
    b.nightly_rate::float8 AS "nightlyRate",
    b.total_price::float8 AS total,
    b.special_care AS "specialCare",
    b.arrived_at AS "arrivedAt",
    b.picked_up_at AS "pickedUpAt",
    b.no_show_at AS "noShowAt",
    b.late_pickup_fee::float8 AS "latePickupFee",
    (b.total_price + b.late_pickup_fee)::float8 AS "totalWithFees",
    '${checkInOpensAt}' AS "checkInOpensAt",
    '${pickupDeadline}' AS "pickupDeadline",
    ${latePickupHourlyRate} AS "latePickupHourlyRate",
    b.status,
    b.created_at AS "createdAt",
    b.payment_status AS "paymentStatus",
    b.refund_status AS "refundStatus",
    b.refund_amount::float8 AS "refundAmount",
    extract(epoch FROM (b.created_at + interval '${holdMinutes} minutes'))::float8 * 1000 AS "expiresAt",
    c.item AS cancellation,
    changes.item AS reschedule,
    (
      SELECT coalesce(
        json_agg(json_build_object('action', l.action, 'at', l.created_at, 'text', l.details) ORDER BY l.log_id),
        '[]'
      )
      FROM booking_logs l
      WHERE l.booking_id = b.booking_id
    ) AS logs
  FROM bookings b
  JOIN pets p USING (pet_id)
  JOIN users u ON u.user_id = b.user_id
  JOIN rooms r USING (room_id)
  JOIN room_types t USING (room_type_id)
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', cancellation_request_id::text,
      'status', CASE WHEN b.no_show_at IS NOT NULL AND status='PENDING' THEN 'EXPIRED' ELSE status END,
      'reason', reason, 'note', review_notes
    ) AS item
    FROM cancellation_requests
    WHERE booking_id = b.booking_id
    ORDER BY cancellation_request_id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', reschedule_request_id::text,
      'status', CASE WHEN b.no_show_at IS NOT NULL AND status='PENDING' THEN 'EXPIRED' ELSE status END,
      'reason', reason, 'note', review_notes,
      'originalStart', original_check_in::text, 'originalEnd', original_check_out::text,
      'start', requested_check_in::text, 'end', requested_check_out::text,
      'originalTotal', original_total, 'newTotal', new_total,
      'difference', new_total - original_total, 'adjustmentReference', adjustment_reference
    ) AS item
    FROM reschedule_requests
    WHERE booking_id = b.booking_id
    ORDER BY reschedule_request_id DESC
    LIMIT 1
  ) changes ON true`;

// Append an audit entry inside the caller's transaction.
async function log(db, booking, user, action, details) {
  await db.query(
    "INSERT INTO booking_logs(booking_id,actor_user_id,action,details) VALUES ($1,$2,$3,$4)",
    [booking, user, action, details],
  );
}
// Reclaim unpaid holds and write the expiry audit entry in the same transaction.
async function expire(db) {
  await releaseNoShows(db);
  await db.query(`WITH expired AS (
    UPDATE bookings
    SET status = 'CANCELLED'
    WHERE status = 'PENDING' AND (created_at <= now() - interval '${holdMinutes} minutes'
      OR check_in_date < ${hotelDateSql})
    RETURNING booking_id
  )
  INSERT INTO booking_logs (booking_id, action, details)
  SELECT booking_id, 'HOLD_EXPIRED', 'Unpaid hold expired.'
  FROM expired`);
}
// Fetch one visible booking, optionally scoped to its owner.
async function get(db, booking, user) {
  const {
    rows: [row],
  } = await db.query(
    selection +
      ` WHERE b.booking_id=$1 AND ($2::int IS NULL OR b.user_id=$2) AND ${visibleCustomer}`,
    [booking, user],
  );
  if (!row) fail(404, "Booking not found.");
  return row;
}

// Closures start at midnight, so a stay must also have its checkout day clear.
function noClosure(start, end) {
  return `NOT EXISTS (
    SELECT 1 FROM room_closures c WHERE c.room_id=r.room_id
      AND c.starts_on<=${end}::date AND c.reopens_on>${start}::date
  )`;
}

// Find a room under the inventory lock, optionally ignoring the stay being moved.
async function availableRoom(
  db,
  roomTypeId,
  start,
  end,
  bookingId = null,
  preferredRoomId = null,
) {
  const {
    rows: [room],
  } = await db.query(
    `SELECT r.room_id FROM rooms r
     WHERE r.room_type_id=$1 AND r.is_active
       AND ${noClosure("$2", "$3")}
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.room_id=r.room_id AND b.status IN ('PENDING','CONFIRMED')
           AND ((b.check_in_date<$3::date AND b.check_out_date>$2::date)
             OR ($2::date=${hotelDateSql} AND b.arrived_at IS NOT NULL AND b.picked_up_at IS NULL))
           AND ($4::int IS NULL OR b.booking_id<>$4)
       )
     ORDER BY (r.room_id=$5::int) DESC NULLS LAST, r.room_id
     LIMIT 1 FOR UPDATE`,
    [roomTypeId, start, end, bookingId, preferredRoomId],
  );
  return room;
}

// Check the pet's dates before assigning a room so the owner can resolve an overlap.
async function requireNoPetOverlap(db, petId, start, end, excludedBooking = null) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM bookings WHERE pet_id=$1 AND status IN ('PENDING','CONFIRMED')
      AND check_in_date<$3::date AND check_out_date>$2::date
      AND ($4::int IS NULL OR booking_id<>$4) LIMIT 1`,
    [petId, start, end, excludedBooking],
  );
  if (rowCount)
    fail(409, "This pet already has a reservation that overlaps these dates. Check My bookings or choose different dates.");
}

// Validate an upcoming date change and price it at the booked nightly rate.
async function rescheduleQuote(db, booking, start, end) {
  stay(start, end);
  if (start <= today()) fail(400, "Choose a new check-in after today.");
  if (booking.status !== "CONFIRMED" || booking.start <= today() || booking.arrivedAt)
    fail(409, "Only upcoming confirmed stays can be rescheduled.");
  if (booking.cancellation?.status === "PENDING" || booking.reschedule?.status === "PENDING")
    fail(409, "This booking already has a request awaiting review.");
  if (start === booking.start && end === booking.end)
    fail(400, "Choose a different check-in or check-out date.");
  const { rows: [quote] } = await db.query(
    `SELECT $1::numeric::float8 AS "originalTotal",
       ($2::numeric * ($4::date - $3::date))::float8 AS "newTotal",
       ($2::numeric * ($4::date - $3::date) - $1::numeric)::float8 AS difference`,
    [booking.total, booking.nightlyRate, start, end],
  );
  return quote;
}

// Require an explanation for a declined change.
function reviewNote(notes, decision) {
  const note = text(typeof notes === "string" ? notes.trim() : notes, 1000, true);
  if (decision === "DECLINED" && !note) fail(400, "Enter a reason for declining the request.");
  return note;
}

// Register availability, booking, checkout, and request review routes.
export function routes(router, pool, auth) {
  // Register the inbox before the generic booking detail route.
  registerBookingEvents(router, pool, auth);
  registerUpdateRoutes(router, pool, auth, { getBooking: get, log });
  registerCareRoutes(router, pool, auth, { getBooking: get, log });
  // Expire holds under the shared inventory lock.
  const expireHolds = () => transaction(pool, expire);
  router.get(
    "/availability",
    /* Count available rooms by type for the requested dates. */ async (
      req,
      res,
    ) => {
      const { start, end, species } = req.query;
      stay(start, end);
      if (species !== undefined && !["Dog", "Cat"].includes(species))
        fail(400, "Choose Dog or Cat.");
      await expireHolds();
      const { rows } = await pool.query(
        `SELECT t.room_type_id::text AS "roomTypeId",count(r.room_id)::int AS available
       FROM room_types t LEFT JOIN rooms r ON r.room_type_id=t.room_type_id AND r.is_active
         AND ${noClosure("$1", "$2")}
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id=r.room_id AND b.status IN ('PENDING','CONFIRMED')
           AND ((b.check_in_date<$2::date AND b.check_out_date>$1::date)
             OR ($1::date=${hotelDateSql} AND b.arrived_at IS NOT NULL AND b.picked_up_at IS NULL)))
       WHERE ($3::text IS NULL OR t.species=$3) GROUP BY t.room_type_id ORDER BY t.room_type_id`,
        [start, end, species ?? null],
      );
      send(res, rows);
    },
  );
  router.get(
    "/bookings",
    auth(),
    /* List visible bookings with optional pet and status filters. */ async (
      req,
      res,
    ) => {
      const pet = req.query.petId === undefined ? null : id(req.query.petId);
      const status = req.query.status ?? null;
      if (
        status !== null &&
        !["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"].includes(status)
      )
        fail(400, "Unknown booking status.");
      await expireHolds();
      const { rows } = await pool.query(
        selection +
          ` WHERE ($1::int IS NULL OR b.user_id=$1) AND ($2::int IS NULL OR b.pet_id=$2) AND ($3::text IS NULL OR b.status=$3) AND ${visibleCustomer} ORDER BY b.created_at DESC,b.booking_id DESC`,
        [req.user.role === "STAFF" ? null : req.user.user_id, pet, status],
      );
      send(res, rows);
    },
  );
  router.get(
    "/bookings/:id",
    auth(),
    /* Fetch the requested booking and its audit history. */ async (
      req,
      res,
    ) => {
      await expireHolds();
      send(
        res,
        await get(
          pool,
          id(req.params.id),
          req.user.role === "STAFF" ? null : req.user.user_id,
        ),
      );
    },
  );
  router.post(
    "/bookings",
    auth("CUSTOMER"),
    /* Validate a customer's reservation request. */ async (req, res) => {
      const { petId, roomTypeId, start, end, specialCare } = body(req, [
        "petId",
        "roomTypeId",
        "start",
        "end",
        "specialCare",
      ]);
      const careInstructions = text(
        typeof specialCare === "string" ? specialCare.trim() : specialCare,
        2000,
        true,
      );
      if (!req.user.phone?.trim())
        fail(400, "Add a phone number so staff can reach you in an emergency.");
      const requestedPetId = id(petId);
      const requestedRoomTypeId = id(roomTypeId);
      const owner = req.user.user_id;
      stay(start, end);
      const result = await transaction(
        pool,
        /* Lock the pet and reserve a compatible available room. */ async (
          db,
        ) => {
          await expire(db);
          stay(start, end);
          const {
            rows: [pet],
          } = await db.query(
            "SELECT species FROM pets WHERE pet_id=$1 AND owner_id=$2 FOR UPDATE",
            [requestedPetId, owner],
          );
          if (!pet) fail(404, "Pet not found.");
          const {
            rows: [roomType],
          } = await db.query(
            "SELECT species,price_per_night FROM room_types WHERE room_type_id=$1",
            [requestedRoomTypeId],
          );
          if (!roomType) fail(404, "Room type not found.");
          if (roomType.species !== pet.species)
            fail(400, "This room type is not suitable for that pet.");
          await requireNoPetOverlap(db, requestedPetId, start, end);
          const room = await availableRoom(db, requestedRoomTypeId, start, end);
          if (!room)
            fail(
              409,
              "No rooms are available for those dates. Choose different dates or a different room.",
            );
          // Snapshot the nightly rate and calculate the total with PostgreSQL decimals.
          const {
            rows: [created],
          } = await db.query(
            `INSERT INTO bookings(user_id,pet_id,room_id,check_in_date,check_out_date,nightly_rate,total_price,special_care)
        VALUES($1,$2,$3,$4::date,$5::date,$6::numeric,$6::numeric*($5::date-$4::date),$7) RETURNING booking_id`,
            [
              owner,
              requestedPetId,
              room.room_id,
              start,
              end,
              roomType.price_per_night,
              careInstructions,
            ],
          );
          await log(
            db,
            created.booking_id,
            owner,
            "BOOKING_CREATED",
            `Room held for ${holdMinutes} minutes.`,
          );
          return get(db, created.booking_id, owner);
        },
      );
      send(res, result, 201);
    },
  );
  router.patch(
    "/bookings/:id/hold",
    auth("CUSTOMER"),
    /* Edit an unpaid hold without extending its original expiry. */ async (req, res) => {
      const bookingId = id(req.params.id);
      const owner = req.user.user_id;
      const { petId, roomTypeId, start, end, specialCare } = body(req, [
        "petId", "roomTypeId", "start", "end", "specialCare",
      ]);
      const petKey = id(petId);
      const typeKey = id(roomTypeId);
      const care = text(typeof specialCare === "string" ? specialCare.trim() : specialCare, 2000, true);
      stay(start, end);
      const result = await transaction(pool, /* Validate and move the held booking in one write. */ async (db) => {
        await expire(db);
        const booking = await get(db, bookingId, owner);
        if (booking.status !== "PENDING" || booking.expiresAt <= Date.now())
          fail(409, "This hold cannot be edited. Start a new reservation if your hold expired.");
        const { rows: [pet] } = await db.query(
          "SELECT species FROM pets WHERE pet_id=$1 AND owner_id=$2 FOR UPDATE", [petKey, owner],
        );
        if (!pet) fail(404, "Pet not found.");
        const { rows: [type] } = await db.query(
          "SELECT species, price_per_night FROM room_types WHERE room_type_id=$1", [typeKey],
        );
        if (!type || type.species !== pet.species) fail(400, "Choose a room type that suits your pet.");
        await requireNoPetOverlap(db, petKey, start, end, bookingId);
        const room = await availableRoom(db, typeKey, start, end, bookingId, booking.roomId);
        if (!room) fail(409, "No rooms are available for those dates. Choose different dates or a different room.");
        const nightlyRate = booking.roomTypeId === String(typeKey) ? booking.nightlyRate : type.price_per_night;
        await db.query(
          `UPDATE bookings SET pet_id=$2, room_id=$3, check_in_date=$4, check_out_date=$5,
             nightly_rate=$6, total_price=$6::numeric*($5::date-$4::date), special_care=$7, payment_status='UNPAID'
           WHERE booking_id=$1`, [bookingId, petKey, room.room_id, start, end, nightlyRate, care],
        );
        await log(db, bookingId, owner, "HOLD_UPDATED", "Reservation details updated before checkout.");
        return get(db, bookingId, owner);
      });
      send(res, result);
    },
  );

  router.delete(
    "/bookings/:id/hold",
    auth("CUSTOMER"),
    /* Release the customer's unpaid reservation immediately. */ async (req, res) => {
      const bookingId = id(req.params.id);
      const owner = req.user.user_id;
      const result = await transaction(pool, async (db) => {
        await expire(db);
        const current = await get(db, bookingId, owner);
        if (current.status === "CANCELLED") return current;
        if (current.status !== "PENDING")
          fail(409, "Only unpaid reservations can be cancelled here. Check My bookings for other options.");
        await db.query("UPDATE bookings SET status='CANCELLED' WHERE booking_id=$1", [bookingId]);
        await log(db, bookingId, owner, "HOLD_CANCELLED", "Customer cancelled the unpaid reservation.");
        return get(db, bookingId, owner);
      });
      send(res, result);
    },
  );

  router.post(
    "/bookings/:id/checkout",
    auth("CUSTOMER"),
    /* Accept and validate a simulated checkout attempt. */ async (
      req,
      res,
    ) => {
      const booking = id(req.params.id),
        owner = req.user.user_id;
      const { outcome, attemptId } = body(req, ["outcome", "attemptId"]);
      if (
        !["SUCCESS", "FAILED"].includes(outcome) ||
        typeof attemptId !== "string" ||
        !/^[\w-]{1,64}$/.test(attemptId)
      )
        fail(
          400,
          "Choose a simulated payment outcome and supply a valid attempt ID.",
        );
      await expireHolds();
      const result = await transaction(
        pool,
        /* Apply the payment once and write its audit entry. */ async (db) => {
          const current = await get(db, booking, owner);
          if (
            current.status === "CONFIRMED" &&
            current.paymentStatus === "SUCCESS"
          )
            return current;
          if (current.status !== "PENDING" || current.expiresAt <= Date.now())
            fail(409, "This booking is no longer awaiting payment.");
          const ref = "SIM-" + booking + "-" + attemptId;
          const action =
            outcome === "SUCCESS" ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED";
          const detail = paymentLogPrefix[outcome] + ref;
          // Match the complete audit entry because attempt IDs can share a suffix.
          const { rowCount: seen } = await db.query(
            `SELECT 1 FROM booking_logs WHERE booking_id=$1 AND (
          (action='PAYMENT_FAILED' AND details=$2)
          OR (action='PAYMENT_SUCCEEDED' AND details=$3)
        )`,
            [
              booking,
              paymentLogPrefix.FAILED + ref,
              paymentLogPrefix.SUCCESS + ref,
            ],
          );
          if (seen) return current;
          await db.query(
            `UPDATE bookings SET payment_status=$2::text,status=CASE WHEN $2::text='SUCCESS' THEN 'CONFIRMED' ELSE 'PENDING' END,
        payment_reference=CASE WHEN $2::text='SUCCESS' THEN $3 ELSE NULL END,paid_at=CASE WHEN $2::text='SUCCESS' THEN now() ELSE NULL END WHERE booking_id=$1`,
            [booking, outcome, ref],
          );
          await log(db, booking, owner, action, detail);
          return get(db, booking, owner);
        },
      );
      send(res, result);
    },
  );
  router.post(
    "/bookings/:id/cancellations",
    auth("CUSTOMER"),
    /* Accept a cancellation request from the booking owner. */ async (
      req,
      res,
    ) => {
      const booking = id(req.params.id),
        owner = req.user.user_id,
        reason = text(body(req, ["reason"]).reason, 1000);
      const result = await transaction(
        pool,
        /* Verify eligibility and create one open cancellation request. */ async (
          db,
        ) => {
          const current = await get(db, booking, owner);
          if (current.status !== "CONFIRMED" || current.start <= today() || current.arrivedAt)
            fail(409, "Only upcoming confirmed stays can be cancelled.");
          if (current.cancellation?.status === "PENDING")
            fail(409, "A cancellation request is already awaiting review.");
          if (current.reschedule?.status === "PENDING")
            fail(409, "A reschedule request is already awaiting review.");
          await db.query(
            "INSERT INTO cancellation_requests(booking_id,reason) VALUES($1,$2)",
            [booking, reason],
          );
          await log(
            db,
            booking,
            owner,
            "CANCELLATION_REQUESTED",
            "Cancellation requested.",
          );
          return get(db, booking, owner);
        },
      );
      send(res, result, 201);
    },
  );
  router.get(
    "/cancellations",
    auth("STAFF"),
    /* List cancellation requests visible to staff. */ async (req, res) => {
      const status = req.query.status ?? null;
      if (
        status !== null &&
        !["PENDING", "APPROVED", "DECLINED", "EXPIRED"].includes(status)
      )
        fail(400, "Unknown cancellation status.");
      await sweepNoShows(pool);
      const { rows } = await pool.query(
        `SELECT cancellation.cancellation_request_id::text AS id,
        cancellation.booking_id::text AS "bookingId", cancellation.reason, effective.status,
        cancellation.requested_at AS "requestedAt", cancellation.reviewed_at AS "reviewedAt",
        cancellation.review_notes AS notes
      FROM cancellation_requests cancellation
      JOIN bookings b USING (booking_id)
      JOIN users u ON u.user_id = b.user_id
      CROSS JOIN LATERAL (SELECT CASE WHEN b.no_show_at IS NOT NULL AND cancellation.status='PENDING'
        THEN 'EXPIRED' ELSE cancellation.status END AS status) effective
      WHERE ($1::text IS NULL OR effective.status=$1) AND ${visibleCustomer} ORDER BY cancellation.cancellation_request_id DESC`,
        [status],
      );
      send(res, rows);
    },
  );
  router.patch(
    "/cancellations/:id",
    auth("STAFF"),
    /* Validate a staff decision and its review note. */ async (req, res) => {
      const request = id(req.params.id),
        actor = req.user.user_id;
      const { decision, notes } = body(req, ["decision", "notes"]);
      if (!["APPROVED", "DECLINED"].includes(decision))
        fail(400, "Choose approve or decline.");
      const note = reviewNote(notes, decision);
      const result = await transaction(
        pool,
        /* Apply the review, any refund, and the corresponding audit entries. */ async (
          db,
        ) => {
          const {
            rows: [cancellation],
          } = await db.query(
            "SELECT booking_id,status FROM cancellation_requests WHERE cancellation_request_id=$1",
            [request],
          );
          if (!cancellation) fail(404, "Cancellation request not found.");
          const current = await get(db, cancellation.booking_id, null);
          if (cancellation.status === decision) return current;
          if (cancellation.status !== "PENDING")
            fail(409, "This request has already been reviewed.");
          if (current.status !== "CONFIRMED")
            fail(409, "This stay is no longer confirmed.");
          if (decision === "APPROVED" && (current.start <= today() || current.arrivedAt))
            fail(409, "This stay has already started.");
          await db.query(
            "UPDATE cancellation_requests SET status=$2,reviewed_by=$3,reviewed_at=now(),review_notes=$4 WHERE cancellation_request_id=$1",
            [request, decision, actor, note],
          );
          await log(
            db,
            cancellation.booking_id,
            actor,
            "CANCELLATION_" + decision,
            decision === "APPROVED"
              ? "Cancellation approved."
              : "Cancellation declined.",
          );
          // Approval releases the room and records the simulated refund atomically.
          if (decision === "APPROVED") {
            await db.query(
              `UPDATE bookings SET status='CANCELLED',refund_status='SUCCESS',refund_amount=total_price,
          refund_reference=$2,refunded_at=now() WHERE booking_id=$1`,
              [
                cancellation.booking_id,
                "SIM-REFUND-" + cancellation.booking_id,
              ],
            );
            await log(
              db,
              cancellation.booking_id,
              actor,
              "REFUND_SUCCEEDED",
              "Full simulated refund recorded.",
            );
          }
          return get(db, cancellation.booking_id, null);
        },
      );
      send(res, result);
    },
  );

  router.get(
    "/bookings/:id/reschedules/quote",
    auth("CUSTOMER"),
    /* Show the exact price of new dates before the customer submits them. */ async (req, res) => {
      const booking = await get(pool, id(req.params.id), req.user.user_id);
      send(res, await rescheduleQuote(pool, booking, req.query.start, req.query.end));
    },
  );

  router.post(
    "/bookings/:id/reschedules",
    auth("CUSTOMER"),
    /* Record requested dates without changing the confirmed stay. */ async (
      req,
      res,
    ) => {
      const bookingId = id(req.params.id);
      const owner = req.user.user_id;
      const {
        start,
        end,
        reason: inputReason,
        confirmedTotal,
      } = body(req, ["start", "end", "reason", "confirmedTotal"]);
      const reason = text(inputReason, 1000);
      stay(start, end);

      const result = await transaction(
        pool,
        /* Save the request and its audit entry together. */ async (db) => {
          const booking = await get(db, bookingId, owner);
          const quote = await rescheduleQuote(db, booking, start, end);
          if (confirmedTotal !== quote.newTotal)
            fail(409, "Review and confirm the updated price before sending your request.");

          await db.query(
            `INSERT INTO reschedule_requests
             (booking_id, original_check_in, original_check_out, requested_check_in, requested_check_out, reason, original_total, new_total)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [bookingId, booking.start, booking.end, start, end, reason, quote.originalTotal, quote.newTotal],
          );
          await log(
            db,
            bookingId,
            owner,
            "RESCHEDULE_REQUESTED",
            `Requested new dates: ${start} to ${end}.`,
          );
          return get(db, bookingId, owner);
        },
      );
      send(res, result, 201);
    },
  );

  router.patch(
    "/bookings/:id/reschedules/:requestId",
    auth("STAFF"),
    /* Approve or decline a date change requested by the customer. */ async (
      req,
      res,
    ) => {
      const bookingId = id(req.params.id);
      const requestId = id(req.params.requestId);
      const actor = req.user.user_id;
      const { decision, notes } = body(req, ["decision", "notes"]);
      if (!["APPROVED", "DECLINED"].includes(decision))
        fail(400, "Choose approve or decline.");
      const note = reviewNote(notes, decision);

      const result = await transaction(
        pool,
        /* Commit the decision and any date change atomically. */ async (
          db,
        ) => {
          const booking = await get(db, bookingId, null);
          const {
            rows: [change],
          } = await db.query(
            `SELECT status, original_check_in::text AS "originalStart", original_check_out::text AS "originalEnd",
                  requested_check_in::text AS start, requested_check_out::text AS end,
                  original_total::float8 AS "originalTotal", new_total::float8 AS "newTotal",
                  (new_total - original_total)::float8 AS difference
           FROM reschedule_requests WHERE reschedule_request_id=$1 AND booking_id=$2`,
            [requestId, bookingId],
          );
          if (!change) fail(404, "Reschedule request not found.");
          if (change.status === decision) return booking;
          if (booking.noShowAt) fail(409, "This request expired when the booking was marked as a no-show.");
          if (change.status !== "PENDING")
            fail(409, "This request has already been reviewed.");

          let adjustmentReference = null;
          if (decision === "APPROVED") {
            if (
              booking.status !== "CONFIRMED" ||
              booking.arrivedAt ||
              booking.total !== change.originalTotal ||
              booking.start <= today() ||
              change.start <= today() ||
              booking.start !== change.originalStart ||
              booking.end !== change.originalEnd
            )
              fail(
                409,
                "These dates can no longer be approved. Decline the request instead.",
              );
            await expire(db);
            const { rowCount: available } = await db.query(
              `SELECT r.room_id FROM rooms r WHERE r.room_id=$1 AND r.is_active
                AND ${noClosure("$3", "$4")}
                AND NOT EXISTS (
                  SELECT 1 FROM bookings b WHERE b.room_id=r.room_id
                  AND b.booking_id<>$2 AND b.status IN ('PENDING','CONFIRMED')
                  AND b.check_in_date<$4::date AND b.check_out_date>$3::date
                ) FOR UPDATE`,
              [booking.roomId, bookingId, change.start, change.end],
            );
            if (!available)
              fail(409, "The original room is no longer available for the requested dates. The current booking is unchanged.");
            // PostgreSQL also checks that the pet has no other overlapping stay.
            try {
              await db.query(
                "UPDATE bookings SET check_in_date=$2, check_out_date=$3, total_price=$4 WHERE booking_id=$1",
                [bookingId, change.start, change.end, change.newTotal],
              );
            } catch (error) {
              if (error.constraint === "bookings_no_pet_overlap")
                fail(
                  409,
                  "This pet already has a booking that overlaps the requested dates.",
                );
              throw error;
            }
            if (change.difference !== 0) {
              adjustmentReference = "SIM-CHANGE-" + requestId;
              await log(db, bookingId, actor, "RESCHEDULE_PAYMENT_ADJUSTED",
                `${adjustmentReference}: simulated ${change.difference > 0 ? "charge" : "refund"} of THB ${Math.abs(change.difference).toFixed(2)}.`);
            }
          }

          await db.query(
            `UPDATE reschedule_requests SET status=$2, reviewed_by=$3, reviewed_at=now(), review_notes=$4, adjustment_reference=$5
           WHERE reschedule_request_id=$1`,
            [requestId, decision, actor, note, adjustmentReference],
          );
          const details =
            decision === "APPROVED"
              ? `Stay moved from ${booking.start} to ${booking.end} to new dates ${change.start} to ${change.end}.`
              : `Reschedule declined for ${change.start} to ${change.end}.`;
          await log(db, bookingId, actor, "RESCHEDULE_" + decision, details);
          return get(db, bookingId, null);
        },
      );
      send(res, result);
    },
  );

  router.patch(
    "/bookings/:id/complete",
    auth("STAFF"),
    /* Direct older clients to attendance instead of skipping actual pickup. */ async (req, res) => {
      const booking = await get(pool, id(req.params.id), null);
      if (booking.status !== "COMPLETED") fail(409, "Record actual arrival and pickup under Stay care to complete this stay.");
      send(res, booking);
    },
  );
  return router;
}
