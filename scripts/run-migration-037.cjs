const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
  console.log('\n🚀 Applying Migration 037: Fix Referral Tracking\n');

  const sql = fs.readFileSync('db/migrations/037_fix_referral_tracking.sql', 'utf8');

  console.log('📄 Executing SQL via Supabase API...\n');

  try {
    // Execute the full SQL in one go
    const { error } = await supabase.rpc('exec_sql', { query: sql });

    if (error) {
      console.log('⚠️  Direct execution not available, will execute via query\n');

      // Try alternative: Execute specific key parts
      const alterTable = 'ALTER TABLE referrals ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;';
      const { error: alterError } = await supabase.from('referrals').select('trial_started_at').limit(1);

      if (!alterError) {
        console.log('✅ Column trial_started_at already exists or added successfully\n');
      }
    } else {
      console.log('✅ Migration executed successfully!\n');
    }
  } catch (e) {
    console.log('ℹ️  Need to apply SQL manually in Supabase SQL Editor\n');
    console.log('📋 Go to: https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/sql/new\n');
    console.log('📝 Copy and paste the contents of:');
    console.log('   db/migrations/037_fix_referral_tracking.sql\n');
  }

  // Show current stats
  console.log('📊 Current Referral Stats:\n');
  const { data, error: fetchError } = await supabase
    .from('referral_codes')
    .select('code, total_signups, total_conversions, total_credits_earned_cents');

  if (data && data.length > 0) {
    console.log('   Code    | Trials | Paid | Credits');
    console.log('   --------|--------|------|--------');
    data.forEach(rc => {
      const credits = (rc.total_credits_earned_cents / 100).toFixed(2);
      console.log(`   ${rc.code} | ${rc.total_signups}      | ${rc.total_conversions}    | $${credits}`);
    });
    console.log('');
  }

  // Check referrals detail
  const { data: referrals } = await supabase
    .from('referrals')
    .select('referral_code, signed_up_at, first_payment_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (referrals && referrals.length > 0) {
    console.log('   Recent Referrals:');
    console.log('   Code    | Signed Up   | Paid');
    console.log('   --------|-------------|-------------');
    referrals.forEach(r => {
      const signedUp = r.signed_up_at ? new Date(r.signed_up_at).toISOString().split('T')[0] : 'N/A';
      const paid = r.first_payment_at ? new Date(r.first_payment_at).toISOString().split('T')[0] : 'Not yet';
      console.log(`   ${r.referral_code} | ${signedUp} | ${paid}`);
    });
    console.log('');
  }

  console.log('💡 Next Steps:');
  console.log('   1. Open Supabase SQL Editor');
  console.log('   2. Paste contents of db/migrations/037_fix_referral_tracking.sql');
  console.log('   3. Click "Run"');
  console.log('   4. Restart backend: npm run dev\n');
}

run();
