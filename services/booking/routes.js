import {
  fail,
  id,
  send,
  body,
  transaction,
  today,
  stay,
  text,
} from "../shared/runtime.js";

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
    b.check_in_date::text AS start,
    b.check_out_date::text AS end,
    b.nightly_rate::float8 AS "nightlyRate",
    b.total_price::float8 AS total,
    b.status,
    b.created_at AS "createdAt",
    b.payment_status AS "paymentStatus",
    b.refund_status AS "refundStatus",
    b.refund_amount::float8 AS "refundAmount",
    extract(epoch FROM (b.created_at + interval '15 minutes'))::float8 * 1000 AS "expiresAt",
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
      'id', cancellation_request_id::text, 'status', status, 'reason', reason, 'note', review_notes
    ) AS item
    FROM cancellation_requests
    WHERE booking_id = b.booking_id
    ORDER BY cancellation_request_id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', reschedule_request_id::text, 'status', status, 'reason', reason, 'note', review_notes,
      'originalStart', original_check_in::text, 'originalEnd', original_check_out::text,
      'start', requested_check_in::text, 'end', requested_check_out::text
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
  await db.query(`WITH expired AS (
    UPDATE bookings
    SET status = 'CANCELLED'
    WHERE status = 'PENDING' AND created_at <= now() - interval '15 minutes'
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
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.room_id=r.room_id AND b.status IN ('PENDING','CONFIRMED')
           AND b.check_in_date<$3::date AND b.check_out_date>$2::date
           AND ($4::int IS NULL OR b.booking_id<>$4)
       )
     ORDER BY (r.room_id=$5::int) DESC NULLS LAST, r.room_id
     LIMIT 1 FOR UPDATE`,
    [roomTypeId, start, end, bookingId, preferredRoomId],
  );
  return room;
}

// Register availability, booking, checkout, and request review routes.
export function routes(router, pool, auth) {
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
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id=r.room_id AND b.status IN ('PENDING','CONFIRMED')
           AND b.check_in_date<$2::date AND b.check_out_date>$1::date)
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
      const { petId, roomTypeId, start, end } = body(req, [
        "petId",
        "roomTypeId",
        "start",
        "end",
      ]);
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
            `INSERT INTO bookings(user_id,pet_id,room_id,check_in_date,check_out_date,nightly_rate,total_price)
        VALUES($1,$2,$3,$4::date,$5::date,$6::numeric,$6::numeric*($5::date-$4::date)) RETURNING booking_id`,
            [
              owner,
              requestedPetId,
              room.room_id,
              start,
              end,
              roomType.price_per_night,
            ],
          );
          await log(
            db,
            created.booking_id,
            owner,
            "BOOKING_CREATED",
            "Room held for 15 minutes.",
          );
          return get(db, created.booking_id, owner);
        },
      );
      send(res, result, 201);
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
          if (current.status !== "CONFIRMED" || current.start <= today())
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
        !["PENDING", "APPROVED", "DECLINED"].includes(status)
      )
        fail(400, "Unknown cancellation status.");
      const { rows } = await pool.query(
        `SELECT cancellation.cancellation_request_id::text AS id,
        cancellation.booking_id::text AS "bookingId", cancellation.reason, cancellation.status,
        cancellation.requested_at AS "requestedAt", cancellation.reviewed_at AS "reviewedAt",
        cancellation.review_notes AS notes
      FROM cancellation_requests cancellation
      JOIN bookings b USING (booking_id)
      JOIN users u ON u.user_id = b.user_id
      WHERE ($1::text IS NULL OR cancellation.status=$1) AND ${visibleCustomer} ORDER BY cancellation.cancellation_request_id DESC`,
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
      const note = text(notes, 1000, true);
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
          if (decision === "APPROVED" && current.start <= today())
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
      } = body(req, ["start", "end", "reason"]);
      const reason = text(inputReason, 1000);
      stay(start, end);
      if (start <= today()) fail(400, "Choose a new check-in after today.");

      const result = await transaction(
        pool,
        /* Save the request and its audit entry together. */ async (db) => {
          const booking = await get(db, bookingId, owner);
          if (booking.status !== "CONFIRMED" || booking.start <= today())
            fail(409, "Only upcoming confirmed stays can be rescheduled.");
          if (
            booking.cancellation?.status === "PENDING" ||
            booking.reschedule?.status === "PENDING"
          )
            fail(409, "This booking already has a request awaiting review.");
          if (start === booking.start)
            fail(400, "Choose a different check-in date.");
          if (
            Date.parse(end) - Date.parse(start) !==
            Date.parse(booking.end) - Date.parse(booking.start)
          )
            fail(400, "Keep the same number of nights when rescheduling.");

          await db.query(
            `INSERT INTO reschedule_requests
             (booking_id, original_check_in, original_check_out, requested_check_in, requested_check_out, reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
            [bookingId, booking.start, booking.end, start, end, reason],
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
      const note = text(notes, 1000, true);

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
                  requested_check_in::text AS start, requested_check_out::text AS end
           FROM reschedule_requests WHERE reschedule_request_id=$1 AND booking_id=$2`,
            [requestId, bookingId],
          );
          if (!change) fail(404, "Reschedule request not found.");
          if (change.status === decision) return booking;
          if (change.status !== "PENDING")
            fail(409, "This request has already been reviewed.");

          if (decision === "APPROVED") {
            if (
              booking.status !== "CONFIRMED" ||
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
            const room = await availableRoom(
              db,
              booking.roomTypeId,
              change.start,
              change.end,
              bookingId,
              booking.roomId,
            );
            if (!room)
              fail(
                409,
                "This room type is no longer available for the requested dates.",
              );
            // PostgreSQL also checks that the pet has no other overlapping stay.
            try {
              await db.query(
                "UPDATE bookings SET room_id=$2, check_in_date=$3, check_out_date=$4 WHERE booking_id=$1",
                [bookingId, room.room_id, change.start, change.end],
              );
            } catch (error) {
              if (error.constraint === "bookings_no_pet_overlap")
                fail(
                  409,
                  "This pet already has a booking that overlaps the requested dates.",
                );
              throw error;
            }
          }

          await db.query(
            `UPDATE reschedule_requests SET status=$2, reviewed_by=$3, reviewed_at=now(), review_notes=$4
           WHERE reschedule_request_id=$1`,
            [requestId, decision, actor, note],
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
    /* Accept a staff request to mark a stay complete. */ async (req, res) => {
      const booking = id(req.params.id),
        actor = req.user.user_id;
      const result = await transaction(
        pool,
        /* Check completion rules and record the final status. */ async (
          db,
        ) => {
          const current = await get(db, booking, null);
          if (current.status === "COMPLETED") return current;
          if (
            current.status !== "CONFIRMED" ||
            current.end > today() ||
            current.cancellation?.status === "PENDING" ||
            current.reschedule?.status === "PENDING"
          )
            fail(
              409,
              "Complete a confirmed stay after check-out and after reviewing any open request.",
            );
          await db.query(
            "UPDATE bookings SET status='COMPLETED' WHERE booking_id=$1",
            [booking],
          );
          await log(
            db,
            booking,
            actor,
            "STAY_COMPLETED",
            "Stay marked completed.",
          );
          return get(db, booking, null);
        },
      );
      send(res, result);
    },
  );
  return router;
}
