import { request } from "./client.js";
import { getToken } from "./account.js";
// Send a Booking request with the current token.
const call = (path, method = "GET", body) =>
  request(path, { method, body, token: getToken() });
// Fetch bookings visible to the signed-in account.
export const listBookings = () => call("bookings");
// Request a hold for the pet, room type, and dates.
export const reserve = (petId, roomTypeId, start, end, specialCare) =>
  call("bookings", "POST", { petId, roomTypeId, start, end, specialCare });
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
// Request new dates for a confirmed booking.
export const reschedule = (id, start, end, reason) =>
  call("bookings/" + encodeURIComponent(id) + "/reschedules", "POST", {
    start,
    end,
    reason,
  });
// Submit the staff decision on the requested dates.
export const reviewReschedule = (bookingId, requestId, approved, notes) =>
  call(
    "bookings/" +
      encodeURIComponent(bookingId) +
      "/reschedules/" +
      encodeURIComponent(requestId),
    "PATCH",
    {
      decision: approved ? "APPROVED" : "DECLINED",
      notes,
    },
  );
// Load the latest pet updates or the next page of the customer's feed.
export const listPetUpdates = (before) =>
  call(
    "bookings/updates" +
      (before ? "?before=" + encodeURIComponent(before) : ""),
  );
// Fetch an update's photo with the same session as the feed.
export const fetchPetUpdatePhoto = (id, signal) =>
  request("bookings/updates/" + encodeURIComponent(id) + "/photo", {
    token: getToken(),
    asBlob: true,
    signal,
  });
// Send an update as a form so the photo can be uploaded as binary.
export function postPetUpdate(bookingId, message, photo) {
  const form = new FormData();
  form.set("message", message);
  if (photo) form.set("photo", photo);
  return call(
    "bookings/" + encodeURIComponent(bookingId) + "/updates",
    "POST",
    form,
  );
}
// Mark an eligible stay complete.
export const complete = (id) =>
  call("bookings/" + encodeURIComponent(id) + "/complete", "PATCH");
