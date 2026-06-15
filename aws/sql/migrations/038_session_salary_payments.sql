-- ============================================================
-- Migration 038 – Session salary payments (paid-session tracking)
-- ============================================================
-- Links each taught session to the salary payment that covered it, so
-- session-based teachers can be paid mid-month for the sessions attended so
-- far and reappear later for newly-attended (still-unpaid) sessions.
--
-- ON DELETE CASCADE from expense_payments: voiding a salary payment frees its
-- sessions (they become unpaid again). Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS session_salary_payments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id)        ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id)        ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES sessions(id)         ON DELETE CASCADE,
    payment_id  UUID NOT NULL REFERENCES expense_payments(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_ssp_employee ON session_salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_ssp_payment  ON session_salary_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_ssp_session  ON session_salary_payments(session_id);
