/**
 * Global Test Setup
 *
 * Runs before all tests to verify environment and connectivity.
 */

import { CONFIG } from './config';

export async function setup() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║     🧪  ORDEFY E2E TEST SUITE - PRODUCTION                   ║');
  console.log('║                                                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  API URL:    ${CONFIG.apiUrl.padEnd(46)}║`);
  console.log(`║  User:       ${CONFIG.credentials.email.padEnd(46)}║`);
  console.log(`║  Prefix:     ${CONFIG.testPrefix.padEnd(46)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║                                                              ║');
  console.log('║  ⚠️   RUNNING AGAINST PRODUCTION - DATA WILL BE CLEANED     ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Verify API connectivity
  console.log('🔌 Verifying API connectivity...');

  try {
    const response = await fetch(`${CONFIG.apiUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      console.log('   ✓ API is reachable\n');
    } else {
      // Try login endpoint as fallback health check
      const loginCheck = await fetch(`${CONFIG.apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '', password: '' }),
        signal: AbortSignal.timeout(10000)
      });

      if (loginCheck.status === 400 || loginCheck.status === 401) {
        console.log('   ✓ API is reachable (via auth endpoint)\n');
      } else {
        throw new Error(`Unexpected status: ${loginCheck.status}`);
      }
    }
  } catch (error) {
    console.error('   ✗ API is not reachable!');
    console.error(`     Error: ${(error as Error).message}`);
    console.error('\n   Please verify:');
    console.error(`   1. API URL is correct: ${CONFIG.apiUrl}`);
    console.error('   2. Your network connection is working');
    console.error('   3. The production API is running\n');
    throw new Error('API connectivity check failed');
  }

  // Verify credentials
  console.log('🔑 Verifying test credentials...');

  try {
    const response = await fetch(`${CONFIG.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: CONFIG.credentials.email,
        password: CONFIG.credentials.password
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Login failed with status ${response.status}`);
    }

    const data = await response.json();

    if (!data.token) {
      throw new Error('Login response missing token');
    }

    console.log(`   ✓ Credentials valid for: ${data.user?.email}`);
    console.log(`   ✓ Store access: ${data.user?.stores?.[0]?.name || 'Available'}\n`);
  } catch (error) {
    console.error('   ✗ Credentials verification failed!');
    console.error(`     Error: ${(error as Error).message}`);
    console.error('\n   Please verify:');
    console.error(`   1. Email: ${CONFIG.credentials.email}`);
    console.error('   2. Password is correct');
    console.error('   3. Account has not been locked\n');
    throw new Error('Credentials verification failed');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('                         Starting Tests...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

export async function teardown() {
  console.log('\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('                         Tests Complete');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📋 Run `npm run cleanup` to verify all test data was removed.\n');
}
