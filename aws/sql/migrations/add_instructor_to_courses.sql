-- Migration: Add instructor to courses table
-- Date: 2026-02-11

-- Add instructor_id column to courses table
ALTER TABLE courses
ADD COLUMN instructor_id UUID,
ADD CONSTRAINT fk_courses_instructor
FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL;

-- Create index for instructor lookups
CREATE INDEX idx_courses_instructor_id ON courses(instructor_id);

-- Comment for documentation
COMMENT ON COLUMN courses.instructor_id IS 'Reference to the employee (instructor) teaching this course';
