-- Room and Booking both need these fields when starting against an older volume.
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ
        CHECK (picked_up_at IS NULL OR (arrived_at IS NOT NULL AND picked_up_at >= arrived_at)),
    ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS late_pickup_fee NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (late_pickup_fee >= 0);
