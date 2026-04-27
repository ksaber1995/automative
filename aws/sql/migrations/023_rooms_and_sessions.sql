-- Migration 023: Rooms and Sessions
-- Creates rooms table, sessions table, and adds default_room_id to courses

-- =============================================
-- ROOMS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_rooms_company_id ON rooms(company_id);
CREATE INDEX IF NOT EXISTS idx_rooms_branch_id ON rooms(branch_id);
CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms(is_active);

CREATE TRIGGER update_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- ADD default_room_id TO COURSES
-- =============================================
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS default_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_default_room_id ON courses(default_room_id);

-- =============================================
-- SESSIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_company_id ON sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_sessions_branch_id ON sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_class_id ON sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_date ON sessions(start_date);
CREATE INDEX IF NOT EXISTS idx_sessions_end_date ON sessions(end_date);

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
