-- Fix user passwords with correct bcrypt hash for 'password123'
-- Run this after populating the database

UPDATE users
SET password = '$2b$10$Z5bBDYeQjDZcxcqYQHwABO0lQwHDO6sjXic1LT.n4bt6sndWsArhO'
WHERE password = '$2b$10$rKYKXqH9E3WlPvJxJXZG4.pZ8bH7xK3yq0XYZ5FGhQZ5rK1YKXqH9';

-- Verify the update
SELECT email, first_name, last_name, role FROM users;
