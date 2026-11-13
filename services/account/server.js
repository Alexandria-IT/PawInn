import express from "express";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, prepareAccount } from "./db.js";
import { accountError, accountRoutes } from "./routes.js";

// Configure the Account Express application.
export function createApp({
  pool,
  secret,
  allowFixtures = /^(1|true)$/i.test(process.env.PAWINN_SEED_DEMO || ""),
}) {
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    secret.startsWith("replace-")
  ) {
    throw new Error(
      "Set a unique JWT_SECRET of at least 32 bytes in the root .env.",
    );
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(
    /* Prevent caching and MIME sniffing for Account responses. */ (
      _req,
      res,
      next,
    ) => {
      res.set("Cache-Control", "no-store");
      res.set("X-Content-Type-Options", "nosniff");
      next();
    },
  );
  app.get(
    "/health",
    /* Check that Account's required tables are available. */ async (
      _req,
      res,
    ) => {
      try {
        await pool.query("SELECT user_id, account_status, session_version FROM users LIMIT 0");
        await pool.query("SELECT pet_id FROM pets LIMIT 0");
        await pool.query("SELECT booking_id FROM bookings LIMIT 0");
        res.json({ data: { status: "ok" } });
      } catch (error) {
        console.error("Account readiness:", error.code || error.name);
        res.status(503).json({ message: "Account database is not ready." });
      }
    },
  );
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", accountRoutes(pool, secret, allowFixtures));
  app.use(
    /* Return JSON for an unmatched Account route. */ (_req, res) =>
      res.status(404).json({ message: "Endpoint not found." }),
  );
  app.use(accountError);
  return app;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let pool;
  try {
    pool = createPool();
    pool.on(
      "error",
      /* Log database pool errors. */ (error) =>
        console.error("Account database:", error.code || error.name),
    );
    const app = createApp({ pool, secret: process.env.JWT_SECRET });
    await prepareAccount(pool);
    const port = Number(process.env.ACCOUNT_PORT || 3001);
    const host = process.env.ACCOUNT_HOST || "127.0.0.1";
    const server = app.listen(
      port,
      host,
      /* Log the Account address when it starts listening. */ () =>
        console.log("PawInn Account listening at http://" + host + ":" + port),
    );
    server.once(
      "error",
      /* Close the pool if the server cannot bind. */ async (error) => {
        console.error("Account could not listen:", error.code || error.name);
        await pool.end();
        process.exitCode = 1;
      },
    );
    // Stop taking requests when the process shuts down.
    const stop = () =>
      server.close(
        /* Close the database pool after the server stops. */ () =>
          pool.end().catch(
            /* Set a failure exit status if pool cleanup fails. */ () => {
              process.exitCode = 1;
            },
          ),
      );
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    console.error(error.message);
    await pool?.end();
    process.exitCode = 1;
  }
}
