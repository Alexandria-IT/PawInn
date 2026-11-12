export class RequestError extends Error {
  // Carry a client-safe message and its HTTP status.
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
// Stop the request with a controlled error.
export const fail = (status, message) => {
  throw new RequestError(status, message);
};
// Send data in the shared API response shape.
export const send = (res, data, status = 200) => res.status(status).json({ data });
// Map public account fields to the API response.
export const userDto = (r) => ({
  id: String(r.user_id),
  name: r.full_name,
  email: r.email,
  phone: r.phone,
  role: r.role,
});

// Validate the request object's allowed fields.
export function fields(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      /* Detect a field outside the route's allowed list. */ (key) =>
        !allowed.includes(key),
    )
  ) {
    fail(400, "Send a JSON object with only the supported fields.");
  }
  return body;
}
// Trim and validate an account or pet form field.
export function clean(value, label, max, min = 0) {
  if ((value === undefined || value === null) && !min) return null;
  if (typeof value !== "string" || value.includes("\0"))
    fail(400, label + " is invalid.");
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail(
      400,
      label +
        " must be " +
        (min ? min + " to " : "at most ") +
        max +
        " characters.",
    );
  }
  return trimmed || null;
}
// Normalize the email and check bcrypt's password byte limit.
export function credentials(body, min = 1) {
  const email = clean(body.email, "Email", 254, 1).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, "Enter a valid email address.");
  const password = body.password;
  if (
    typeof password !== "string" ||
    password.length < min ||
    Buffer.byteLength(password) > 72 ||
    password.includes("\0")
  ) {
    fail(
      400,
      "Password must be at least " + min + " characters and at most 72 bytes.",
    );
  }
  return { email, password };
}
// Parse an ID in the PostgreSQL integer range.
export function parseId(id) {
  return typeof id === "string" &&
    /^[1-9]\d{0,9}$/.test(id) &&
    Number(id) <= 2147483647
    ? Number(id)
    : null;
}
