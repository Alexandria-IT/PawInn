import { editHold, pay } from "../api/bookings.js";
import { catalog } from "../api/rooms.js";
// Create state for a simulated checkout.
export default () => ({
  id: "",
  result: "success",
  accepted: false,
  error: "",
  busy: false,
  seconds: 0,
  timer: null,
  expiredRefresh: false,
  attempt: null,
  editing: null,
  roomTypes: [],
  editError: "",
  // Show only room types suited to the pet selected in the editor.
  get editRoomTypes() {
    const pet = this.$store.portal.pets.find((p) => p.id === this.editing?.petId);
    return this.roomTypes.filter((room) => room.species === pet?.species);
  },
  // Load the editor with the existing hold, including optional care instructions.
  async openEditor() {
    if (!this.booking || this.busy) return;
    this.error = "";
    this.editError = "";
    const { petId, roomTypeId, start, end, specialCare } = this.booking;
    this.editing = { petId, roomTypeId, start, end, specialCare };
    try {
      this.roomTypes = await catalog();
    } catch (error) {
      this.editError = error.message;
    }
  },
  // Keep the same booking reference and hold deadline when saving corrections.
  async saveEditor() {
    if (!this.editing || this.busy) return;
    this.busy = true;
    this.editError = "";
    try {
      await editHold(this.id, { ...this.editing });
      this.accepted = false;
      this.attempt = null;
      this.editing = null;
      await this.$store.portal.refresh();
      this.$nextTick(() => this.$refs.editBookingButton?.focus());
    } catch (error) {
      this.editError = error.message;
    } finally {
      this.busy = false;
    }
  },
  // Read the booking ID and start the hold countdown.
  init() {
    this.id = new URLSearchParams(location.search).get("booking") || "";
    this.tick();
    this.timer = setInterval(
      /* Update the countdown once per second. */ () => this.tick(),
      1000,
    );
  },
  // Stop the countdown when checkout is removed.
  destroy() {
    clearInterval(this.timer);
  },
  // Update the time left and refresh when a pending hold expires.
  tick() {
    this.seconds = Math.max(
      0,
      Math.ceil(((this.booking?.expiresAt || 0) - Date.now()) / 1000),
    );
    if (
      this.booking?.status === "PENDING" &&
      !this.seconds &&
      !this.expiredRefresh
    ) {
      this.expiredRefresh = true;
      this.$store.portal.refresh();
    }
  },
  // Find the booking currently open in checkout.
  get booking() {
    return this.$store.portal.bookings.find(
      /* Match the booking ID from the URL. */ (b) => b.id === this.id,
    );
  },
  // Format the remaining time as minutes and seconds.
  get countdown() {
    return `${Math.floor(this.seconds / 60)}:${String(this.seconds % 60).padStart(2, "0")}`;
  },
  // Submit the simulated result and refresh the booking.
  async submit() {
    if (this.busy) return;
    this.error = "";
    if (!this.accepted) {
      this.error = "Please acknowledge that this is a simulated payment.";
      return;
    }
    this.busy = true;
    const outcome = this.result === "success" ? "SUCCESS" : "FAILED";
    // Reuse the attempt ID when a network error leaves the result uncertain.
    if (this.attempt?.outcome !== outcome)
      this.attempt = { outcome, id: crypto.randomUUID() };
    try {
      const b = await pay(this.id, outcome, this.attempt.id);
      this.attempt = null;
      await this.$store.portal.refresh();
      if (b.paymentStatus === "FAILED")
        this.error =
          "Simulated payment declined. Your room is still held—select success to retry.";
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
    }
  },
});
