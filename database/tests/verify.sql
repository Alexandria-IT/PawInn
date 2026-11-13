-- Run against a freshly seeded demo/test database. All probe rows roll back.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN
      ('users','pets','room_types','rooms','bookings','cancellation_requests','booking_logs')) <> 7 THEN
    RAISE EXCEPTION 'Expected seven PawInn application tables';
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM users WHERE user_id BETWEEN 1001 AND 1003) <> 3
     OR (SELECT count(*) FROM pets WHERE pet_id BETWEEN 2001 AND 2004) <> 4
     OR (SELECT count(*) FROM room_types WHERE room_type_id BETWEEN 1 AND 3) <> 3
     OR (SELECT count(*) FROM rooms WHERE room_id IN (101,102,103,104,105,201,202,203,204,205,301,302,303,304,305)) <> 15
     OR (SELECT count(*) FROM bookings WHERE booking_id BETWEEN 3001 AND 3006) <> 6
     OR (SELECT count(*) FROM cancellation_requests WHERE cancellation_request_id BETWEEN 4001 AND 4003) <> 3
     OR (SELECT count(*) FROM booking_logs WHERE log_id BETWEEN 5001 AND 5018) <> 18 THEN
    RAISE EXCEPTION 'Expected complete demo users, pets, rooms, bookings, cancellations and logs';
  END IF;
  IF EXISTS (SELECT 1 FROM room_types t LEFT JOIN rooms r USING (room_type_id)
             WHERE t.room_type_id BETWEEN 1 AND 3 GROUP BY t.room_type_id HAVING count(r.room_id) <> 5) THEN
    RAISE EXCEPTION 'Expected five physical rooms per room type';
  END IF;
  IF (SELECT count(*) FROM users WHERE user_id BETWEEN 1001 AND 1003
      AND password_hash = crypt('PawInnDemo123!', password_hash)) <> 3 THEN
    RAISE EXCEPTION 'Demo bcrypt password hashes do not verify';
  END IF;
  IF (SELECT count(*) FROM bookings b JOIN users u USING (user_id)
      JOIN pets p ON p.pet_id = b.pet_id AND p.owner_id = b.user_id
      JOIN rooms r USING (room_id) JOIN room_types t USING (room_type_id)
      WHERE b.booking_id BETWEEN 3001 AND 3006 AND p.species = t.species
      AND b.total_price = b.nightly_rate * (b.check_out_date - b.check_in_date)) <> 6 THEN
    RAISE EXCEPTION 'Demo joins, ownership, compatible species or price snapshots are inconsistent';
  END IF;
  IF (SELECT count(DISTINCT status) FROM bookings WHERE booking_id BETWEEN 3001 AND 3006) <> 4
     OR (SELECT count(DISTINCT status) FROM cancellation_requests WHERE cancellation_request_id BETWEEN 4001 AND 4003) <> 3 THEN
    RAISE EXCEPTION 'Expected all booking and cancellation status examples';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO pets (pet_id, owner_id, name, species) VALUES (-1, -1, 'FK probe', 'Dog');
    RAISE EXCEPTION 'Missing owner FK protection';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO bookings (booking_id, user_id, pet_id, room_id, check_in_date, check_out_date, nightly_rate, total_price)
    VALUES (-1, 1002, 2001, 105, CURRENT_DATE + 100, CURRENT_DATE + 101, 650, 650);
    RAISE EXCEPTION 'A customer could reserve another customers pet';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO bookings (booking_id, user_id, pet_id, room_id, check_in_date, check_out_date, nightly_rate, total_price)
    VALUES (-1, 1001, 2001, -1, CURRENT_DATE + 100, CURRENT_DATE + 101, 650, 650);
    RAISE EXCEPTION 'Missing room FK protection';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    DELETE FROM pets WHERE pet_id = 2001;
    RAISE EXCEPTION 'Referenced pet deletion was allowed';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE bookings SET check_out_date = check_in_date WHERE booking_id = 3001;
    RAISE EXCEPTION 'Zero-night booking was allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE bookings SET total_price = 1 WHERE booking_id = 3001;
    RAISE EXCEPTION 'Incorrect booking total was allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE bookings SET refund_amount = total_price + 1 WHERE booking_id = 3004;
    RAISE EXCEPTION 'Refund above the paid total was allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Same room, different pet: an overlapping active reservation must fail.
  BEGIN
    INSERT INTO bookings (booking_id, user_id, pet_id, room_id, check_in_date, check_out_date, nightly_rate, total_price)
    SELECT -1, 1002, 2003, room_id, check_in_date, check_out_date, nightly_rate, total_price
    FROM bookings WHERE booking_id = 3001;
    RAISE EXCEPTION 'Overlapping room reservation was allowed';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;

  -- Same pet, different room: the pet cannot be in two rooms simultaneously.
  BEGIN
    INSERT INTO bookings (booking_id, user_id, pet_id, room_id, check_in_date, check_out_date, nightly_rate, total_price)
    SELECT -1, user_id, pet_id, 105, check_in_date, check_out_date, nightly_rate, total_price
    FROM bookings WHERE booking_id = 3001;
    RAISE EXCEPTION 'Overlapping pet reservation was allowed';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;

  -- Adjacent check-out/check-in is allowed, even for the same room and pet.
  INSERT INTO bookings (booking_id, user_id, pet_id, room_id, check_in_date, check_out_date, nightly_rate, total_price)
  SELECT -1, user_id, pet_id, room_id, check_out_date, check_out_date + 1, nightly_rate, nightly_rate
  FROM bookings WHERE booking_id = 3001;

  BEGIN
    INSERT INTO cancellation_requests (cancellation_request_id, booking_id, reason)
    VALUES (-1, 3001, 'Duplicate pending request probe');
    RAISE EXCEPTION 'Duplicate pending cancellation request was allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

ROLLBACK;

-- Historical stays for on-time pickup, missed arrival, and late pickup tests.
WITH hotel AS (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS day)
INSERT INTO bookings (booking_id, user_id, pet_id, room_id, check_in_date, check_out_date,
    nightly_rate, total_price, status, created_at, payment_status, payment_reference, paid_at, arrived_at)
SELECT fixture.booking_id, pets.owner_id, fixture.pet_id, fixture.room_id, day + fixture.start_offset, day + fixture.end_offset,
    fixture.rate, fixture.rate * (fixture.end_offset - fixture.start_offset), 'CONFIRMED',
    now() - interval '5 days', 'SUCCESS', 'TEST-CARE-' || fixture.booking_id, now() - interval '5 days',
    CASE WHEN fixture.attended THEN ((day - 3) + time '00:30') AT TIME ZONE 'Asia/Bangkok' END
FROM hotel CROSS JOIN (VALUES
    (3999, 2001, 101, -3, -1, 650, TRUE),
    (3998, 2002, 305, -3,  1, 750, FALSE),
    (3997, 2003, 205, -3, -1, 950, TRUE),
    (3996, 2004, 304,  0,  1, 750, FALSE)
) AS fixture(booking_id, pet_id, room_id, start_offset, end_offset, rate, attended)
JOIN pets ON pets.pet_id = fixture.pet_id;

INSERT INTO cancellation_requests (booking_id, reason)
VALUES (3998, 'Pending request on a missed stay');

-- An expired hold must not protect inventory, even before its status is swept.
UPDATE bookings SET created_at = now() - interval '3 minutes' WHERE booking_id = 3002;

\echo 'PASS: schema, mock data, bcrypt, joins, PK/FK ownership, prices, refunds, overlapping/adjacent stays and pending cancellation uniqueness.'
