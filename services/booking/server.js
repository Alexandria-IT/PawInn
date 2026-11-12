import express from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import { runService } from "../shared/runtime.js";
import { routes } from "./routes.js";
runService(import.meta.url, {
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
    "rooms",
    "room_types",
    "pets",
    "users",
  ],
});
