\set ON_ERROR_STOP on
BEGIN;

-- Existing temporary administrator credentials, documented as admin/admin123.
-- Replace before exposing the appliance. UI passwords are bcrypt hashes;
-- SIP auth secrets and voicemail PINs use Asterisk's separate formats.
INSERT INTO users (username, email, password_hash, role)
VALUES (
    'admin', 'admin@appliance.local',
    '$2b$12$LVMdZtyGcbOqfcWQ21U80Ot4wKeCod7iiLG9/7JObI6X36ZTT61JW',
    'admin'
)
ON CONFLICT (username) DO NOTHING;

COMMIT;
