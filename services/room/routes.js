import { fail, id, send, body, transaction, today } from "../shared/runtime.js";

const roomFields = `room_id::text AS id, room_type_id::text AS "roomTypeId",
  room_number AS "roomNumber", is_active AS "isActive"`;

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
      const room = await transaction(
        pool,
        /* Check outstanding stays and apply the inventory change under lock. */ async (
          db,
        ) => {
          // Only current and future stays or unexpired holds block deactivation.
          if (!isActive) {
            const {
              rows: [{ occupied }],
            } = await db.query(
              `SELECT EXISTS(SELECT 1 FROM bookings WHERE room_id=$1 AND check_out_date>$2::date
          AND (status='CONFIRMED' OR (status='PENDING' AND created_at>now()-interval '15 minutes'))) AS occupied`,
              [roomId, today()],
            );
            if (occupied)
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
