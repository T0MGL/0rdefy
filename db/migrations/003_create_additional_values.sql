-- ================================================================
-- MIGRATION: Create additional_values table
-- ================================================================
-- Track additional expenses and income beyond product sales
-- ================================================================

CREATE TABLE IF NOT EXISTS additional_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(20) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_additional_values_store ON additional_values(store_id);
CREATE INDEX idx_additional_values_date ON additional_values(store_id, date DESC);
CREATE INDEX idx_additional_values_type ON additional_values(store_id, type);
CREATE INDEX idx_additional_values_category ON additional_values(store_id, category);

COMMENT ON TABLE additional_values IS 'NeonFlow: Track additional expenses and income';
COMMENT ON COLUMN additional_values.category IS 'marketing, sales, employees, operational';
COMMENT ON COLUMN additional_values.type IS 'expense or income';
COMMENT ON COLUMN additional_values.amount IS 'Amount in store currency';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON additional_values TO authenticated;
GRANT SELECT ON additional_values TO anon;
