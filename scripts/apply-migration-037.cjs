/**
 * Script to apply migration 037 - Fix collaborator limits to use plan_limits
 *
 * This migration updates the can_add_user_to_store and get_store_user_stats functions
 * to read from subscriptions + plan_limits instead of stores.max_users
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://vgqecqqleuowvoimcoxg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncWVjcXFsZXVvd3ZvaW1jb3hnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzA1Njk3NywiZXhwIjoyMDgyNjMyOTc3fQ.IjLDyb3WCjddkszPyXgDblfi3Pyfq8wb3C9blZOaZO4'
);

async function testCurrentFunctions() {
  console.log('\n=== Testing BEFORE Migration ===\n');

  const storeId = '4cf0e361-4c7b-4125-87e2-68c148bca1ef';

  // Test can_add_user_to_store
  const { data: canAdd, error: canAddError } = await supabase
    .rpc('can_add_user_to_store', { p_store_id: storeId });

  console.log('can_add_user_to_store:', canAdd, canAddError ? `Error: ${canAddError.message}` : '');

  // Test get_store_user_stats
  const { data: stats, error: statsError } = await supabase
    .rpc('get_store_user_stats', { p_store_id: storeId })
    .single();

  console.log('get_store_user_stats:', JSON.stringify(stats, null, 2), statsError ? `Error: ${statsError.message}` : '');

  // Check subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan, status')
    .eq('store_id', storeId)
    .single();

  console.log('Current subscription:', sub);

  // Check plan_limits for professional
  const { data: limits } = await supabase
    .from('plan_limits')
    .select('max_users')
    .eq('plan', 'professional')
    .single();

  console.log('Professional plan max_users:', limits?.max_users);
}

async function main() {
  console.log('Migration 037: Fix Collaborator Limits to Use plan_limits');
  console.log('='.repeat(60));

  await testCurrentFunctions();

  console.log('\n=== Migration Instructions ===\n');
  console.log('The SQL migration needs to be run directly in the Supabase SQL Editor.');
  console.log('1. Go to: https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/sql');
  console.log('2. Copy and paste the contents of:');
  console.log('   db/migrations/037_fix_collaborator_limits_to_use_plan_limits.sql');
  console.log('3. Click "Run" to execute the migration');
  console.log('\nAlternatively, run the following SQL directly:\n');

  const sql = `
-- UPDATE can_add_user_to_store FUNCTION
CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_users INTEGER;
    v_max_users INTEGER;
    v_current_plan subscription_plan_type;
BEGIN
    SELECT COUNT(*) INTO v_current_users
    FROM user_stores
    WHERE store_id = p_store_id AND is_active = true;

    v_current_users := v_current_users + (
        SELECT COUNT(*)
        FROM collaborator_invitations
        WHERE store_id = p_store_id
        AND used = false
        AND expires_at > NOW()
    );

    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM stores st
    LEFT JOIN subscriptions s ON s.store_id = st.id AND s.status IN ('active', 'trialing')
    WHERE st.id = p_store_id;

    IF v_current_plan IS NULL THEN
        v_current_plan := 'free';
    END IF;

    SELECT max_users INTO v_max_users
    FROM plan_limits
    WHERE plan = v_current_plan;

    IF v_max_users IS NULL THEN
        v_max_users := 1;
    END IF;

    IF v_max_users = -1 THEN
        RETURN TRUE;
    END IF;

    RETURN v_current_users < v_max_users;
END;
$$ LANGUAGE plpgsql;

-- UPDATE get_store_user_stats FUNCTION
CREATE OR REPLACE FUNCTION get_store_user_stats(p_store_id UUID)
RETURNS TABLE (
    current_users INTEGER,
    pending_invitations INTEGER,
    max_users INTEGER,
    plan TEXT,
    slots_available INTEGER
) AS $$
DECLARE
    v_current_plan subscription_plan_type;
BEGIN
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM stores st
    LEFT JOIN subscriptions s ON s.store_id = st.id AND s.status IN ('active', 'trialing')
    WHERE st.id = p_store_id;

    IF v_current_plan IS NULL THEN
        v_current_plan := 'free';
    END IF;

    RETURN QUERY
    SELECT
        (SELECT COUNT(*)::INTEGER FROM user_stores WHERE store_id = p_store_id AND is_active = true) as current_users,
        (SELECT COUNT(*)::INTEGER FROM collaborator_invitations WHERE store_id = p_store_id AND used = false AND expires_at > NOW()) as pending_invitations,
        pl.max_users,
        v_current_plan::TEXT as plan,
        CASE
            WHEN pl.max_users = -1 THEN -1
            ELSE pl.max_users - (
                SELECT COUNT(*)::INTEGER FROM user_stores WHERE store_id = p_store_id AND is_active = true
            ) - (
                SELECT COUNT(*)::INTEGER FROM collaborator_invitations WHERE store_id = p_store_id AND used = false AND expires_at > NOW()
            )
        END as slots_available
    FROM plan_limits pl
    WHERE pl.plan = v_current_plan;
END;
$$ LANGUAGE plpgsql;
`;

  console.log(sql);
}

main().catch(console.error);
