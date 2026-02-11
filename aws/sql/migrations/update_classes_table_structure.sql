-- Migration: Update classes table structure to match schema
-- Date: 2026-02-11
-- This adds missing columns to support the full class scheduling system

-- Add missing columns
ALTER TABLE classes
ADD COLUMN IF NOT EXISTS name VARCHAR(255),
ADD COLUMN IF NOT EXISTS code VARCHAR(50),
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE,
ADD COLUMN IF NOT EXISTS start_time TIME,
ADD COLUMN IF NOT EXISTS end_time TIME,
ADD COLUMN IF NOT EXISTS days_of_week VARCHAR(50),
ADD COLUMN IF NOT EXISTS current_enrollment INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Set name and code as NOT NULL after adding them (with default values for existing rows)
UPDATE classes SET name = 'Class ' || SUBSTRING(id::text FROM 1 FOR 8) WHERE name IS NULL;
UPDATE classes SET code = 'CLS-' || SUBSTRING(id::text FROM 1 FOR 6) WHERE code IS NULL;

ALTER TABLE classes
ALTER COLUMN name SET NOT NULL,
ALTER COLUMN code SET NOT NULL;

-- Add unique constraint on code
ALTER TABLE classes
ADD CONSTRAINT unique_class_code UNIQUE (code);

-- Comments
COMMENT ON COLUMN classes.name IS 'Name of the class/session';
COMMENT ON COLUMN classes.code IS 'Unique code for the class (e.g., ROB-101-A)';
COMMENT ON COLUMN classes.start_date IS 'Start date of the class';
COMMENT ON COLUMN classes.end_date IS 'End date of the class';
COMMENT ON COLUMN classes.start_time IS 'Daily start time';
COMMENT ON COLUMN classes.end_time IS 'Daily end time';
COMMENT ON COLUMN classes.days_of_week IS 'Comma-separated days (e.g., MONDAY,WEDNESDAY)';
COMMENT ON COLUMN classes.current_enrollment IS 'Number of currently enrolled students';
COMMENT ON COLUMN classes.notes IS 'Additional notes for the class';
