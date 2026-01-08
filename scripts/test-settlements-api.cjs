const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '/Users/gastonlopez/Documents/Code/ORDEFY/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_URL = 'http://localhost:3001';

async function testSettlementsAPI() {
  console.log('🧪 Testing Settlements API...\n');

  // 1. Get a user and store to use for testing
  console.log('1. Getting test user and store...');
  const { data: userStore, error: usError } = await supabase
    .from('user_stores')
    .select('user_id, store_id, role')
    .eq('role', 'owner')
    .limit(1)
    .single();

  if (usError || !userStore) {
    console.log('❌ Could not find test user:', usError?.message);
    return;
  }

  const userId = userStore.user_id;
  const storeId = userStore.store_id;

  // Get user email
  const { data: user } = await supabase
    .from('users')
    .select('email, name')
    .eq('id', userId)
    .single();

  const userEmail = user?.email || 'unknown';
  console.log('   Using user:', userEmail, '(store:', storeId, ')');

  // 2. Generate test token with correct claims
  console.log('   JWT_SECRET present:', !!process.env.JWT_SECRET);
  const token = jwt.sign(
    { userId, email: userEmail },
    process.env.JWT_SECRET,
    {
      expiresIn: '1h',
      issuer: 'ordefy-api',
      audience: 'ordefy-app',
      algorithm: 'HS256'
    }
  );
  console.log('   Token generated:', token.substring(0, 50) + '...');

  const headers = {
    'Authorization': 'Bearer ' + token,
    'X-Store-ID': storeId,
    'Content-Type': 'application/json'
  };

  // 3. Test GET /api/settlements/dispatch-sessions
  console.log('\n2. Testing GET /api/settlements/dispatch-sessions...');
  try {
    const res = await fetch(API_URL + '/api/settlements/dispatch-sessions', { headers });
    const data = await res.json();

    if (res.ok) {
      console.log('✅ Dispatch sessions endpoint works');
      console.log('   Status:', res.status);
      console.log('   Sessions count:', data.data?.length || 0);
    } else {
      console.log('❌ Error:', res.status, data.error || data.message);
    }
  } catch (e) {
    console.log('❌ Network error:', e.message);
  }

  // 4. Test GET /api/settlements/summary/v2
  console.log('\n3. Testing GET /api/settlements/summary/v2...');
  try {
    const res = await fetch(API_URL + '/api/settlements/summary/v2', { headers });
    const data = await res.json();

    if (res.ok) {
      console.log('✅ Summary v2 endpoint works');
      console.log('   Status:', res.status);
      console.log('   Summary:', JSON.stringify(data.data || data, null, 2).substring(0, 200));
    } else {
      console.log('❌ Error:', res.status, data.error || data.message);
    }
  } catch (e) {
    console.log('❌ Network error:', e.message);
  }

  // 5. Test GET /api/settlements/pending-by-carrier
  console.log('\n4. Testing GET /api/settlements/pending-by-carrier...');
  try {
    const res = await fetch(API_URL + '/api/settlements/pending-by-carrier', { headers });
    const data = await res.json();

    if (res.ok) {
      console.log('✅ Pending by carrier endpoint works');
      console.log('   Status:', res.status);
      console.log('   Carriers count:', data.data?.length || 0);
    } else {
      console.log('❌ Error:', res.status, data.error || data.message);
    }
  } catch (e) {
    console.log('❌ Network error:', e.message);
  }

  // 6. Test carrier zones - first get a carrier
  console.log('\n5. Testing carrier zones...');
  const { data: carriers } = await supabase
    .from('carriers')
    .select('id, name')
    .eq('store_id', storeId)
    .limit(1);

  if (carriers && carriers.length > 0) {
    const carrierId = carriers[0].id;
    console.log('   Using carrier:', carriers[0].name);

    // Test GET zones for carrier
    try {
      const res = await fetch(API_URL + '/api/couriers/' + carrierId + '/zones', { headers });
      const data = await res.json();

      if (res.ok) {
        console.log('✅ Carrier zones endpoint works');
        console.log('   Status:', res.status);
        console.log('   Zones count:', data.zones?.length || 0);
      } else {
        console.log('❌ Error:', res.status, data.error || data.message);
      }
    } catch (e) {
      console.log('❌ Network error:', e.message);
    }

    // Test creating a zone
    console.log('\n6. Testing POST carrier zone...');
    try {
      const res = await fetch(API_URL + '/api/couriers/' + carrierId + '/zones', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          zone_name: 'Test Zone - Asuncion',
          zone_code: 'ASU',
          rate: 25000,
          is_active: true
        })
      });
      const data = await res.json();

      if (res.ok) {
        console.log('✅ Create zone endpoint works');
        console.log('   Created zone:', data.data?.zone_name || data.zone_name);

        // Clean up - delete the test zone
        if (data.data?.id) {
          const delRes = await fetch(API_URL + '/api/couriers/zones/' + data.data.id, {
            method: 'DELETE',
            headers
          });
          if (delRes.ok) {
            console.log('   (Test zone cleaned up)');
          }
        }
      } else {
        console.log('❌ Error:', res.status, data.error || data.message);
      }
    } catch (e) {
      console.log('❌ Network error:', e.message);
    }
  } else {
    console.log('   No carriers found for this store, skipping zones test');
  }

  // 7. Test orders ready to dispatch
  console.log('\n7. Testing GET /api/settlements/orders-to-dispatch...');
  try {
    const res = await fetch(API_URL + '/api/settlements/orders-to-dispatch', { headers });
    const data = await res.json();

    if (res.ok) {
      console.log('✅ Orders to dispatch endpoint works');
      console.log('   Status:', res.status);
      console.log('   Orders count:', data.data?.length || 0);
    } else {
      console.log('❌ Error:', res.status, data.error || data.message);
    }
  } catch (e) {
    console.log('❌ Network error:', e.message);
  }

  console.log('\n✅ API testing complete!');
}

testSettlementsAPI().catch(console.error);
