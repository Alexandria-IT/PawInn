-- Upgrade Account on an existing volume before accepting requests.
ALTER TABLE pets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'users'::regclass AND attname = 'account_status' AND NOT attisdropped
    ) THEN
        ALTER TABLE users ADD COLUMN account_status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'users'::regclass AND attname = 'session_version' AND NOT attisdropped
    ) THEN
        ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND conname = 'users_account_status_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_account_status_check
            CHECK (account_status IN ('ACTIVE', 'SUSPENDED'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND conname = 'users_supported_role_check'
    ) THEN
        -- Preserve legacy rows and their references while restricting new writes.
        ALTER TABLE users ADD CONSTRAINT users_supported_role_check
            CHECK (role IN ('CUSTOMER', 'STAFF')) NOT VALID;
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_role_check;
    END IF;
END;
$migration$;
