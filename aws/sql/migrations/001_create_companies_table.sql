-- Migration 001: Create Companies Table
-- Description: Adds companies as the top-level tenant entity for multi-tenant SaaS

-- Create companies table
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,

    -- Contact information
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Egypt',

    -- Business information
    tax_id VARCHAR(100),
    registration_number VARCHAR(100),
    industry VARCHAR(100),

    -- Subscription & billing (SaaS features)
    subscription_tier VARCHAR(50) DEFAULT 'BASIC' CHECK (subscription_tier IN ('BASIC', 'PROFESSIONAL', 'ENTERPRISE')),
    subscription_status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (subscription_status IN ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED')),
    subscription_start_date DATE DEFAULT CURRENT_DATE,
    subscription_end_date DATE,
    max_branches INTEGER DEFAULT 1,
    max_users INTEGER DEFAULT 5,

    -- Settings
    timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    currency VARCHAR(10) DEFAULT 'EGP',
    locale VARCHAR(10) DEFAULT 'en-US',

    -- Status
    is_active BOOLEAN DEFAULT true,
    onboarding_completed BOOLEAN DEFAULT false,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID, -- First user who registered the company

    CONSTRAINT companies_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- Indexes for performance
CREATE INDEX idx_companies_code ON companies(code);
CREATE INDEX idx_companies_email ON companies(email);
CREATE INDEX idx_companies_subscription_status ON companies(subscription_status);
CREATE INDEX idx_companies_created_at ON companies(created_at);

-- Trigger for updated_at
CREATE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE companies IS 'Top-level tenant table for multi-tenant SaaS architecture';
COMMENT ON COLUMN companies.code IS 'Unique company identifier code for easy reference';
COMMENT ON COLUMN companies.subscription_tier IS 'Pricing tier: BASIC, PROFESSIONAL, ENTERPRISE';
COMMENT ON COLUMN companies.subscription_status IS 'Subscription status: TRIAL, ACTIVE, SUSPENDED, CANCELLED';
COMMENT ON COLUMN companies.max_branches IS 'Maximum allowed branches based on subscription tier';
COMMENT ON COLUMN companies.max_users IS 'Maximum allowed users based on subscription tier';
