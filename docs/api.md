# PawInn API agreement

Account, Room and Booking endpoints below are implemented. Update this file when an API changes.

## Shared conventions

- JSON request/response bodies; camelCase field names.
- Database IDs are generated INTEGER primary keys. Serialize them as opaque strings at the HTTP boundary; validate/convert incoming IDs before parameterized queries.
- Dates: `YYYY-MM-DD`. Timestamps: ISO 8601. Check-out must be after check-in.
- Currency: THB. Store database money as exact decimal values or integer satang; never trust a total sent by the browser.
- Authentication: `Authorization: Bearer <token>`. Account owns token issuance; each service validates it and enforces roles/ownership.
- Success: `{"data": ...}`. Error: `{"message": "A useful explanation"}`.
- Use 201 for creation; 200 for normal success; 204 for successful deletion; 400 invalid input; 401 unauthenticated; 403 forbidden; 404 missing; 409 conflicting state.
- Each service exposes `GET /health`.
- All three services connect to the shared `pawinn` database. The SQL already defines matching integer PK/FK types across the shared tables; API IDs remain strings at the HTTP boundary.
- Services primarily write their own tables. Shared reads/joins are allowed for ownership, availability and prices; internal HTTP lookups are optional rather than required.
- The frontend calls these APIs on the same origin through Nginx.

## Member 2: account

| Method/path | Behavior |
| --- | --- |
| POST /api/auth/register | Accept name, email, password and a required contact phone number; create CUSTOMER only; return token and public user |
| POST /api/auth/login | Accept email/password; return token and public user |
| GET /api/users/me | Return the signed-in user |
| PATCH /api/users/me | Customer adds or updates their emergency contact phone |
| GET /api/pets | Return the customer's pets |
| GET /api/pets/:id | Return an owned pet; booking can verify ownership directly against the shared pets table |
| POST /api/pets | Create an owned pet |
| PATCH /api/pets/:id | Update an owned pet |
| DELETE /api/pets/:id | Delete an owned pet only when no booking references it; preserve booking history |
| GET /api/admin/users | Admin searches by name/email and filters by role or status; supports `before` pagination |
| POST /api/admin/users | Admin creates a staff account |
| PATCH /api/admin/users/:userId | Admin grants or revokes staff access, or suspends/reactivates an account |
| GET /api/admin/audit | Admin reads account changes with actor, target, details and time; supports `userId` and `before` |

Account issues an HS256 JWT with a one-hour expiry, issuer `pawinn-account`, audience `pawinn` and the string user ID in `sub`. Use `Authorization: Bearer <token>` for protected routes. A successful login or registration returns `{data: {token, user}}`. Account checks the current database role rather than relying solely on the token claim. Foreign and missing pets return 404; a referenced pet deletion returns 409.

Public user: `{id, name, email, phone, role}`; never return password hashes.
Pet: `{id, ownerId, name, species, breed, birthDate, notes}`.
Roles: CUSTOMER, STAFF, ADMIN. Species: Dog, Cat.
Account state changes revoke existing sessions across Account, Room and Booking. Bootstrap the first Admin through the operator CLI; staff accounts are created by an Admin and public registration creates customers only.
Account and booking owners coordinate pets/bookings foreign keys and active-booking checks before changing a booked pet's species. A normal FK prevents deleting a referenced pet; reject that deletion rather than cascading away booking history.

## Member 3: room

| Method/path | Behavior |
| --- | --- |
| GET /api/room-types | Return descriptions, compatible species and base prices |
| GET /api/rooms | Return room inventory; support optional roomTypeId and active filters |
| PATCH /api/rooms/:id | Staff changes active/inactive status |

Room type: `{id, name, description, species, pricePerNight}`.
Room: `{id, roomTypeId, roomNumber, isActive}`.
Start with seed SQL for inventory; add more management endpoints only if the team needs them.
Deactivation returns 409 when a room has a current or upcoming reservation. All three types share the agreed inventory target of five physical rooms each (15 total).

## Member 4: booking

