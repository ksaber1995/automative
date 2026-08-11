-- =============================================================================
-- 091 — Approved splits of a bundle's income
--
-- A master course's money reaches no teacher on its own: the salary accrual
-- follows money -> enrolment -> class -> instructor, and a bundle payment has
-- none of those. The bundle income report shows what a split WOULD be; this is
-- where a decision about it lives once somebody makes one.
--
-- A row is MONEY attributed to a teacher for one course of one bundle in one
-- month — not earnings. The teacher's own rate is applied afterwards, exactly as
-- it is to ordinary course money, so a later rate change corrects history the
-- same way and a payslip can say "collected 500, your share 300, at 90% = 270".
-- =============================================================================

CREATE TABLE IF NOT EXISTS master_revenue_allocations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id        UUID NOT NULL REFERENCES companies(id)      ON DELETE CASCADE,
    master_course_id  UUID NOT NULL REFERENCES master_courses(id) ON DELETE CASCADE,
    billing_year      INTEGER NOT NULL,
    billing_month     INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
    employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    course_id         UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
    amount            DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
    -- What the policy proposed, kept beside what was approved: six months on,
    -- "did we follow the rule or did somebody override it" is answerable.
    suggested_amount  DECIMAL(12, 2),
    -- A: everyone shares the discount in proportion. C: teachers fund it and the
    -- academy keeps its list margin. B and D are not offered — the academy earns.
    policy            VARCHAR(1) NOT NULL DEFAULT 'A' CHECK (policy IN ('A', 'C')),
    approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- One decision per teacher per course per bundle per month. Approving the
    -- same month twice replaces it rather than paying it again.
    UNIQUE (master_course_id, billing_year, billing_month, employee_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_mra_company_month ON master_revenue_allocations(company_id, billing_year, billing_month);
CREATE INDEX IF NOT EXISTS idx_mra_employee     ON master_revenue_allocations(employee_id);
CREATE INDEX IF NOT EXISTS idx_mra_master       ON master_revenue_allocations(master_course_id);
CREATE INDEX IF NOT EXISTS idx_mra_course       ON master_revenue_allocations(course_id);
