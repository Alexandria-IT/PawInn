// Create shared notification state.
export default () => ({
  message: "",
  timer: null,
  // Display a message and restart its dismissal timer.
  notify(message) {
    this.message = message;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      /* Clear the message when the timer expires. */ () => {
        this.message = "";
      },
      5000,
    );
  },
});
