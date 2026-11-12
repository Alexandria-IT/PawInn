-- Retire only the original seed's active reservations. Keep the rows and their audit history.
BEGIN;
-- Match the inventory lock used by Room and Booking during normal writes.
SELECT pg_advisory_xact_lock(42001);

WITH fixture_holds AS (
    SELECT b.booking_id, b.status
    FROM bookings b
    JOIN users u ON u.user_id = b.user_id
    WHERE b.status IN ('PENDING', 'CONFIRMED')
      AND (
        (u.email = 'jamie@pawinn.demo' AND b.booking_id IN (3001, 3002, 3005))
        OR (u.email = 'alex@pawinn.demo' AND b.booking_id = 3006)
      )
), retired AS (
    UPDATE bookings b
    SET status = 'CANCELLED'
    FROM fixture_holds f
    WHERE b.booking_id = f.booking_id
    RETURNING b.booking_id, f.status AS previous_status
)
INSERT INTO booking_logs (booking_id, action, details)
SELECT booking_id, 'FIXTURE_RETIRED', 'Original seed reservation retired. Previous status: ' || previous_status
FROM retired;

COMMIT;
