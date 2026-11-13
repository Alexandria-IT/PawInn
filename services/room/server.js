import { readFile } from "node:fs/promises";
import express from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import { runService, transaction } from "../shared/runtime.js";
import { routes } from "./routes.js";
// Create the closure table when an existing database is upgraded.
async function prepare(pool) {
  const sql = await readFile(new URL("../shared/room-closures.sql", import.meta.url), "utf8");
  await transaction(pool, (db) => db.query(sql));
}

await runService(import.meta.url, {
  prepare,
  express,
  pg,
  jwt,
  routes,
  name: "room",
  port: 3002,
  tables: ["room_types", "rooms", "bookings", "users", "room_closures"],
});
