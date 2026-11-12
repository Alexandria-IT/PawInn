import {
  review,
  reviewReschedule,
  complete,
  postPetUpdate,
} from "../api/bookings.js";
import { catalog, inventory, setActive } from "../api/rooms.js";
import { today, toast } from "../helpers.js";
// Create staff dashboard state and actions.
export default () => ({
  tab: "requests",
  query: "",
  target: null,
  updateTarget: null,
  updateMessage: "",
  updateError: "",
  sendingUpdate: false,
  reviewKind: "cancel",
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
      (this.reviewKind !== "reschedule" || this.reviewRequest?.start > date)
    );
  },
  // Check whether the stay can be marked complete.
  canComplete(b) {
    return (
      b.status === "CONFIRMED" && b.end <= today() && !this.hasPendingRequest(b)
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
  // Open the update form with the booking's care instructions.
  openUpdate(booking) {
    this.updateTarget = booking;
    this.updateMessage = "";
    this.updateError = "";
    this.$refs.updatePhoto.value = "";
  },
  // Close the form after any send in progress finishes.
  closeUpdate() {
    if (!this.sendingUpdate) this.updateTarget = null;
  },
  // Post one update to the owner's inbox.
  async submitUpdate() {
    if (this.sendingUpdate) return;
    const photo = this.$refs.updatePhoto.files[0];
    if (photo?.size > 2 * 1024 * 1024) {
      this.updateError = "Choose a photo up to 2 MB.";
      return;
    }
    this.sendingUpdate = true;
    this.updateError = "";
    try {
      await postPetUpdate(
        this.updateTarget.id,
        this.updateMessage.trim(),
        photo,
      );
      this.updateTarget = null;
      toast("Pet update sent.");
    } catch (error) {
      this.updateError = error.message;
    } finally {
      this.sendingUpdate = false;
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
