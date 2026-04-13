-- Migration 010: Add email verification to users table
-- Adds email_verified flag, OTP storage, and marks existing users as verified

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_otp VARCHAR(6),
  ADD COLUMN IF NOT EXISTS email_otp_expires_at TIMESTAMPTZ;

-- All existing active users are considered verified (retroactive)
UPDATE users SET email_verified = TRUE WHERE is_active = TRUE;

-- Index for fast OTP lookup during verification
CREATE INDEX IF NOT EXISTS idx_users_email_otp ON users(email, email_otp) WHERE email_otp IS NOT NULL;
