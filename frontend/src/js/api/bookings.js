import { request } from "./client.js";
import { getToken } from "./account.js";
// Send a Booking request with the current token.
const call = (path, method = "GET", body) =>
  request(path, { method, body, token: getToken() });
// Fetch bookings visible to the signed-in account.
export const listBookings = () => call("bookings");
// Request a hold for the pet, room type, and dates.
export const reserve = (petId, roomTypeId, start, end) =>
  call("bookings", "POST", { petId, roomTypeId, start, end });
// Submit a simulated checkout attempt.
export const pay = (id, outcome, attemptId) =>
  call("bookings/" + encodeURIComponent(id) + "/checkout", "POST", {
    outcome,
    attemptId,
  });
// Send the customer's cancellation reason.
export const cancel = (id, reason) =>
  call("bookings/" + encodeURIComponent(id) + "/cancellations", "POST", {
    reason,
  });
// Submit the staff decision and review note.
export const review = (id, approved, notes) =>
  call("cancellations/" + encodeURIComponent(id), "PATCH", {
    decision: approved ? "APPROVED" : "DECLINED",
    notes,
  });
// Mark an eligible stay complete.
export const complete = (id) =>
  call("bookings/" + encodeURIComponent(id) + "/complete", "PATCH");
