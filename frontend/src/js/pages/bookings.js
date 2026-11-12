import { cancel, reschedule } from "../api/bookings.js";
import { addDays, nights, today, toast } from "../helpers.js";
// Create state and actions for My Bookings.
export default () => ({
  tab: "upcoming",
  query: "",
  detail: null,
  requestTarget: null,
  requestKind: "cancel",
  newStart: "",
  reason: "",
  error: "",
  busy: false,
  // Open the history tab when requested by the URL.
  init() {
    if (new URLSearchParams(location.search).get("tab") === "history")
      this.tab = "history";
  },
  // Return matching bookings in newest-first order.
  get items() {
    return this.$store.portal.bookings
      .filter(
        /* Match the current tab and booking search. */ (b) => {
          const active = ["PENDING", "CONFIRMED"].includes(b.status);
          return (
            (this.tab === "all" ||
              (this.tab === "upcoming" && active) ||
              (this.tab === "history" && !active) ||
              (this.tab === "requests" && (b.cancellation || b.reschedule))) &&
            `${b.id} ${b.petName}`
              .toLowerCase()
              .includes(this.query.toLowerCase())
          );
        },
      )
      .sort(
        /* Put recently created bookings first. */ (a, b) =>
          b.createdAt.localeCompare(a.createdAt),
      );
  },
  // Check whether the customer can request a change to this stay.
  canRequestChange(b) {
    return (
      b.status === "CONFIRMED" &&
      b.start > today() &&
      b.cancellation?.status !== "PENDING" &&
      b.reschedule?.status !== "PENDING"
    );
  },
  // Preserve the length of the stay when the check-in moves.
  get newEnd() {
    if (!this.requestTarget || !this.newStart) return "";
    return addDays(
      this.newStart,
      nights(this.requestTarget.start, this.requestTarget.end),
    );
  },
  // Open the shared booking change form.
  openRequest(booking, kind) {
    this.detail = null;
    this.requestTarget = booking;
    this.requestKind = kind;
    this.newStart = "";
    this.reason = "";
    this.error = "";
  },
  // Send the change request and refresh booking status.
  async submitRequest() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      const bookingId = this.requestTarget.id;
      const moving = this.requestKind === "reschedule";
      if (moving)
        await reschedule(bookingId, this.newStart, this.newEnd, this.reason);
      else await cancel(bookingId, this.reason);
      await this.$store.portal.refresh();
      this.requestTarget = null;
      toast(
        moving
          ? "Reschedule request sent for staff review."
          : "Cancellation request sent for staff review.",
      );
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
    }
  },
});
