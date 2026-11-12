import {
  fetchStayCarePhoto,
  readStayCare,
  recordAttendance,
  saveCareEvent,
  saveDailyReport,
} from "../api/stay-care.js";
import { postPetUpdate } from "../api/bookings.js";
import { dateLabel, toast } from "../helpers.js";

const bangkok = "Asia/Bangkok";
const inputFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: bangkok,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: bangkok,
  dateStyle: "medium",
  timeStyle: "short",
});
const careTypes = ["Feeding", "Medication", "Exercise", "Grooming", "Health check", "Other"];
const photoLimit = 2 * 1024 * 1024;
const photoTypes = ["image/jpeg", "image/png", "image/webp"];

// Convert an instant to the date and time shown by Bangkok form fields.
export function bangkokInput(at = new Date()) {
  const { year, month, day, hour, minute } = Object.fromEntries(
    inputFormat.formatToParts(new Date(at)).map(({ type, value }) => [type, value]),
  );
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

// Convert a Bangkok form value to the same instant in UTC.
export const bangkokInstant = (value) =>
  new Date(`${value}+07:00`).toISOString();

// Keep the displayed entries in chronological order within each day.
export function chronologicalDays(days) {
  return days
    .map((day) => ({
      ...day,
      events: [...day.events].sort((a, b) => a.time.localeCompare(b.time)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Manage one booking's care history and, for staff, its entry forms.
export default (isStaff) => ({
  isStaff,
  careTab: "details",
  careBooking: null,
  careData: null,
  careLoading: false,
  careError: "",
  careRequestNumber: 0,
  careWriting: false,
  careRefreshPending: false,
  careForm: null,
  careFormTrigger: null,
  careFormError: "",
  attendanceTime: "",
  reportDate: "",
  reportMessage: "",
  quickUpdateMessage: "",
  eventDate: "",
  careEvent: null,
  legacyCareType: "",

  // Preserve an older free-text category when editing an existing entry.
  get careTypeOptions() {
    return this.legacyCareType ? [...careTypes, this.legacyCareType] : careTypes;
  },

  // Bound the form to scheduled Bangkok dates and actual time up to now.
  attendanceBounds(kind) {
    const now = bangkokInput();
    const start = this.careBooking?.start;
    const end = this.careBooking?.end;
    if (!start || !end) return { min: "", max: "", available: false };
    const first = start + "T00:00";
    const arrived = this.careData?.arrivedAt;
    const arrival = kind === "pickup" && arrived ? bangkokInput(arrived) : first;
    const min = arrival > first ? arrival : first;
    const last = end + "T23:59";
    const max = now < last ? now : last;
    return { min, max, available: min <= max };
  },

  // Clear booking-specific state when the modal or session changes.
  init() {
    this.$watch("$store.portal.user?.id", () => this.resetCare());
    if (!this.isStaff) {
      this.$watch("detail?.id", () => this.syncCustomerBooking());
      this.syncCustomerBooking();
    }
  },

  // Open the care tab when the customer follows a link from Pet Updates.
  syncCustomerBooking() {
    this.resetCare();
    if (this.openCareOnDetail && this.hasCareTab(this.detail)) this.selectCareTab("care");
  },

  // Invalidate pending reads and return to the initial view.
  resetCare() {
    this.careRequestNumber++;
    this.careTab = "details";
    this.careBooking = null;
    this.careData = null;
    this.careLoading = false;
    this.careRefreshPending = false;
    this.careError = "";
    this.careForm = null;
    this.careFormTrigger = null;
    this.careFormError = "";
    this.attendanceTime = "";
    this.reportDate = "";
    this.reportMessage = "";
    this.quickUpdateMessage = "";
    this.eventDate = "";
    this.careEvent = null;
  },

  // Determine whether a customer booking has a stay-care tab.
  hasCareTab(booking) {
    return ["CONFIRMED", "COMPLETED"].includes(booking?.status);
  },

  // Switch booking panels and load private care history on first use.
  selectCareTab(tab) {
    this.careTab = tab;
    if (tab === "care" && this.hasCareTab(this.detail)) {
      this.careBooking = this.detail;
      if (!this.careData && !this.careLoading) this.loadCare();
    }
  },

  // Move keyboard focus between the two booking tabs.
  moveCareTab(key) {
    const next = key === "Home" ? "details" : key === "End" ? "care"
      : this.careTab === "details" ? "care" : "details";
    this.selectCareTab(next);
    const button = next === "details" ? this.$refs.detailsTab : this.$refs.careTab;
    button.focus();
  },

  // Open the staff dialog and load its booking history.
  openStaffCare(booking) {
    if (this.careWriting || this.$store.portal.user?.role !== "STAFF") return;
    this.resetCare();
    this.careBooking = booking;
    this.loadCare();
  },

  // Close the staff dialog after a pending save finishes.
  closeStaffCare() {
    if (this.careBooking && !this.careWriting) this.resetCare();
  },

  // Queue a live change while an editor is open, so it cannot disturb the form.
  refreshCareFromEvent({ bookingId, area }) {
    if (!this.careBooking || (bookingId && bookingId !== this.careBooking.id) || area === "update") return;
    if (this.careForm || this.careLoading) {
      this.careRefreshPending = true;
      return;
    }
    this.loadCare(true);
  },

  // Fetch only the currently selected booking's history.
  async loadCare(quiet = false) {
    if (!this.careBooking) return;
    const requestNumber = ++this.careRequestNumber;
    this.careRefreshPending = false;
    if (!quiet) {
      this.careLoading = true;
      this.careError = "";
    }
    try {
      const data = await readStayCare(this.careBooking.id);
      if (requestNumber === this.careRequestNumber) {
        if (quiet && this.careForm) {
          this.careRefreshPending = true;
        } else {
          this.careData = { ...data, days: chronologicalDays(data.days) };
          this.careError = "";
        }
      }
    } catch (error) {
      if (!quiet && requestNumber === this.careRequestNumber) this.careError = error.message;
    } finally {
      if (requestNumber === this.careRequestNumber) {
        this.careLoading = false;
        if (this.careRefreshPending && !this.careForm) this.loadCare(true);
      }
    }
  },

  // Format a care day or attendance time for display in Bangkok.
  careDate: dateLabel,
  careTimestamp(at) {
    return dateTimeFormat.format(new Date(at));
  },

  // Return the latest available day for a new report or event.
  get latestCareDay() {
    return this.careData?.days.at(-1)?.date || "";
  },

  // Find the report currently being published or corrected.
  get selectedReport() {
    return this.careData?.days.find(({ date }) => date === this.reportDate)?.report;
  },

  // Show one staff editor and focus its heading.
  showCareForm(form) {
    this.careFormTrigger = document.activeElement.closest("button");
    this.careForm = form;
    this.careFormError = "";
    this.$nextTick(() => this.$refs.careEditor?.focus());
  },

  // Restore focus after closing an editor, even if its action is no longer available.
  closeCareForm() {
    const trigger = this.careFormTrigger;
    this.careForm = null;
    this.careFormTrigger = null;
    this.careFormError = "";
    if (this.careRefreshPending) this.loadCare(true);
    this.$nextTick(() => {
      const target = trigger?.getClientRects().length && !trigger.disabled
        ? trigger
        : this.$refs.staffCareTitle;
      target?.focus();
    });
  },

  // Start entering an actual arrival or pickup time.
  openAttendance(kind) {
    const now = bangkokInput();
    const { min, max, available } = this.attendanceBounds(kind);
    if (!available) return;
    this.attendanceTime = now >= min && now <= max ? now : "";
    this.showCareForm(kind);
  },

  // Load the chosen day's report into the editor.
  chooseReportDate(date) {
    this.reportDate = date;
    this.reportMessage = this.selectedReport?.message || "";
    this.careFormError = "";
    if (this.$refs.carePhotos) this.$refs.carePhotos.value = "";
  },

  // Open the report editor for a specific care day.
  openDailyReport(date = this.latestCareDay) {
    this.chooseReportDate(date);
    this.showCareForm("report");
  },

  // Open a blank event or copy the previous entry into the editor.
  openCareEvent(date = this.latestCareDay, event = null) {
    this.eventDate = date;
    this.legacyCareType = event?.careType && !careTypes.includes(event.careType)
      ? event.careType
      : "";
    const now = bangkokInput();
    this.careEvent = event
      ? { ...event, time: event.time.slice(0, 5) }
      : {
          time: date === now.slice(0, 10) ? now.slice(11) : "",
          careType: "",
          action: "",
          observation: "",
          status: "PERFORMED",
          reason: "",
          followUp: "",
        };
    this.showCareForm("event");
  },

  // Save the active editor and refresh history without replaying a saved write.
  async writeCare(save, success, refreshBookings = false) {
    if (this.careWriting || !this.careBooking) return;
    this.careWriting = true;
    this.careFormError = "";
    const bookingId = this.careBooking.id;
    let saved = false;
    try {
      await save(bookingId);
      if (this.careBooking?.id !== bookingId) return;
      saved = true;
      toast(success);
      await this.loadCare();
      if (refreshBookings) await this.$store.portal.refresh();
    } catch (error) {
      if (this.careBooking?.id === bookingId) {
        if (saved) this.careError = error.message;
        else this.careFormError = error.message;
      }
    } finally {
      this.careWriting = false;
      if (saved && this.careBooking?.id === bookingId) this.closeCareForm();
    }
  },

  // Record the selected timestamp in the hotel's time zone.
  submitAttendance() {
    const kind = this.careForm;
    return this.writeCare(
      (id) => recordAttendance(id, kind, bangkokInstant(this.attendanceTime)),
      kind === "arrival" ? "Arrival recorded." : "Pickup recorded. Stay completed.",
      true,
    );
  },

  // Upload new report photos when supplied and save the report text.
  submitDailyReport() {
    const photos = [...this.$refs.carePhotos.files];
    if (photos.some((photo) => !photoTypes.includes(photo.type) || photo.size > photoLimit)) {
      this.careFormError = "Choose JPEG, PNG, or WebP photos up to 2 MB each.";
      return;
    }
    if (photos.reduce((total, photo) => total + photo.size, 0) >= 3 * 1024 * 1024) {
      this.careFormError = "Choose photos totaling less than 3 MB.";
      return;
    }
    return this.writeCare(
      (id) => saveDailyReport(id, this.reportDate, this.reportMessage.trim(), photos),
      this.selectedReport ? "Daily report updated." : "Daily report published.",
    );
  },

  // Open a fresh editor for an optional message and photo.
  openQuickUpdate() {
    this.quickUpdateMessage = "";
    if (this.$refs.quickUpdatePhoto) this.$refs.quickUpdatePhoto.value = "";
    this.showCareForm("update");
  },

  // Send one private message or photo from the booking's care screen.
  submitQuickUpdate() {
    const message = this.quickUpdateMessage.trim();
    const photo = this.$refs.quickUpdatePhoto.files[0];
    if (!message && !photo) {
      this.careFormError = "Write a message or attach a photo.";
      return;
    }
    if (photo && !photoTypes.includes(photo.type)) {
      this.careFormError = "Choose a JPEG, PNG, or WebP photo.";
      return;
    }
    if (photo?.size > photoLimit) {
      this.careFormError = "Choose a photo up to 2 MB.";
      return;
    }
    return this.writeCare(
      (id) => postPetUpdate(id, message, photo),
      "Pet update sent.",
    );
  },

  // Submit only the current event fields and applicable exception details.
  submitCareEvent() {
    const { id: eventId, time, careType, action, observation, status, reason, followUp } = this.careEvent;
    const body = {
      time,
      careType: careType.trim(),
      action: action.trim(),
      observation: observation.trim(),
      status,
      ...(status === "NOT_PERFORMED" && {
        reason: (reason ?? "").trim(),
        followUp: (followUp ?? "").trim(),
      }),
    };
    return this.writeCare(
      (id) => saveCareEvent(id, this.eventDate, eventId, body),
      eventId ? "Care entry updated." : "Care entry recorded.",
    );
  },
});

// Load a private photo and release it when the booking panel is removed.
export function stayCarePhoto(bookingId, photoId) {
  const controller = new AbortController();
  return {
    carePhotoSource: "",
    carePhotoError: "",
    // Create a browser-only URL after the authenticated download.
    async init() {
      try {
        const photo = await fetchStayCarePhoto(bookingId, photoId, controller.signal);
        if (!controller.signal.aborted) this.carePhotoSource = URL.createObjectURL(photo);
      } catch (error) {
        if (!controller.signal.aborted) this.carePhotoError = error.message;
      }
    },
    // Cancel an in-flight download and release a previously loaded photo.
    destroy() {
      controller.abort();
      if (this.carePhotoSource) URL.revokeObjectURL(this.carePhotoSource);
    },
  };
}
