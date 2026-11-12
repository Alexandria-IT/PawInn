import {
  review,
  reviewReschedule,
  getBooking,
} from "../api/bookings.js";
import { catalog, inventory, setActive } from "../api/rooms.js";
import { today, toast } from "../helpers.js";
// Create staff dashboard state and actions.
export default () => ({
  tab: "requests",
  query: "",
  checkInFilter: "",
  bookingStatusFilter: "",
  requestTypeFilter: "",
  requestStatusFilter: "",
  detail: null,
  detailError: "",
  detailLoading: false,
  target: null,
  reviewKind: "cancel",
  approved: true,
  note: "",
  error: "",
  busy: false,
  rooms: [],
  types: [],
  inventoryError: "",
  inventoryLoading: false,
  // Keep the open details current without replacing an in-progress review.
  init() {
    this.$watch("$store.portal.bookings", (bookings) => {
      if (this.detail && !this.detailLoading) {
        this.detail = bookings.find(({ id }) => id === this.detail.id) ?? null;
      }
    });
  },
  // Read bookings available to a staff session.
  get all() {
    return this.$store.portal.user?.role === "STAFF"
      ? this.$store.portal.bookings
      : [];
  },
  // Return bookings with an open change request.
  get requests() {
    return this.all.filter(
      /* Keep bookings with a request for staff to review. */ (b) =>
        this.hasPendingRequest(b),
    );
  },
  // Search the currently selected staff view.
  get items() {
    return (this.tab === "requests" ? this.requests : this.all).filter(
      /* Apply filters to the booking and to the same change request. */ (b) => {
        if (this.checkInFilter && b.start !== this.checkInFilter) return false;
        if (this.bookingStatusFilter && b.status !== this.bookingStatusFilter) return false;
        if (!(b.id + " " + b.petName + " " + b.customerName).toLowerCase().includes(this.query.trim().toLowerCase())) return false;
        const type = this.requestTypeFilter;
        const status = this.requestStatusFilter;
        if (!type && !status) return true;
        const types = type ? [type] : ["cancellation", "reschedule"];
        return types.some((key) => b[key] && (!status || b[key].status === status)
          && (this.tab !== "requests" || b[key].status === "PENDING"));
      },
    );
  },
  // Clear all booking filters while keeping the current tab.
  clearFilters() {
    this.query = this.checkInFilter = this.bookingStatusFilter = this.requestTypeFilter = this.requestStatusFilter = "";
  },
  // Open a booking and fetch its latest details from the service.
  async openDetails(booking) {
    this.detail = booking;
    this.detailError = "";
    this.detailLoading = true;
    try {
      const details = await getBooking(booking.id);
      if (this.detail?.id === booking.id) this.detail = details;
    } catch (error) {
      if (this.detail?.id === booking.id) this.detailError = error.message;
    } finally {
      if (this.detail?.id === booking.id) this.detailLoading = false;
    }
  },
  // Count confirmed arrivals for today.
  get arrivals() {
    return this.all.filter(
      /* Match confirmed stays that start today. */ (b) =>
        b.status === "CONFIRMED" && b.start === today(),
    ).length;
  },
  // Count confirmed stays that are in progress.
  get occupied() {
    return this.all.filter(
      /* Include stays through the night before checkout. */ (b) =>
        b.status === "CONFIRMED" && b.start <= today() && b.end > today(),
    ).length;
  },
  // Check whether the booking is waiting for a staff decision.
  hasPendingRequest(booking) {
    return (
      booking.cancellation?.status === "PENDING" ||
      booking.reschedule?.status === "PENDING"
    );
  },
  // Get the active request for the review dialog.
  get reviewRequest() {
    return this.reviewKind === "reschedule"
      ? this.target?.reschedule
      : this.target?.cancellation;
  },
  // Check whether the active request can still be approved.
  get canApprove() {
    const date = today();
    return (
      this.target?.status === "CONFIRMED" &&
      this.target.start > date &&
      !this.target.arrivedAt &&
      (this.reviewKind !== "reschedule" || this.reviewRequest?.start > date)
    );
  },
  // Open the review form and choose its default decision.
  openReview(b) {
    this.target = b;
    this.reviewKind =
      b.reschedule?.status === "PENDING" ? "reschedule" : "cancel";
    this.approved = this.canApprove;
    this.note = "";
    this.error = "";
  },
  // Save the decision and refresh the dashboard.
  async submitReview() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      if (this.reviewKind === "reschedule") {
        await reviewReschedule(
          this.target.id,
          this.reviewRequest.id,
          this.approved,
          this.note,
        );
        toast(
          this.approved
            ? "Reschedule approved. Booking dates updated."
            : "Reschedule declined.",
        );
      } else {
        await review(this.reviewRequest.id, this.approved, this.note);
        toast(
          this.approved
            ? "Cancellation approved. Simulated refund recorded."
            : "Cancellation declined.",
        );
      }
      this.target = null;
      await this.$store.portal.refresh();
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
    }
  },
  // Fetch inventory and room type names for staff.
  async loadRooms() {
    this.inventoryLoading = true;
    this.inventoryError = "";
    try {
      [this.rooms, this.types] = await Promise.all([inventory(), catalog()]);
    } catch (error) {
      this.inventoryError = error.message;
    } finally {
      this.inventoryLoading = false;
    }
  },
  // Change one room's active status and update the list.
  async toggleRoom(room) {
    if (this.busy) return;
    this.busy = true;
    this.inventoryError = "";
    try {
      const changed = await setActive(room.id, !room.isActive);
      this.rooms = this.rooms.map(
        /* Replace the saved room in the local list. */ (r) =>
          r.id === changed.id ? changed : r,
      );
    } catch (error) {
      this.inventoryError = error.message;
    } finally {
      this.busy = false;
    }
  },
  // Find a room type's display name.
  typeName(id) {
    return (
      this.types.find(/* Match the room type ID. */ (t) => t.id === id)?.name ||
      "Room"
    );
  },
});
