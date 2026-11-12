import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import { runService, transaction } from "../shared/runtime.js";
import { routes } from "./routes.js";
const startupConnectionErrors = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "08001",
  "08006",
  "57P01",
  "57P02",
  "57P03",
]);

// Apply the additive schema before accepting Booking requests.
async function prepare(pool) {
  const rescheduleSchema = await readFile(
    new URL("./reschedule-schema.sql", import.meta.url),
    "utf8",
  );
  const updateSchema = await readFile(
    new URL("./pet-updates-schema.sql", import.meta.url),
    "utf8",
  );
  // Docker can restart Booking and PostgreSQL at the same time.
  for (let attempt = 1; ; attempt++) {
    try {
      await transaction(
        pool,
        /* Apply both migrations under the shared inventory lock. */ async (
          db,
        ) => {
          await db.query(rescheduleSchema);
          await db.query(updateSchema);
        },
      );
      return;
    } catch (error) {
      if (
        attempt >= 15 ||
        (error.code && !startupConnectionErrors.has(error.code))
      )
        throw error;
      await delay(1000);
    }
  }
}

await runService(import.meta.url, {
  prepare,
  express,
  pg,
  jwt,
  routes,
  name: "booking",
  port: 3003,
  tables: [
    "bookings",
    "booking_logs",
    "cancellation_requests",
    "reschedule_requests",
    "pet_updates",
    "rooms",
    "room_types",
    "pets",
    "users",
  ],
});
