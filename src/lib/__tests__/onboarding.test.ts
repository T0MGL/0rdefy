/**
 * Regression tests for onboarding-completion derivation.
 *
 * Guards the production bug where a fully-onboarded user (owner OR courier) was
 * bounced back into the store-setup form on a cold start because OnboardingGuard
 * read a fragile standalone `onboarding_completed` localStorage key that was
 * absent after reload / new tab / PWA relaunch.
 *
 * The fix makes `deriveOnboardingCompleted` the single source of truth:
 *   - couriers are always exempt,
 *   - the durable backend flag wins when present,
 *   - a legacy cached session falls back to the backend's own rule.
 *
 * Critically, a brand-new owner who legitimately MUST see onboarding must still
 * be classified as NOT completed.
 *
 * Run with `npm run test:unit`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveOnboardingCompleted,
  isCourierOnly,
  type OnboardingUserState,
} from '../onboarding';

const ownerStore = { role: 'owner' };
const courierStore = { role: 'courier' };
const adminStore = { role: 'admin' };

describe('isCourierOnly', () => {
  it('returns false for no stores', () => {
    assert.equal(isCourierOnly(undefined), false);
    assert.equal(isCourierOnly([]), false);
  });

  it('returns true only when every membership is courier', () => {
    assert.equal(isCourierOnly([courierStore]), true);
    assert.equal(isCourierOnly([courierStore, courierStore]), true);
  });

  it('returns false when any membership is non-courier', () => {
    assert.equal(isCourierOnly([courierStore, adminStore]), false);
    assert.equal(isCourierOnly([ownerStore]), false);
  });

  it('is case-insensitive on role', () => {
    assert.equal(isCourierOnly([{ role: 'COURIER' }]), true);
  });
});

describe('deriveOnboardingCompleted', () => {
  it('returns false for a null user', () => {
    assert.equal(deriveOnboardingCompleted(null), false);
  });

  // --- The reported bug: couriers must NEVER see store-setup onboarding ---
  it('treats a courier as completed even without the durable flag', () => {
    const courier: OnboardingUserState = { name: 'Repartidor', stores: [courierStore] };
    assert.equal(deriveOnboardingCompleted(courier), true);
  });

  it('treats a courier as completed even if a stale flag says false', () => {
    const courier: OnboardingUserState = {
      name: 'Repartidor',
      stores: [courierStore],
      onboardingCompleted: false,
    };
    assert.equal(deriveOnboardingCompleted(courier), true);
  });

  // --- Durable backend flag is authoritative for non-couriers ---
  it('honors the durable flag = true', () => {
    const user: OnboardingUserState = {
      name: 'Owner',
      stores: [ownerStore],
      onboardingCompleted: true,
    };
    assert.equal(deriveOnboardingCompleted(user), true);
  });

  it('honors the durable flag = false even if the legacy rule would pass', () => {
    // A freshly-registered owner gets a default store + name but has NOT
    // finished onboarding. The explicit false must win.
    const freshOwner: OnboardingUserState = {
      name: 'New Owner',
      stores: [ownerStore],
      onboardingCompleted: false,
    };
    assert.equal(deriveOnboardingCompleted(freshOwner), false);
  });

  // --- Legacy cached sessions (no durable flag) fall back to backend rule ---
  it('classifies a fully-onboarded owner (legacy cache) as completed', () => {
    // The original cold-start bug: no flag present, but the user clearly has a
    // store and a name. Must NOT be bounced to onboarding.
    const legacyOwner: OnboardingUserState = { name: 'Owner', stores: [ownerStore] };
    assert.equal(deriveOnboardingCompleted(legacyOwner), true);
  });

  // --- Legitimate new owners must STILL see onboarding ---
  it('classifies an owner with no stores as NOT completed', () => {
    const user: OnboardingUserState = { name: 'Owner', stores: [] };
    assert.equal(deriveOnboardingCompleted(user), false);
  });

  it('classifies an owner with a store but no name as NOT completed', () => {
    const user: OnboardingUserState = { name: '', stores: [ownerStore] };
    assert.equal(deriveOnboardingCompleted(user), false);
  });

  it('classifies an owner with undefined stores as NOT completed', () => {
    const user: OnboardingUserState = { name: 'Owner' };
    assert.equal(deriveOnboardingCompleted(user), false);
  });
});
