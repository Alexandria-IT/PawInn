import express from "express";
import { fail, id, send, text, transaction } from "../shared/runtime.js";

const maxPhotoBytes = 2 * 1024 * 1024;
const pageSize = 20;
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
const jpegSignature = Buffer.from("ffd8ff", "hex");

// Determine the response media type from the uploaded bytes.
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(pngSignature)) return "image/png";
  if (bytes.subarray(0, 3).equals(jpegSignature)) return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  fail(400, "Choose a JPEG, PNG, or WebP photo.");
}

// Parse a staff upload after Express enforces the request size limit.
export async function readMultipartForm(req, name) {
  if (!Buffer.isBuffer(req.body)) fail(400, `Send the ${name} as a form.`);
  try {
    return await new Response(req.body, {
      headers: { "Content-Type": req.get("Content-Type") },
    }).formData();
  } catch {
    fail(400, `The ${name} form could not be read.`);
  }
}

// Validate an uploaded photo and derive the response type from its bytes.
export async function readPhoto(file) {
  if (typeof file === "string" || !file.size) fail(400, "Choose a photo.");
  if (file.size > maxPhotoBytes) fail(413, "Choose a photo up to 2 MB.");
  const photo = Buffer.from(await file.arrayBuffer());
  return { photo, photoType: imageType(photo) };
}

// Read one optional photo and one optional message from the staff form.
async function readUpdate(req) {
  const form = await readMultipartForm(req, "update");
  for (const key of form.keys()) {
    if (!["message", "photo"].includes(key) || form.getAll(key).length !== 1)
      fail(400, "Send one message and up to one photo.");
  }
  const messageInput = form.get("message");
  const message = text(
    typeof messageInput === "string" ? messageInput.trim() : messageInput,
    2000,
    true,
  );
  const file = form.get("photo");
  let photo = null;
  let photoType = null;
  if (file !== null) ({ photo, photoType } = await readPhoto(file));
  if (!message && !photo) fail(400, "Write a message or attach a photo.");
  return { message, photo, photoType };
}

// Register the customer feed and staff posting routes under the existing Booking API.
export function registerUpdateRoutes(router, pool, auth, { getBooking, log }) {
  router.get(
    "/bookings/updates",
    auth("CUSTOMER"),
    /* List only the signed-in customer's updates. */ async (req, res) => {
      const before =
        req.query.before === undefined ? null : id(req.query.before);
      const { rows } = await pool.query(
        `SELECT u.pet_update_id::text AS id, b.booking_id::text AS "bookingId",
                p.name AS "petName", u.message, u.created_at AS "createdAt",
                u.photo_type IS NOT NULL AS "hasPhoto"
         FROM pet_updates u
         JOIN bookings b USING (booking_id)
         JOIN pets p USING (pet_id)
         WHERE b.user_id=$1 AND ($2::integer IS NULL OR u.pet_update_id<$2)
         ORDER BY u.pet_update_id DESC
         LIMIT $3`,
        [req.user.user_id, before, pageSize + 1],
      );
      const updates = rows.slice(0, pageSize);
      send(res, {
        updates,
        nextBefore: rows.length > pageSize ? updates.at(-1).id : null,
      });
    },
  );

  router.get(
    "/bookings/updates/:id/photo",
    auth("CUSTOMER"),
    /* Serve the photo only to the booking owner. */ async (req, res) => {
      const {
        rows: [update],
      } = await pool.query(
        `SELECT u.photo, u.photo_type
         FROM pet_updates u JOIN bookings b USING (booking_id)
         WHERE u.pet_update_id=$1 AND b.user_id=$2 AND u.photo IS NOT NULL`,
        [id(req.params.id), req.user.user_id],
      );
      if (!update) fail(404, "Photo not found.");
      res.type(update.photo_type).send(update.photo);
    },
  );

  router.post(
    "/bookings/:id/updates",
    auth("STAFF"),
    express.raw({ type: "multipart/form-data", limit: "3mb" }),
    /* Save an update while the booking is still confirmed. */ async (
      req,
      res,
    ) => {
      const bookingId = id(req.params.id);
      const { message, photo, photoType } = await readUpdate(req);
      const update = await transaction(
        pool,
        /* Write the update and its booking log together. */ async (db) => {
          const booking = await getBooking(db, bookingId, null);
          if (booking.status !== "CONFIRMED")
            fail(409, "Pet updates can only be sent for confirmed bookings.");
          const {
            rows: [created],
          } = await db.query(
            `INSERT INTO pet_updates (booking_id, staff_user_id, message, photo, photo_type)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING pet_update_id::text AS id, booking_id::text AS "bookingId",
                     message, created_at AS "createdAt", photo_type IS NOT NULL AS "hasPhoto"`,
            [bookingId, req.user.user_id, message, photo, photoType],
          );
          await log(
            db,
            bookingId,
            req.user.user_id,
            "PET_UPDATE_SENT",
            "Staff posted a pet update.",
          );
          return created;
        },
      );
      send(res, update, 201);
    },
  );
}
