-- Deliver a small invalidation only after the associated write commits.
CREATE OR REPLACE FUNCTION pawinn_notify_booking_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner_id integer;
    fixture boolean;
    area text;
BEGIN
    SELECT b.user_id, lower(u.email) LIKE '%@pawinn.demo'
    INTO owner_id, fixture
    FROM bookings b JOIN users u ON u.user_id = b.user_id
    WHERE b.booking_id = NEW.booking_id;

    IF TG_TABLE_NAME = 'booking_logs' THEN
        area := CASE WHEN NEW.action = 'PET_UPDATE_SENT' THEN 'update' ELSE 'booking' END;
    ELSIF TG_TABLE_NAME = 'booking_care_reports' THEN
        area := 'report';
    ELSE
        area := 'care';
    END IF;

    PERFORM pg_notify('pawinn_booking_change', json_build_object(
        'bookingId', NEW.booking_id::text,
        'ownerId', owner_id,
        'fixture', fixture,
        'area', area
    )::text);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER pawinn_booking_log_change AFTER INSERT
ON booking_logs FOR EACH ROW EXECUTE FUNCTION pawinn_notify_booking_change();

CREATE OR REPLACE TRIGGER pawinn_care_report_change AFTER INSERT OR UPDATE
ON booking_care_reports FOR EACH ROW EXECUTE FUNCTION pawinn_notify_booking_change();

CREATE OR REPLACE TRIGGER pawinn_care_event_change AFTER INSERT OR UPDATE
ON booking_care_events FOR EACH ROW EXECUTE FUNCTION pawinn_notify_booking_change();
