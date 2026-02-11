-- Migration: Add instructor to classes table
-- Date: 2026-02-11

-- Add instructor_id column to classes table
ALTER TABLE classes
ADD COLUMN instructor_id UUID;

-- Add foreign key constraint
ALTER TABLE classes
ADD CONSTRAINT fk_classes_instructor
FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL;

-- Create index for instructor lookups
CREATE INDEX idx_classes_instructor_id ON classes(instructor_id);

-- Comment for documentation
COMMENT ON COLUMN classes.instructor_id IS 'Reference to the employee (instructor) teaching this class';
