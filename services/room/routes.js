import { fail, id, send, body, transaction, today, holdMinutes, dateRange } from "../shared/runtime.js";
import { sweepNoShows } from "../shared/attendance.js";

const roomFields = `room_id::text AS id, room_type_id::text AS "roomTypeId",
  room_number AS "roomNumber", is_active AS "isActive"`;

// Pick the booking that currently prevents deactivation, preferring a confirmed stay.
const reservationJoin = `LEFT JOIN LATERAL (
  SELECT CASE WHEN b.status = 'CONFIRMED' THEN 'RESERVED' ELSE 'HELD' END AS status,
    CASE WHEN b.status = 'PENDING'
      THEN b.created_at + interval '${holdMinutes} minutes' END AS expires_at
  FROM bookings b
  WHERE b.room_id = r.room_id AND
    (b.check_out_date > $1::date OR (b.arrived_at IS NOT NULL AND b.picked_up_at IS NULL))
    AND (b.status = 'CONFIRMED' OR
      (b.status = 'PENDING' AND b.created_at > now() - interval '${holdMinutes} minutes'))
  ORDER BY (b.status = 'CONFIRMED') DESC, b.created_at DESC
  LIMIT 1
) reservation ON TRUE`;

// Register room catalog and inventory routes.
export function routes(router, pool, auth) {
  router.get(
    "/room-types",
    /* Return room types with their prices and pet species. */ async (
      _req,
      res,
    ) => {
      const { rows } = await pool.query(
        'SELECT room_type_id::text AS id,name,description,species,price_per_night::float8 AS "pricePerNight" FROM room_types ORDER BY room_type_id',
      );
      send(res, rows);
    },
  );
  router.get(
    "/rooms",
    /* List physical rooms with optional inventory filters. */ async (
      req,
      res,
    ) => {
      const type =
        req.query.roomTypeId === undefined ? null : id(req.query.roomTypeId);
      const active = req.query.active;
      if (active !== undefined && !["true", "false"].includes(active))
        fail(400, "active must be true or false.");
      const { rows } = await pool.query(
        `SELECT ${roomFields}
       FROM rooms WHERE ($1::integer IS NULL OR room_type_id=$1) AND ($2::boolean IS NULL OR is_active=$2) ORDER BY room_number`,
        [type, active ?? null],
      );
      send(res, rows);
    },
  );
  router.get(
    "/rooms/inventory",
    auth("STAFF"),
    /* List the rooms and their current deactivation status. */ async (_req, res) => {
      await sweepNoShows(pool);
      const { rows } = await pool.query(
        `SELECT ${roomFields}, reservation.status AS "reservationStatus",
          reservation.expires_at AS "holdExpiresAt",
          COALESCE(closures.items, '[]') AS closures
        FROM rooms r ${reservationJoin}
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'id', closure_id::text, 'start', starts_on::text, 'reopen', reopens_on::text
          ) ORDER BY starts_on) AS items
          FROM room_closures WHERE room_id=r.room_id AND reopens_on>$1::date
        ) closures ON TRUE
        ORDER BY r.room_number`,
        [today()],
      );
      send(res, rows);
    },
  );
  router.post(
    "/rooms/:id/closures",
    auth("STAFF"),
    /* Schedule an unavailable date range without moving existing reservations. */ async (req, res) => {
      const roomId = id(req.params.id);
      const { start, reopen } = body(req, ["start", "reopen"]);
      dateRange(start, reopen, "closure and reopening");
      if (reopen <= start) fail(400, "Reopening must be after the closure starts.");
      await sweepNoShows(pool);
      const closure = await transaction(pool, async (db) => {
        if (start <= today())
          fail(400, "Schedule closures at least one calendar day ahead (Bangkok time).");
        const { rows: [room] } = await db.query(
          "SELECT is_active FROM rooms WHERE room_id=$1", [roomId],
        );
        if (!room) fail(404, "Room not found.");
        if (!room.is_active) fail(409, "Activate this room before scheduling a closure.");

        const { rows: [existing] } = await db.query(
          `SELECT closure_id::text AS id, starts_on::text AS start, reopens_on::text AS reopen
           FROM room_closures WHERE room_id=$1 AND starts_on<$3::date AND reopens_on>$2::date`,
          [roomId, start, reopen],
        );
        if (existing?.start === start && existing.reopen === reopen) return existing;
        if (existing) fail(409, "These dates overlap another closure for this room.");

        const { rowCount } = await db.query(
          `SELECT 1 FROM bookings WHERE room_id=$1
             AND check_in_date<$3::date AND check_out_date>=$2::date
             AND (status='CONFIRMED' OR
               (status='PENDING' AND created_at>clock_timestamp()-interval '${holdMinutes} minutes'))
           LIMIT 1`,
          [roomId, start, reopen],
        );
        if (rowCount)
          fail(409, "A booking or payment hold overlaps these dates. Choose a different closure period.");

        const { rows: [created] } = await db.query(
          `INSERT INTO room_closures (room_id, starts_on, reopens_on)
           VALUES ($1, $2, $3)
           RETURNING closure_id::text AS id, starts_on::text AS start, reopens_on::text AS reopen`,
          [roomId, start, reopen],
        );
        return created;
      });
      send(res, closure, 201);
    },
  );
  router.delete(
    "/rooms/:id/closures/:closureId",
    auth("STAFF"),
    /* Remove a closure so the normal booking rules apply again. */ async (req, res) => {
      const roomId = id(req.params.id);
      const closureId = id(req.params.closureId);
      await transaction(pool, (db) => db.query(
        "DELETE FROM room_closures WHERE room_id=$1 AND closure_id=$2", [roomId, closureId],
      ));
      res.sendStatus(204);
    },
  );
  router.patch(
    "/rooms/:id",
    auth("STAFF"),
    /* Validate a staff request to change room availability. */ async (
      req,
      res,
    ) => {
      const roomId = id(req.params.id),
        { isActive } = body(req, ["isActive"]);
      if (typeof isActive !== "boolean")
        fail(400, "Choose an active or inactive status.");
      if (!isActive) await sweepNoShows(pool);
      const room = await transaction(
        pool,
        /* Check outstanding stays and apply the inventory change under lock. */ async (
          db,
        ) => {
          // Only current and future stays or unexpired holds block deactivation.
          if (!isActive) {
            const {
              rows: [room],
            } = await db.query(
              `SELECT reservation.status FROM rooms r ${reservationJoin} WHERE r.room_id=$2`,
              [today(), roomId],
            );
            if (room?.status === "HELD")
              fail(409, "This room has an unpaid reservation on hold.");
            if (room?.status === "RESERVED")
              fail(409, "This room has an active or upcoming reservation.");
          }
          const {
            rows: [row],
          } = await db.query(
            `UPDATE rooms SET is_active=$2 WHERE room_id=$1 RETURNING ${roomFields}`,
            [roomId, isActive],
          );
          if (!row) fail(404, "Room not found.");
          return row;
        },
      );
      send(res, room);
    },
  );
  return router;
}
