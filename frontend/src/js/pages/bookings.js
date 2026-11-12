import { cancel } from "../api/bookings.js";
import { today, toast } from "../helpers.js";
// Create state and actions for My Bookings.
export default () => ({
  tab: "upcoming",
  query: "",
  detail: null,
  cancelTarget: null,
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
              (this.tab === "requests" && b.cancellation)) &&
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
  // Check whether the customer can request cancellation.
  canCancel(b) {
    return (
      b.status === "CONFIRMED" &&
      b.start > today() &&
      b.cancellation?.status !== "PENDING"
    );
  },
  // Prepare the cancellation form for the selected booking.
  openCancel(b) {
    this.detail = null;
    this.cancelTarget = b;
    this.reason = "";
    this.error = "";
  },
  // Send the request and refresh booking status.
  async submitCancel() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await cancel(this.cancelTarget.id, this.reason);
      await this.$store.portal.refresh();
      this.cancelTarget = null;
      toast("Cancellation request sent for staff review.");
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
    }
  },
});
