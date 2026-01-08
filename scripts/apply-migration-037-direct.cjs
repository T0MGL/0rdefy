#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function executeSQLStatements() {
  console.log('🔄 Applying Migration 037: Fix Referral Tracking\n');

  try {
    // 1. Add column
    console.log('1️⃣ Adding trial_started_at column...');
    const { error: alterError } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;`
    });

    if (alterError && !alterError.message.includes('already exists')) {
      console.error('❌ Failed to add column:', alterError.message);
      console.log('\n⚠️  Trying alternative method: Direct table query...\n');

      // Alternative: Use a dummy query to check if column exists
      const { error: checkError } = await supabase
        .from('referrals')
        .select('trial_started_at')
        .limit(1);

      if (checkError && checkError.message.includes('column')) {
        throw new Error('Column does not exist and cannot be created via API');
      }
    }
    console.log('   ✅ Column added/exists\n');

    // 2. Drop old trigger
    console.log('2️⃣ Dropping old trigger...');
    const { error: dropError } = await supabase.rpc('exec_sql', {
      sql: `DROP TRIGGER IF EXISTS trigger_update_referral_stats ON referrals;`
    });
    if (dropError) {
      console.error('   ⚠️ Warning:', dropError.message);
    } else {
      console.log('   ✅ Trigger dropped\n');
    }

    // 3. Create new function and trigger
    console.log('3️⃣ Creating new trigger function...');
    const functionSQL = `
CREATE OR REPLACE FUNCTION update_referral_stats()
RETURNS TRIGGER AS $BODY$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.trial_started_at IS NULL AND NEW.trial_started_at IS NOT NULL THEN
      UPDATE referral_codes
      SET total_signups = total_signups + 1
      WHERE code = NEW.referral_code;
    END IF;

    IF OLD.first_payment_at IS NULL AND NEW.first_payment_at IS NOT NULL THEN
      UPDATE referral_codes
      SET
        total_conversions = total_conversions + 1,
        total_credits_earned_cents = total_credits_earned_cents + NEW.referrer_credit_amount_cents
      WHERE code = NEW.referral_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_referral_stats
  AFTER INSERT OR UPDATE ON referrals
  FOR EACH ROW
  EXECUTE FUNCTION update_referral_stats();
`;

    const { error: functionError } = await supabase.rpc('exec_sql', { sql: functionSQL });
    if (functionError) {
      console.error('   ❌ Failed:', functionError.message);
      throw functionError;
    }
    console.log('   ✅ Function and trigger created\n');

    console.log('✅ Migration 037 applied successfully!\n');
    console.log('📋 Next: Run tests with: node scripts/test-referral-system.cjs\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.log('\n📋 MANUAL APPLICATION REQUIRED:\n');
    console.log('Copy this SQL to Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/sql/new\n');

    const migrationPath = path.join(__dirname, '../db/migrations/037_fix_referral_tracking.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log('---------------------------------------------------');
    console.log(sql);
    console.log('---------------------------------------------------\n');
    process.exit(1);
  }
}

executeSQLStatements();
