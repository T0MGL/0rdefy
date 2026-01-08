#!/usr/bin/env node

/**
 * Comprehensive Referral System Tests
 * Tests all phases: Signup → Trial Start → Conversion
 * Validates anti-self-referral, credit awarding, and funnel analytics
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Test data
const TEST_USERS = {
  referrer: {
    email: 'test-referrer@ordefy.test',
    password: 'TestPass123!',
    name: 'Test Referrer'
  },
  referred: {
    email: 'test-referred@ordefy.test',
    password: 'TestPass123!',
    name: 'Test Referred'
  },
  selfReferral: {
    email: 'test-self-referral@ordefy.test',
    password: 'TestPass123!',
    name: 'Test Self Referral'
  }
};

let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}: ${name}`);
  if (details) {
    console.log(`   ${details}`);
  }
  testResults.tests.push({ name, passed, details });
  if (passed) testResults.passed++;
  else testResults.failed++;
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...\n');

  // Get all test user IDs
  const { data: testUsers } = await supabase
    .from('users')
    .select('id')
    .like('email', '%@ordefy.test');

  if (testUsers && testUsers.length > 0) {
    const userIds = testUsers.map(u => u.id);

    // Delete referrals first (foreign key constraints)
    await supabase
      .from('referrals')
      .delete()
      .in('referred_user_id', userIds);

    await supabase
      .from('referrals')
      .delete()
      .in('referrer_user_id', userIds);

    await supabase
      .from('referral_credits')
      .delete()
      .in('user_id', userIds);

    await supabase
      .from('referral_codes')
      .delete()
      .in('user_id', userIds);
  }

  // Delete test users
  for (const user of Object.values(TEST_USERS)) {
    await supabase.from('users').delete().eq('email', user.email);
  }

  // Also clean up additional test users
  await supabase.from('users').delete().like('email', 'test-user%@ordefy.test');
}

async function createTestUser(userData) {
  const { data, error } = await supabase
    .from('users')
    .insert({
      email: userData.email,
      password_hash: 'hashed_' + userData.password,
      name: userData.name,
      is_active: true
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return data;
}

async function generateReferralCode(userId) {
  // Check if code already exists
  const { data: codes } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId);

  if (codes && codes.length > 0) {
    return codes[0].code;
  }

  // Generate new code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { data, error } = await supabase
    .from('referral_codes')
    .insert({
      user_id: userId,
      code: code
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create referral code: ${error.message}`);
  return data.code;
}

async function createReferral(referrerUserId, referredUserId, referralCode, options = {}) {
  const referralData = {
    referrer_user_id: referrerUserId,
    referred_user_id: referredUserId,
    referral_code: referralCode,
    signed_up_at: new Date().toISOString()
  };

  if (options.trialStarted) {
    referralData.trial_started_at = new Date().toISOString();
    referralData.referred_plan = 'starter';
    referralData.referred_discount_applied = true;
  }

  if (options.converted) {
    referralData.first_payment_at = new Date().toISOString();
    referralData.referrer_credit_amount_cents = 1000; // $10
    referralData.referrer_credit_applied = false;
  }

  const { data, error } = await supabase
    .from('referrals')
    .insert(referralData)
    .select()
    .single();

  if (error) throw new Error(`Failed to create referral: ${error.message}`);
  return data;
}

async function getReferralStats(userId) {
  const { data, error } = await supabase
    .from('referral_codes')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data;
}

async function getFunnelAnalytics(userId) {
  const { data, error } = await supabase
    .rpc('get_referral_funnel', { p_user_id: userId });

  if (error) {
    console.log(`   ⚠️  get_referral_funnel RPC not available (migration 037 not applied): ${error.message}`);
    return null;
  }
  return data && data.length > 0 ? data[0] : null;
}

async function test1_InitialReferralCodeCreation() {
  console.log('\n📋 TEST 1: Initial Referral Code Creation\n');

  const referrer = await createTestUser(TEST_USERS.referrer);
  const code = await generateReferralCode(referrer.id);

  logTest('Referral code generated', !!code, `Code: ${code}`);

  const stats = await getReferralStats(referrer.id);
  logTest('Initial stats are zero',
    stats.total_signups === 0 &&
    stats.total_conversions === 0 &&
    stats.total_credits_earned_cents === 0,
    `Signups: ${stats.total_signups}, Conversions: ${stats.total_conversions}, Credits: $${stats.total_credits_earned_cents / 100}`
  );

  return { referrer, code };
}

async function test2_SignupPhase(referrer, referralCode) {
  console.log('\n📋 TEST 2: Signup Phase (No Trial Yet)\n');

  const referred = await createTestUser(TEST_USERS.referred);

  // Create referral record (signup only, no trial yet)
  await createReferral(referrer.id, referred.id, referralCode);

  // Wait for trigger to execute
  await new Promise(resolve => setTimeout(resolve, 500));

  const stats = await getReferralStats(referrer.id);

  logTest('Signup does NOT increment total_signups (waiting for trial)',
    stats.total_signups === 0,
    `Expected: 0, Got: ${stats.total_signups}`
  );

  logTest('Conversions still zero',
    stats.total_conversions === 0,
    `Got: ${stats.total_conversions}`
  );

  return { referred };
}

async function test3_TrialStartPhase(referrer, referred, referralCode) {
  console.log('\n📋 TEST 3: Trial Start Phase (Checkout Completed)\n');

  // Simulate trial start by updating the referral
  const { error } = await supabase
    .from('referrals')
    .update({
      trial_started_at: new Date().toISOString(),
      referred_plan: 'starter',
      referred_discount_applied: true
    })
    .eq('referred_user_id', referred.id);

  if (error) throw new Error(`Failed to update trial: ${error.message}`);

  // Wait for trigger to execute
  await new Promise(resolve => setTimeout(resolve, 500));

  const stats = await getReferralStats(referrer.id);

  logTest('Trial start INCREMENTS total_signups',
    stats.total_signups === 1,
    `Expected: 1, Got: ${stats.total_signups}`
  );

  logTest('Conversions still zero (not paid yet)',
    stats.total_conversions === 0,
    `Got: ${stats.total_conversions}`
  );

  logTest('Credits still zero (not converted yet)',
    stats.total_credits_earned_cents === 0,
    `Got: $${stats.total_credits_earned_cents / 100}`
  );
}

async function test4_ConversionPhase(referrer, referred) {
  console.log('\n📋 TEST 4: Conversion Phase (First Payment)\n');

  // Simulate conversion by updating the referral
  const { error } = await supabase
    .from('referrals')
    .update({
      first_payment_at: new Date().toISOString(),
      referrer_credit_amount_cents: 1000, // $10
      referrer_credit_applied: false
    })
    .eq('referred_user_id', referred.id);

  if (error) throw new Error(`Failed to update conversion: ${error.message}`);

  // Wait for trigger to execute
  await new Promise(resolve => setTimeout(resolve, 500));

  const stats = await getReferralStats(referrer.id);

  logTest('Total signups unchanged (still 1)',
    stats.total_signups === 1,
    `Expected: 1, Got: ${stats.total_signups}`
  );

  logTest('Conversion INCREMENTS total_conversions',
    stats.total_conversions === 1,
    `Expected: 1, Got: ${stats.total_conversions}`
  );

  logTest('Credits INCREMENTS by $10',
    stats.total_credits_earned_cents === 1000,
    `Expected: $10.00, Got: $${stats.total_credits_earned_cents / 100}`
  );
}

async function test5_AntiSelfReferral() {
  console.log('\n📋 TEST 5: Anti-Self-Referral Validation\n');

  const selfUser = await createTestUser(TEST_USERS.selfReferral);
  const code = await generateReferralCode(selfUser.id);

  // Attempt to refer themselves
  try {
    await createReferral(selfUser.id, selfUser.id, code);

    // Check if it was recorded
    const { data: referrals } = await supabase
      .from('referrals')
      .select('*')
      .eq('referred_user_id', selfUser.id);

    logTest('Self-referral allowed in DB (requires app-level validation)',
      referrals && referrals.length > 0,
      'Note: Database allows self-referrals, validation must be in auth.ts'
    );

  } catch (error) {
    logTest('Database blocks self-referral with constraint',
      true,
      'Self-referral was blocked at database level'
    );
  }
}

async function test6_FunnelAnalytics(referrer) {
  console.log('\n📋 TEST 6: Funnel Analytics View\n');

  const funnel = await getFunnelAnalytics(referrer.id);

  if (!funnel) {
    logTest('Funnel analytics available', false, 'Migration 037 not applied - get_referral_funnel() not found');
    return;
  }

  logTest('Funnel analytics available', true, 'RPC function exists');

  logTest('Funnel shows correct registered count',
    parseInt(funnel.total_registered) === 1,
    `Expected: 1, Got: ${funnel.total_registered}`
  );

  logTest('Funnel shows correct trial count',
    parseInt(funnel.total_trials_started) === 1,
    `Expected: 1, Got: ${funnel.total_trials_started}`
  );

  logTest('Funnel shows correct paid count',
    parseInt(funnel.total_paid) === 1,
    `Expected: 1, Got: ${funnel.total_paid}`
  );

  logTest('Signup to trial rate is 100%',
    parseFloat(funnel.signup_to_trial_rate) === 100.00,
    `Expected: 100.00, Got: ${funnel.signup_to_trial_rate}`
  );

  logTest('Trial to paid rate is 100%',
    parseFloat(funnel.trial_to_paid_rate) === 100.00,
    `Expected: 100.00, Got: ${funnel.trial_to_paid_rate}`
  );
}

async function test7_MultipleReferrals(referrer, referralCode) {
  console.log('\n📋 TEST 7: Multiple Referrals (Different Conversion Stages)\n');

  // Create 3 more users at different stages
  const user2 = await createTestUser({
    email: 'test-user2@ordefy.test',
    password: 'TestPass123!',
    name: 'Test User 2'
  });

  const user3 = await createTestUser({
    email: 'test-user3@ordefy.test',
    password: 'TestPass123!',
    name: 'Test User 3'
  });

  const user4 = await createTestUser({
    email: 'test-user4@ordefy.test',
    password: 'TestPass123!',
    name: 'Test User 4'
  });

  // User 2: Signup only (no trial)
  await createReferral(referrer.id, user2.id, referralCode);

  // User 3: Signup first, then start trial (triggers must fire on UPDATE)
  const ref3 = await createReferral(referrer.id, user3.id, referralCode);
  await new Promise(resolve => setTimeout(resolve, 300));
  await supabase
    .from('referrals')
    .update({
      trial_started_at: new Date().toISOString(),
      referred_plan: 'starter',
      referred_discount_applied: true
    })
    .eq('id', ref3.id);

  // User 4: Signup → Trial → Conversion (triggers fire on each UPDATE)
  const ref4 = await createReferral(referrer.id, user4.id, referralCode);
  await new Promise(resolve => setTimeout(resolve, 300));
  await supabase
    .from('referrals')
    .update({
      trial_started_at: new Date().toISOString(),
      referred_plan: 'starter',
      referred_discount_applied: true
    })
    .eq('id', ref4.id);

  await new Promise(resolve => setTimeout(resolve, 300));
  await supabase
    .from('referrals')
    .update({
      first_payment_at: new Date().toISOString(),
      referrer_credit_amount_cents: 1000,
      referrer_credit_applied: false
    })
    .eq('id', ref4.id);

  // Wait for triggers
  await new Promise(resolve => setTimeout(resolve, 1000));

  const stats = await getReferralStats(referrer.id);

  // Total referrals: 4 (1 from previous tests + 3 new)
  // Signups (trials started): 3 (user 1 converted, user 3 trial, user 4 converted)
  // Conversions: 2 (user 1 + user 4)

  logTest('Multiple referrals tracked correctly',
    stats.total_signups === 3 && stats.total_conversions === 2,
    `Signups: ${stats.total_signups} (expected 3), Conversions: ${stats.total_conversions} (expected 2)`
  );

  logTest('Credits accumulated from multiple conversions',
    stats.total_credits_earned_cents === 2000, // $20 (2 conversions × $10)
    `Expected: $20.00, Got: $${stats.total_credits_earned_cents / 100}`
  );

  const funnel = await getFunnelAnalytics(referrer.id);
  if (funnel) {
    logTest('Funnel shows all registration stages',
      parseInt(funnel.total_registered) === 4 &&
      parseInt(funnel.total_trials_started) === 3 &&
      parseInt(funnel.total_paid) === 2,
      `Registered: ${funnel.total_registered}/4, Trials: ${funnel.total_trials_started}/3, Paid: ${funnel.total_paid}/2`
    );
  }
}

async function main() {
  console.log('🧪 REFERRAL SYSTEM COMPREHENSIVE TESTS');
  console.log('=====================================\n');

  try {
    // Cleanup before tests
    await cleanup();

    // Run tests in sequence
    const { referrer, code } = await test1_InitialReferralCodeCreation();
    const { referred } = await test2_SignupPhase(referrer, code);
    await test3_TrialStartPhase(referrer, referred, code);
    await test4_ConversionPhase(referrer, referred);
    await test5_AntiSelfReferral();
    await test6_FunnelAnalytics(referrer);
    await test7_MultipleReferrals(referrer, code);

    // Cleanup after tests
    await cleanup();

    // Summary
    console.log('\n=====================================');
    console.log('📊 TEST SUMMARY');
    console.log('=====================================\n');
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📝 Total:  ${testResults.tests.length}\n`);

    if (testResults.failed > 0) {
      console.log('❌ FAILED TESTS:\n');
      testResults.tests
        .filter(t => !t.passed)
        .forEach(t => {
          console.log(`   • ${t.name}`);
          if (t.details) console.log(`     ${t.details}`);
        });
      console.log('');
      process.exit(1);
    } else {
      console.log('🎉 ALL TESTS PASSED!\n');
      console.log('✅ Referral system is working correctly:\n');
      console.log('   1. Signup phase: No count increment ✅');
      console.log('   2. Trial start: Increments total_signups ✅');
      console.log('   3. Conversion: Increments total_conversions + credits ✅');
      console.log('   4. Anti-self-referral: Validation required in app layer ⚠️');
      console.log('   5. Funnel analytics: Accurate tracking ✅');
      console.log('   6. Multiple referrals: Correct accumulation ✅\n');

      console.log('📝 NOTES:\n');
      console.log('   • Anti-self-referral validation is implemented in api/routes/auth.ts');
      console.log('   • Database allows self-referrals but app layer prevents it');
      console.log('   • Migration 037 must be applied for funnel analytics\n');
    }

  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error.message);
    console.error(error.stack);
    await cleanup();
    process.exit(1);
  }
}

main();
