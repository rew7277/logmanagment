-- ObserveX v36.2 auth DB hotfix
-- Safe to run multiple times. It keeps existing users and fixes older app_users schemas.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS app_users ADD COLUMN IF NOT EXISTS encrypted_profile TEXT;
ALTER TABLE IF EXISTS app_users ADD COLUMN IF NOT EXISTS password_salt TEXT;

UPDATE app_users
SET password_salt = COALESCE(NULLIF(password_salt, ''), split_part(password_hash, '$', 3), encode(gen_random_bytes(16), 'hex'))
WHERE password_salt IS NULL OR password_salt = '';

ALTER TABLE IF EXISTS app_users ALTER COLUMN password_salt SET DEFAULT encode(gen_random_bytes(16), 'hex');
ALTER TABLE IF EXISTS app_users ALTER COLUMN password_salt SET NOT NULL;
