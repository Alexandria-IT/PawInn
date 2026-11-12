import { cancel, quoteReschedule, reschedule } from "../api/bookings.js";
import { today, toast } from "../helpers.js";
// Create state and actions for My Bookings.
export default () => ({
  tab: "upcoming",
  query: "",
  detail: null,
  requestTarget: null,
  requestKind: "cancel",
  newStart: "",
  newEnd: "",
  quote: null,
  agreed: false,
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
      !b.arrivedAt &&
      b.cancellation?.status !== "PENDING" &&
      b.reschedule?.status !== "PENDING"
    );
  },
  // Clear the quote and acknowledgement when either date changes.
  clearQuote() {
    this.quote = null;
    this.agreed = false;
  },
  // Fetch the total for the dates currently entered on the form.
  async reviewDates() {
    if (this.busy || !this.newStart || !this.newEnd) return;
    const { newStart, newEnd, requestTarget } = this;
    this.busy = true;
    this.error = "";
    this.clearQuote();
    try {
      const quote = await quoteReschedule(requestTarget.id, newStart, newEnd);
      if (this.requestTarget === requestTarget && this.newStart === newStart && this.newEnd === newEnd)
        this.quote = quote;
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
    }
  },
  // Open the shared booking change form.
  openRequest(booking, kind) {
    this.detail = null;
    this.requestTarget = booking;
    this.requestKind = kind;
    this.newStart = booking.start;
    this.newEnd = booking.end;
    this.clearQuote();
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
      if (moving) {
        if (!this.quote || !this.agreed) {
          this.error = "Review and confirm the updated total first.";
          return;
        }
        await reschedule(bookingId, this.newStart, this.newEnd, this.reason, this.quote.newTotal);
      } else await cancel(bookingId, this.reason);
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
