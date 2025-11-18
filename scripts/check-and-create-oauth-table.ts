// ================================================================
// CHECK AND CREATE OAUTH STATES TABLE
// ================================================================
// Checks if shopify_oauth_states table exists and creates it if not
// ================================================================

import { supabaseAdmin } from '../api/db/connection';
import dotenv from 'dotenv';

dotenv.config();

async function checkAndCreateTable() {
    try {
        console.log('🔍 Checking if shopify_oauth_states table exists...');

        // Try to query the table
        const { data, error } = await supabaseAdmin
            .from('shopify_oauth_states')
            .select('id')
            .limit(1);

        if (error) {
            if (error.code === '42P01') {
                // Table doesn't exist (code 42P01 = undefined_table)
                console.log('❌ Table does not exist. Creating it now...');

                const createTableSQL = `
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
                `;

                console.log('📝 Creating table and indexes...');
                console.log('\nPlease run this SQL in your Supabase SQL Editor:');
                console.log('='.repeat(80));
                console.log(createTableSQL);
                console.log('='.repeat(80));
                console.log('\nOr visit: https://ecommerce-software-supabase.aqiebe.easypanel.host/sql-editor');

            } else {
                console.error('❌ Error checking table:', error);
                throw error;
            }
        } else {
            console.log('✅ Table shopify_oauth_states exists!');
            console.log(`   Found ${data?.length || 0} rows in sample query`);
        }

    } catch (error: any) {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    }
}

checkAndCreateTable();
