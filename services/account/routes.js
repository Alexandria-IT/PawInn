import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { petFields, userFields, updatePet } from "./db.js";

const tokenOptions = { issuer: "pawinn-account", audience: "pawinn" };
// Run a bcrypt comparison for unknown emails to keep the login path comparable.
const dummyHash = bcrypt.hashSync("unused-account-timing-placeholder", 10);
class RequestError extends Error {
  // Carry a client-safe message and its HTTP status.
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
// Stop the request with a controlled error.
const fail = (status, message) => {
  throw new RequestError(status, message);
};
// Send data in the shared API response shape.
const send = (res, data, status = 200) => res.status(status).json({ data });
// Map public account fields to the API response.
const userDto = (r) => ({
  id: String(r.user_id),
  name: r.full_name,
  email: r.email,
  phone: r.phone,
  role: r.role,
});
// Map pet fields and IDs to the API response.
const petDto = (r) => ({
  id: String(r.pet_id),
  ownerId: String(r.owner_id),
  name: r.name,
  species: r.species,
  breed: r.breed,
  birthDate: r.birth_date,
  notes: r.care_notes,
});

// Validate the request object's allowed fields.
function fields(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      /* Detect a field outside the route's allowed list. */ (key) =>
        !allowed.includes(key),
    )
  ) {
    fail(400, "Send a JSON object with only the supported fields.");
  }
  return body;
}
// Trim and validate an account or pet form field.
function clean(value, label, max, min = 0) {
  if ((value === undefined || value === null) && !min) return null;
  if (typeof value !== "string" || value.includes("\0"))
    fail(400, label + " is invalid.");
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail(
      400,
      label +
        " must be " +
        (min ? min + " to " : "at most ") +
        max +
        " characters.",
    );
  }
  return trimmed || null;
}
// Normalize the email and check bcrypt's password byte limit.
function credentials(body, min = 1) {
  const email = clean(body.email, "Email", 254, 1).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, "Enter a valid email address.");
  const password = body.password;
  if (
    typeof password !== "string" ||
    password.length < min ||
    Buffer.byteLength(password) > 72 ||
    password.includes("\0")
  ) {
    fail(
      400,
      "Password must be at least " + min + " characters and at most 72 bytes.",
    );
  }
  return { email, password };
}
// Parse an ID in the PostgreSQL integer range.
function parseId(id) {
  return typeof id === "string" &&
    /^[1-9]\d{0,9}$/.test(id) &&
    Number(id) <= 2147483647
    ? Number(id)
    : null;
}
// Validate a new pet or a partial update.
function petInput(body, partial = false) {
  const keys = ["name", "species", "breed", "birthDate", "notes"];
  fields(body, keys);
  if (partial && !Object.keys(body).length)
    fail(400, "Enter at least one field to update.");
  const result = {};
  // On PATCH, omitted fields keep their values and empty optional fields clear them.
  // Check whether the caller explicitly supplied a field.
  const has = (key) => Object.hasOwn(body, key);
  if (!partial || has("name"))
    result.name = clean(body.name, "Pet name", 40, 1);
  if (!partial || has("species")) {
    if (!["Dog", "Cat"].includes(body.species)) fail(400, "Choose Dog or Cat.");
    result.species = body.species;
  }
  if (has("breed")) result.breed = clean(body.breed, "Breed", 80);
  if (has("notes")) result.notes = clean(body.notes, "Care notes", 1000);
  if (has("birthDate")) {
    const date = clean(body.birthDate, "Birth date", 10);
    if (date) {
      const parsed = new Date(date + "T00:00:00Z");
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date.startsWith("0000") ||
        !Number.isFinite(+parsed) ||
        parsed.toISOString().slice(0, 10) !== date ||
        date > today
      ) {
        fail(400, "Enter a valid birth date that is not in the future.");
      }
    }
    result.birthDate = date;
  }
  return result;
}

