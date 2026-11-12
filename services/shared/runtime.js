import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Room, Booking, and the fixture retirement script share this PostgreSQL lock.
const inventoryLockId = 42001;
const millisecondsPerDay = 86_400_000;

export class HttpError extends Error {
  // Carry a safe API error message and status.
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
// Stop processing with a controlled HTTP error.
export function fail(status, message) {
  throw new HttpError(status, message);
}
// Validate an API ID before converting it to an integer.
export function id(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,9}$/.test(value) ||
    Number(value) > 2147483647
  )
    fail(400, "Invalid ID.");
  return Number(value);
}
// Wrap successful results in the shared JSON response shape.
export const send = (res, data, status = 200) =>
  res.status(status).json({ data });
// Check that the body is an object with supported fields.
export function body(req, allowed) {
  const value = req.body;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      /* Detect fields the route does not accept. */ (key) =>
        !allowed.includes(key),
    )
  )
    fail(400, "Check the fields you submitted.");
  return value;
}
// Return today's calendar date in Bangkok.
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
// Validate the stay dates and the allowed number of nights.
export function stay(start, end) {
  for (const date of [start, end]) {
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date.startsWith("0000")
    )
      fail(400, "Choose valid check-in and check-out dates.");
    const parsed = new Date(date + "T00:00:00Z");
    if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date)
      fail(400, "Choose valid calendar dates.");
  }
  // ISO date-only values use UTC here so the night count is calendar-based.
  const nights = (Date.parse(end) - Date.parse(start)) / millisecondsPerDay;
  if (start < today() || nights < 1 || nights > 30)
    fail(400, "Choose a stay of 1–30 nights starting today or later.");
}
// Validate and trim a text field.
export function text(value, max, optional = false) {
  if (optional && (value == null || value === "")) return "";
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    value.includes("\0")
  )
    fail(400, "Check the length of the text you entered.");
  return value.trim();
}

// Run an operation under the shared inventory lock.
export async function transaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Serialize room allocation and inventory changes until commit or rollback.
    await db.query("SELECT pg_advisory_xact_lock($1)", [inventoryLockId]);
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

// Configure the Express runtime for Room and Booking.
export function createService({ express, jwt, pool, secret, routes, tables }) {
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    secret.startsWith("replace-")
  )
    throw new Error("Set JWT_SECRET in .env (at least 32 bytes).");
  const app = express();
  app.disable("x-powered-by");
  app.use(
    /* Disable response caching and MIME sniffing. */ (_req, res, next) => {
      res.set({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      next();
    },
  );
  app.get(
    "/health",
    /* Check that all tables needed by the service are accessible. */ async (
      _req,
      res,
    ) => {
      try {
        for (const table of tables)
          await pool.query("SELECT 1 FROM " + table + " LIMIT 0");
        send(res, { status: "ok" });
      } catch (error) {
        console.error("Readiness check:", error.code || error.name);
        res.status(503).json({ message: "Database is not ready." });
      }
    },
  );
  app.use(express.json({ limit: "16kb" }));
  // Create authentication middleware for the requested role.
  function auth(role) {
    return /* Verify the bearer token and check the current database role. */ async (
      req,
      _res,
      next,
    ) => {
      let sub;
      try {
        const token = /^Bearer ([^\s]+)$/i.exec(
          req.get("Authorization") || "",
        )?.[1];
        if (token)
          sub = id(
            jwt.verify(token, secret, {
              algorithms: ["HS256"],
              issuer: "pawinn-account",
              audience: "pawinn",
            }).sub,
          );
      } catch {
        /* Reject expired or invalid sessions. */
      }
      if (!sub) fail(401, "Sign in again to continue.");
      // Read the current role from PostgreSQL even when the token is valid.
      const {
        rows: [user],
      } = await pool.query(
        "SELECT user_id, role, email FROM users WHERE user_id=$1",
        [sub],
      );
      if (
        !user ||
        (!process.env.PAWINN_SEED_DEMO?.match(/^(1|true)$/i) &&
          user.email.toLowerCase().endsWith("@pawinn.demo"))
      )
        fail(401, "Sign in again to continue.");
      if (role && user.role !== role)
        fail(
          403,
          role === "STAFF"
            ? "Staff access is required."
            : "A customer account is required.",
        );
      req.user = user;
      next();
    };
  }
  app.use("/api", routes(express.Router(), pool, auth));
  app.use(
    /* Return JSON for an unmatched service route. */ (_req, res) =>
      res.status(404).json({ message: "Endpoint not found." }),
  );
  app.use(
    /* Map known errors to client-safe responses. */ (
      error,
      _req,
      res,
      _next,
    ) => {
      if (error instanceof HttpError)
        return res.status(error.status).json({ message: error.message });
      if (error.type === "entity.parse.failed")
        return res.status(400).json({ message: "Invalid JSON." });
      if (error.type === "entity.too.large")
        return res.status(413).json({ message: "Request is too large." });
      if (["23P01", "23505", "23503"].includes(error.code))
        return res.status(409).json({
          message: "The booking or inventory changed. Refresh and try again.",
        });
      console.error("Service request failed:", error.code || error.name);
      res.status(500).json({ message: "The request could not be completed." });
    },
  );
  return app;
}

// Start the service when its entry point is run directly.
export async function runService(
  file,
  { express, pg, jwt, name, port, routes, tables, prepare },
) {
  if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(file))
    return;
  if (!process.env.POSTGRES_PASSWORD)
    throw new Error("Set POSTGRES_PASSWORD in .env.");
  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST || "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || "pawinn",
    database: process.env.POSTGRES_DB || "pawinn",
    password: process.env.POSTGRES_PASSWORD,
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
  });
  pool.on(
    "error",
    /* Log idle database connection errors. */ (error) =>
      console.error(name + " PostgreSQL:", error.code || error.name),
  );
  const app = createService({
    express,
    jwt,
    pool,
    secret: process.env.JWT_SECRET,
    routes,
    tables,
  });
  if (prepare) {
    try {
      await prepare(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  const server = app.listen(
    Number(process.env[name.toUpperCase() + "_PORT"] || port),
    process.env.SERVICE_HOST || "127.0.0.1",
    /* Log when the service starts listening. */ () =>
      console.log("PawInn " + name + " is listening."),
  );
  // Begin a graceful shutdown on a process signal.
  const stop = () =>
    server.close(
      /* Close the pool after the server stops taking requests. */ () =>
        pool.end().catch(
          /* Set a failure exit status if pool cleanup fails. */ () => {
            process.exitCode = 1;
          },
        ),
    );
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
