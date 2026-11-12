// Connect browser notifications to the Alpine UI store.
export function installAlerts(Alpine) {
  window.addEventListener(
    "pawinn:toast",
    /* Show the notification message from the event. */ (event) =>
      Alpine.store("ui").notify(event.detail),
  );
}
