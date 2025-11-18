// ================================================================
// Create additional_values table using Supabase client
// ================================================================

import { supabase } from '../db/connection';

async function createTable() {
    console.log('================================================================');
    console.log('🔄 CREATING ADDITIONAL_VALUES TABLE');
    console.log('================================================================\n');

    try {
        // First, check if table exists
        const { data: existing, error: checkError } = await supabase
            .from('additional_values')
            .select('*')
            .limit(1);

        if (!checkError) {
            console.log('✅ Table additional_values already exists!');
            console.log('================================================================\n');
            return;
        }

        console.log('⚠️  Table does not exist. Attempting to create...');
        console.log('Note: This requires database admin access via SQL.\n');

        console.log('Please run this SQL manually in your Supabase SQL Editor:');
        console.log('================================================================');
        console.log(`
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

GRANT SELECT, INSERT, UPDATE, DELETE ON additional_values TO authenticated;
GRANT SELECT ON additional_values TO anon;
        `);
        console.log('================================================================\n');
        console.log('After running the SQL above, test the API endpoint:');
        console.log('curl http://localhost:3001/api/additional-values\n');

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

createTable().catch(console.error);
