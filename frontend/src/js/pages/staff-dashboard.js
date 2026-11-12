import { review, complete } from "../api/bookings.js";
import { catalog, inventory, setActive } from "../api/rooms.js";
import { today, toast } from "../helpers.js";
// Create staff dashboard state and actions.
export default () => ({
  tab: "requests",
  query: "",
  target: null,
  approved: true,
  note: "",
  error: "",
  busy: false,
  rooms: [],
  types: [],
  inventoryError: "",
  inventoryLoading: false,
  // Read bookings available to a staff session.
  get all() {
    return this.$store.portal.user?.role === "STAFF"
      ? this.$store.portal.bookings
      : [];
  },
  // Return bookings with open cancellation requests.
  get requests() {
    return this.all.filter(
      /* Keep bookings whose cancellation is pending. */ (b) =>
        b.cancellation?.status === "PENDING",
    );
  },
  // Search the currently selected staff view.
  get items() {
    return (this.tab === "requests" ? this.requests : this.all).filter(
      /* Match the booking ID, pet name, or customer name. */ (b) =>
        (b.id + " " + b.petName + " " + b.customerName)
          .toLowerCase()
          .includes(this.query.toLowerCase()),
    );
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
  // Check whether the stay can be marked complete.
  canComplete(b) {
    return (
      b.status === "CONFIRMED" &&
      b.end <= today() &&
      b.cancellation?.status !== "PENDING"
    );
  },
  // Open the review form and choose its default decision.
  openReview(b) {
    this.target = b;
    this.approved = b.start > today();
    this.note = "";
    this.error = "";
  },
  // Save the cancellation decision and refresh the dashboard.
  async submitReview() {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await review(this.target.cancellation.id, this.approved, this.note);
      this.target = null;
      await this.$store.portal.refresh();
      toast(
        this.approved
          ? "Cancellation approved. Simulated refund recorded."
          : "Cancellation declined.",
      );
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
    }
  },
  // Mark the stay complete and refresh the list.
  async finish(b) {
    if (this.busy) return;
    this.busy = true;
    try {
      await complete(b.id);
      await this.$store.portal.refresh();
      toast("Stay marked completed.");
    } catch (error) {
      toast(error.message);
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
