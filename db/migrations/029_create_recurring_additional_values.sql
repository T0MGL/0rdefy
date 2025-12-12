-- ================================================================
-- MIGRATION: Create recurring_additional_values table
-- ================================================================
-- Track recurring expenses and income templates
-- ================================================================

CREATE TABLE IF NOT EXISTS recurring_additional_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- marketing, sales, employees, operational
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(20) NOT NULL, -- expense, income
    frequency VARCHAR(20) NOT NULL, -- monthly, annually
    start_date DATE NOT NULL,
    end_date DATE, -- nullable, if null runs indefinitely
    last_processed_date DATE, -- tracks the last time an actual value was generated
    is_ordefy_subscription BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_recurring_values_store ON recurring_additional_values(store_id);
CREATE INDEX idx_recurring_values_active ON recurring_additional_values(store_id, is_active);

COMMENT ON TABLE recurring_additional_values IS 'Templates for recurring expenses and income';