// Register authentication and pet routes.
export function accountRoutes(pool, secret, allowFixtures) {
  // Reject reserved fixture accounts in normal mode.
  const fixtureBlocked = (email) =>
    !allowFixtures && email.toLowerCase().endsWith("@pawinn.demo");
  const router = Router();
  router.use(
    "/auth",
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Too many sign-in attempts. Try again in a minute." },
    }),
  );
  // Issue an expiring token and public user profile.
  function session(user) {
    return {
      user: userDto(user),
      token: jwt.sign({ role: user.role }, secret, {
        ...tokenOptions,
        algorithm: "HS256",
        subject: String(user.user_id),
        expiresIn: "1h",
      }),
    };
  }
  // Validate the token and load the current account.
  async function authenticate(req, _res, next) {
    const token = /^Bearer ([^\s]+)$/i.exec(
      req.get("Authorization") || "",
    )?.[1];
    let id;
    try {
      if (token)
        id = parseId(
          jwt.verify(token, secret, { ...tokenOptions, algorithms: ["HS256"] })
            .sub,
        );
    } catch {
      /* An invalid token is treated like a missing one. */
    }
    if (!id) fail(401, "Sign in again to continue.");
    const {
      rows: [user],
    } = await pool.query(
      "SELECT " + userFields + " FROM users WHERE user_id=$1",
      [id],
    );
    if (!user || fixtureBlocked(user.email))
      fail(401, "Sign in again to continue.");
    req.accountUser = user;
    next();
  }
  // Require the customer role for pet routes.
  function customer(req, _res, next) {
    if (req.accountUser.role !== "CUSTOMER")
      fail(403, "A customer account is required.");
    next();
  }
  router.post(
    "/auth/register",
    /* Create a customer and return its session. */ async (req, res) => {
      const body = fields(req.body, ["name", "email", "password", "phone"]);
      const { email, password } = credentials(body, 8);
      if (fixtureBlocked(email)) fail(400, "Use a different email address.");
      const name = clean(body.name, "Full name", 80, 2);
      const phone = clean(body.phone, "Phone", 30);
      try {
        const hash = await bcrypt.hash(password, 10);
        const {
          rows: [user],
        } = await pool.query(
          "INSERT INTO users (full_name,email,password_hash,phone,role) VALUES ($1,$2,$3,$4,'CUSTOMER') RETURNING " +
            userFields,
          [name, email, hash, phone],
        );
        send(res, session(user), 201);
      } catch (error) {
        if (error.code === "23505")
          fail(409, "This email already has an account. Sign in instead.");
        throw error;
      }
    },
  );
  router.post(
    "/auth/login",
    /* Verify credentials and return a session. */ async (req, res) => {
      const { email, password } = credentials(
        fields(req.body, ["email", "password"]),
      );
      const {
        rows: [user],
      } = await pool.query(
        "SELECT " +
          userFields +
          ",password_hash FROM users WHERE lower(email)=$1",
        [email],
      );
      if (
        !(await bcrypt.compare(password, user?.password_hash || dummyHash)) ||
        !user ||
        fixtureBlocked(user.email)
      ) {
        fail(401, "Email or password is incorrect.");
      }
      send(res, session(user));
    },
  );
  router.get(
    "/users/me",
    authenticate,
    /* Return the current public user profile. */ (req, res) =>
      send(res, userDto(req.accountUser)),
  );
  router.use("/pets", authenticate, customer);
  router.get(
    "/pets",
    /* List pets owned by this customer. */ async (req, res) => {
      const { rows } = await pool.query(
        "SELECT " + petFields + " FROM pets WHERE owner_id=$1 ORDER BY pet_id",
        [req.accountUser.user_id],
      );
      send(res, rows.map(petDto));
    },
  );
  router.post(
    "/pets",
    /* Create a pet owned by this customer. */ async (req, res) => {
      const pet = petInput(req.body);
      const {
        rows: [row],
      } = await pool.query(
        "INSERT INTO pets (owner_id,name,species,breed,birth_date,care_notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING " +
          petFields,
        [
          req.accountUser.user_id,
          pet.name,
          pet.species,
          pet.breed,
          pet.birthDate,
          pet.notes,
        ],
      );
      send(res, petDto(row), 201);
    },
  );
  router.param(
    "id",
    /* Validate the pet ID before the route handler runs. */ (
      req,
      _res,
      next,
      id,
    ) => {
      req.petId = parseId(id);
      if (!req.petId) fail(400, "Invalid pet ID.");
      next();
    },
  );
  router.get(
    "/pets/:id",
    /* Fetch an owned pet or return a missing-resource response. */ async (
      req,
      res,
    ) => {
      const {
        rows: [pet],
      } = await pool.query(
        "SELECT " + petFields + " FROM pets WHERE pet_id=$1 AND owner_id=$2",
        [req.petId, req.accountUser.user_id],
      );
      if (!pet) fail(404, "Pet not found.");
      send(res, petDto(pet));
    },
  );
  router.patch(
    "/pets/:id",
    /* Apply a partial update to an owned pet. */ async (req, res) => {
      const { pet, status } = await updatePet(
        pool,
        req.petId,
        req.accountUser.user_id,
        petInput(req.body, true),
      );
      if (status === 404) fail(404, "Pet not found.");
      if (status === 409)
        fail(409, "Species cannot change while a pet has an active booking.");
      send(res, petDto(pet));
    },
  );
  router.delete(
    "/pets/:id",
    /* Delete an owned pet if no booking references it. */ async (req, res) => {
      try {
        const { rowCount } = await pool.query(
          "DELETE FROM pets WHERE pet_id=$1 AND owner_id=$2",
          [req.petId, req.accountUser.user_id],
        );
        if (!rowCount) fail(404, "Pet not found.");
        res.status(204).end();
      } catch (error) {
        if (error.code === "23503")
          fail(409, "This pet has booking history and cannot be removed.");
        throw error;
      }
    },
  );
  return router;
}

// Map request and database errors to API responses.
export function accountError(error, _req, res, _next) {
  if (error instanceof RequestError)
    return res.status(error.status).json({ message: error.message });
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ message: "Invalid JSON." });
  if (error.type === "entity.too.large")
    return res.status(413).json({ message: "Request is too large." });
  if (error.code === "22008" || error.code === "23514")
    return res.status(400).json({ message: "Check the values you entered." });
  console.error("Account request failed:", error.code || error.name);
  res
    .status(500)
    .json({ message: "Account service could not complete the request." });
}