| Method/path | Behavior |
| --- | --- |
| GET /api/availability?start=...&end=... | Return `[{roomTypeId, available}]`; optionally filter species |
| POST /api/bookings | Accept petId, roomTypeId, start, end, and optional specialCare; choose an available physical room and calculate the price |
| GET /api/bookings | Customers see their own; staff can see all; support optional petId/status filters |
| GET /api/bookings/:id | Return an owned booking, or any booking for staff, including timeline and cancellation state |
| DELETE /api/bookings/:id/hold | Customer cancels their unpaid hold and releases the room immediately |
| PATCH /api/bookings/:id/hold | Edit a customer’s unpaid hold with the same fields as reservation; keep the reference and original expiry |
| POST /api/bookings/:id/checkout | Accept outcome SUCCESS or FAILED and a payment attempt ID; simulate payment, safely handle retries |
| POST /api/bookings/:id/cancellations | Accept reason; create a customer request for an eligible booking |
| GET /api/cancellations | Staff lists requests; support optional status filter |
| PATCH /api/cancellations/:id | Staff submits decision APPROVED or DECLINED plus notes |
| GET /api/bookings/:id/reschedules/quote | Quote new dates with `start` and `end`; returns original total, new total and difference |
| POST /api/bookings/:id/reschedules | Customer submits `start`, `end`, `reason` and the quoted `confirmedTotal` |
| PATCH /api/bookings/:id/reschedules/:requestId | Staff approves or declines with a review note |
| POST /api/bookings/:id/updates | Staff posts an update for a confirmed stay using multipart form data |
| GET /api/bookings/updates | Customer reads their own quick updates and daily reports, newest first, with an optional `before` cursor |
| GET /api/bookings/updates/:id/photo | Booking owner fetches the private image |
| GET /api/bookings/:id/care | Staff or owner reads the stay’s Bangkok calendar, including missing reports |
| PATCH /api/bookings/:id/care/arrival or /pickup | Staff records actual arrival or pickup within the scheduled dates in Bangkok (`at` ISO timestamp; defaults to now). Pickup completes the stay. |
| PUT /api/bookings/:id/care/days/:date/report | Staff publishes or corrects a daily report; multipart `message` and `photo` fields |
| POST /api/bookings/:id/care/days/:date/events | Staff records a care event immediately |
| PATCH /api/bookings/:id/care/days/:date/events/:eventId | Staff corrects a care event |
| GET /api/bookings/:id/care/photos/:photoId | Owner or staff loads the private report image; only staff can read superseded photos |

Booking response: `{id, userId, petId, roomId, roomTypeId, start, end, nightlyRate, total, status, paymentStatus, refundStatus, createdAt}`; responses also include room number, room name, pet name, customer name, specialCare, hold expiry in epoch milliseconds, logs and the latest cancellation and reschedule. The reschedule includes its ID, status, original and requested dates, reason, and staff note.
Booking statuses: PENDING, CONFIRMED, CANCELLED, COMPLETED.
Payment statuses: UNPAID, SUCCESS, FAILED.
Cancellation statuses: PENDING, APPROVED, DECLINED.
Refund statuses: NOT_REQUESTED, PENDING, SUCCESS, FAILED.

Pending reservations hold inventory for 2 minutes, then expire to CANCELLED if unpaid. Reject overlapping bookings for a room or pet. Failed payment can be retried before expiry. Repeated successful checkout/review must not charge/refund twice. Approved cancellation records a full mock refund for a paid booking and releases the room; declined requests keep it confirmed.

Customers can request a new check-in and/or check-out for an upcoming confirmed stay. Quotes use the booked nightly rate and customers must confirm the new total. The original room and dates remain reserved while a request is pending. Approval rechecks that same physical room, ignores the booking’s own occupied nights, then updates dates, total and any simulated adjustment in one transaction. The booking reference stays the same. A conflict leaves the booking and request unchanged. Declining either type of change request requires a reason.

Special-care instructions are optional plain text up to 2,000 characters. Staff updates accept a message of up to 2,000 characters, one JPEG, PNG, or WebP photo up to 2 MiB, or both. The feed returns `{updates, nextBefore}`. Pass `nextBefore` as the next request's `before` value. Each entry includes `id`, `kind` (`update` or `report`), `bookingId`, `petName`, `message`, `createdAt`, and `hasPhoto`. Daily reports also include `reportDate` and the first current `photoId`, which the client can load using the booking's care photo endpoint. Photo requests require the same customer bearer token as the feed. Photos are stored in PostgreSQL and served with caching disabled.

Daily care is separate from the informal update feed. Daily reports require a description and at least one photo on first publication. Events have Bangkok local `time`, `careType`, `action`, `observation` and `status` (`PERFORMED` or `NOT_PERFORMED`). When care was not performed, `reason` and `followUp` are required. Staff corrections retain prior values, the editor and the edit time. Customer history stays available after pickup.

## Database mapping and fixtures

The schema and demo data are implemented under `database/`; run the [database setup guide](../database/README.md). SQL uses snake_case; APIs keep the camelCase shapes above. Map `user_id` to user `id`, `full_name` to `name`, `care_notes` to `notes`, and booking `check_in_date`/`check_out_date`/`total_price` to `start`/`end`/`total`. Obtain a booking's `roomTypeId` by joining rooms. Never return password hashes.

The sample accounts use public demo password `PawInnDemo123!`, stored as bcrypt hashes. Account verifies the bcrypt password at sign-in. Booking hold expiry is derived from `created_at + 2 minutes`; cancel expired unpaid PENDING rows before they continue blocking availability. The Booking API expires holds as part of availability and booking requests.

## First integration example

A customer signs in, loads their pets, browses room types, asks booking for availability, creates a reservation, completes mock checkout and reads booking history. Then the customer requests cancellation and staff reviews it.

Only an isolated test deployment enables fixture accounts. In normal operation, create customer accounts through signup and staff accounts from the Admin portal.
