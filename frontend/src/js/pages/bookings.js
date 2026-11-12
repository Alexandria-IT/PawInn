import { cancel, quoteReschedule, reschedule } from "../api/bookings.js";
import { today, toast } from "../helpers.js";
// Create state and actions for My Bookings.
export default () => ({
  tab: "upcoming",
  query: "",
  detail: null,
  openCareOnDetail: false,
  requestTarget: null,
  requestKind: "cancel",
  newStart: "",
  newEnd: "",
  quote: null,
  agreed: false,
  reason: "",
  error: "",
  busy: false,
  // Open the requested history tab or the booking linked from Pet Updates.
  init() {
    this.$watch("$store.portal.bookings", (bookings) => {
      if (this.detail) {
        this.detail = bookings.find(({ id }) => id === this.detail.id) ?? null;
      }
    });
    const params = new URLSearchParams(location.search);
    if (params.get("tab") === "history") this.tab = "history";
    const bookingId = params.get("careBooking");
    if (!bookingId) return;
    const openLinkedBooking = () => {
      if (this.$store.portal.user?.role !== "CUSTOMER") return;
      const booking = this.$store.portal.bookings.find(({ id }) => id === bookingId);
      if (booking) {
        this.tab = "all";
        this.openDetails(booking, true);
      }
    };
    if (this.$store.portal.ready) openLinkedBooking();
    else this.$watch("$store.portal.ready", openLinkedBooking);
  },
  // Open the booking dialog and optionally start on its care tab.
  openDetails(booking, showCare = false) {
    this.openCareOnDetail = showCare;
    this.detail = booking;
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
