-- Load account and room seeds first. Dates are relative to first insertion.
-- Rerunning preserves existing bookings/statuses/dates; it is not a demo reset.
BEGIN;

INSERT INTO bookings (
    booking_id, user_id, pet_id, room_id, check_in_date, check_out_date,
    nightly_rate, total_price, status, created_at, payment_status, payment_reference,
    paid_at, refund_status, refund_amount, refund_reference, refunded_at
) VALUES
    (3001, 1001, 2001, 101, CURRENT_DATE + 7, CURRENT_DATE + 10,
     650, 1950, 'CONFIRMED', CURRENT_TIMESTAMP - INTERVAL '2 days', 'SUCCESS', 'MOCK-PAY-3001',
     CURRENT_TIMESTAMP - INTERVAL '2 days' + INTERVAL '1 minute', 'NOT_REQUESTED', NULL, NULL, NULL),
    (3002, 1001, 2002, 301, CURRENT_DATE + 1, CURRENT_DATE + 3,
     750, 1500, 'PENDING', CURRENT_TIMESTAMP, 'UNPAID', NULL,
     NULL, 'NOT_REQUESTED', NULL, NULL, NULL),
    (3003, 1002, 2003, 201, CURRENT_DATE - 10, CURRENT_DATE - 7,
     950, 2850, 'COMPLETED', CURRENT_TIMESTAMP - INTERVAL '12 days', 'SUCCESS', 'MOCK-PAY-3003',
     CURRENT_TIMESTAMP - INTERVAL '12 days' + INTERVAL '1 minute', 'NOT_REQUESTED', NULL, NULL, NULL),
    (3004, 1002, 2004, 302, CURRENT_DATE + 4, CURRENT_DATE + 6,
     750, 1500, 'CANCELLED', CURRENT_TIMESTAMP - INTERVAL '1 day', 'SUCCESS', 'MOCK-PAY-3004',
     CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '1 minute', 'SUCCESS', 1500, 'MOCK-REFUND-3004', CURRENT_TIMESTAMP - INTERVAL '6 hours'),
    (3005, 1001, 2001, 102, CURRENT_DATE + 20, CURRENT_DATE + 22,
     650, 1300, 'PENDING', CURRENT_TIMESTAMP, 'FAILED', NULL,
     NULL, 'NOT_REQUESTED', NULL, NULL, NULL),
    (3006, 1002, 2003, 202, CURRENT_DATE + 14, CURRENT_DATE + 17,
     950, 2850, 'CONFIRMED', CURRENT_TIMESTAMP - INTERVAL '1 day', 'SUCCESS', 'MOCK-PAY-3006',
     CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '1 minute', 'NOT_REQUESTED', NULL, NULL, NULL)
ON CONFLICT (booking_id) DO NOTHING;

INSERT INTO cancellation_requests (
    cancellation_request_id, booking_id, reason, status, requested_at,
    reviewed_by, reviewed_at, review_notes
) VALUES
    (4001, 3001, 'Our travel plans changed.', 'PENDING', CURRENT_TIMESTAMP - INTERVAL '1 hour', NULL, NULL, NULL),
    (4002, 3004, 'We no longer need boarding.', 'APPROVED', CURRENT_TIMESTAMP - INTERVAL '8 hours',
     1003, CURRENT_TIMESTAMP - INTERVAL '6 hours', 'Approved with a full mock refund.'),
    (4003, 3006, 'Requesting a cancellation for review.', 'DECLINED', CURRENT_TIMESTAMP - INTERVAL '6 hours',
     1003, CURRENT_TIMESTAMP - INTERVAL '4 hours', 'Demo decline example; the reservation remains confirmed.')
ON CONFLICT (cancellation_request_id) DO NOTHING;

INSERT INTO booking_logs (log_id, booking_id, actor_user_id, action, details, created_at) VALUES
    (5001, 3001, 1001, 'BOOKING_CREATED', 'Reserved Cozy Den C101 for Mochi.', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    (5002, 3001, 1001, 'PAYMENT_SUCCEEDED', 'Mock payment of THB 1950.', CURRENT_TIMESTAMP - INTERVAL '2 days' + INTERVAL '1 minute'),
    (5003, 3001, 1001, 'CANCELLATION_REQUESTED', 'Awaiting staff review.', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
    (5004, 3002, 1001, 'BOOKING_CREATED', 'Unpaid 2-minute hold for Miso.', CURRENT_TIMESTAMP),
    (5005, 3003, 1002, 'BOOKING_CREATED', 'Reserved Garden Suite G101 for Buddy.', CURRENT_TIMESTAMP - INTERVAL '12 days'),
    (5006, 3003, 1002, 'PAYMENT_SUCCEEDED', 'Mock payment of THB 2850.', CURRENT_TIMESTAMP - INTERVAL '12 days' + INTERVAL '1 minute'),
    (5007, 3003, 1003, 'STAY_COMPLETED', 'Buddy checked out.', CURRENT_TIMESTAMP - INTERVAL '7 days'),
    (5008, 3004, 1002, 'BOOKING_CREATED', 'Reserved Cat Loft L102 for Luna.', CURRENT_TIMESTAMP - INTERVAL '1 day'),
    (5009, 3004, 1002, 'PAYMENT_SUCCEEDED', 'Mock payment of THB 1500.', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '1 minute'),
    (5010, 3004, 1002, 'CANCELLATION_REQUESTED', 'Customer no longer needs boarding.', CURRENT_TIMESTAMP - INTERVAL '8 hours'),
    (5011, 3004, 1003, 'CANCELLATION_APPROVED', 'Staff approved cancellation.', CURRENT_TIMESTAMP - INTERVAL '6 hours'),
    (5012, 3004, 1003, 'REFUND_SUCCEEDED', 'Full mock refund of THB 1500.', CURRENT_TIMESTAMP - INTERVAL '6 hours'),
    (5013, 3005, 1001, 'BOOKING_CREATED', 'Reserved Cozy Den C102 for Mochi.', CURRENT_TIMESTAMP),
    (5014, 3005, 1001, 'PAYMENT_FAILED', 'Mock decline; retry before hold expiry.', CURRENT_TIMESTAMP),
    (5015, 3006, 1002, 'BOOKING_CREATED', 'Reserved Garden Suite G102 for Buddy.', CURRENT_TIMESTAMP - INTERVAL '1 day'),
    (5016, 3006, 1002, 'PAYMENT_SUCCEEDED', 'Mock payment of THB 2850.', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '1 minute'),
    (5017, 3006, 1002, 'CANCELLATION_REQUESTED', 'Customer submitted a request.', CURRENT_TIMESTAMP - INTERVAL '6 hours'),
    (5018, 3006, 1003, 'CANCELLATION_DECLINED', 'Booking remains confirmed.', CURRENT_TIMESTAMP - INTERVAL '4 hours')
ON CONFLICT (log_id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('bookings', 'booking_id'),
    GREATEST((SELECT last_value FROM bookings_booking_id_seq), (SELECT max(booking_id) FROM bookings)), true);
SELECT setval(pg_get_serial_sequence('cancellation_requests', 'cancellation_request_id'),
    GREATEST((SELECT last_value FROM cancellation_requests_cancellation_request_id_seq), (SELECT max(cancellation_request_id) FROM cancellation_requests)), true);
SELECT setval(pg_get_serial_sequence('booking_logs', 'log_id'),
    GREATEST((SELECT last_value FROM booking_logs_log_id_seq), (SELECT max(log_id) FROM booking_logs)), true);
COMMIT;
