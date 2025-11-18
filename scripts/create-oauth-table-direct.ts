// ================================================================
// CREATE OAUTH STATES TABLE - DIRECT EXECUTION
// ================================================================
// Creates the shopify_oauth_states table using direct SQL query
// ================================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function createTable() {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        }

        console.log('🔗 Connecting to Supabase...');
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        console.log('📝 Creating shopify_oauth_states table...');

        // Create the table using raw SQL query
        const { data, error } = await supabase.rpc('exec', {
            sql: `
                CREATE TABLE IF NOT EXISTS shopify_oauth_states (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    state VARCHAR(255) UNIQUE NOT NULL,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    shop VARCHAR(255) NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON shopify_oauth_states(state);
                CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON shopify_oauth_states(user_id);
                CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON shopify_oauth_states(expires_at);
            `
        });

        if (error) {
            console.error('❌ Error creating table:', error);
            console.log('\n📋 Please run the SQL manually in Supabase SQL Editor:');
            console.log('https://ecommerce-software-supabase.aqiebe.easypanel.host/project/_/sql');
            console.log('\nSQL to execute:');
            console.log('='.repeat(80));
            console.log(readFileSync(join(__dirname, '..', 'db', 'migrations', '006_shopify_oauth.sql'), 'utf-8'));
            console.log('='.repeat(80));
            process.exit(1);
        }

        console.log('✅ Table created successfully!');

        // Verify table exists
        const { data: verifyData, error: verifyError } = await supabase
            .from('shopify_oauth_states')
            .select('count')
            .limit(1);

        if (!verifyError) {
            console.log('✅ Table verified successfully!');
        }

    } catch (error: any) {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    }
}

createTable();
