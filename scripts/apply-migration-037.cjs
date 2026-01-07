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

async function main() {
  console.log('🔄 Migration 037: Fix Referral Tracking\n');

  const migrationPath = path.join(__dirname, '../db/migrations/037_fix_referral_tracking.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('📋 Copy this SQL to Supabase SQL Editor:\n');
  console.log('---------------------------------------------------');
  console.log(sql);
  console.log('---------------------------------------------------\n');

  // Show current stats
  const { data: codes } = await supabase
    .from('referral_codes')
    .select('code, total_signups, total_conversions, total_credits_earned_cents');

  if (codes && codes.length > 0) {
    console.log('📊 Current Stats:');
    codes.forEach(rc => {
      console.log(`   ${rc.code}: ${rc.total_signups} signups, ${rc.total_conversions} paid, $${(rc.total_credits_earned_cents/100).toFixed(2)} earned`);
    });
  }
}

main();
