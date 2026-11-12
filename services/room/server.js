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
  name: "room",
  port: 3002,
  tables: ["room_types", "rooms", "bookings", "users"],
});
