-- Planned closures leave the permanent active flag and existing bookings intact.
CREATE TABLE IF NOT EXISTS room_closures (
    closure_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(room_id),
    starts_on DATE NOT NULL,
    reopens_on DATE NOT NULL,
    CHECK (reopens_on > starts_on)
);
CREATE INDEX IF NOT EXISTS room_closures_room_dates
    ON room_closures (room_id, starts_on, reopens_on);
