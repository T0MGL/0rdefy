/**
 * Unit tests for the SIFEN auto-dispatch kill switch.
 *
 * Verifica el gate que decide si el dispatcher arma el lazo automatico
 * (NOTIFY + sweep + barrido de arranque) o si queda en modo manual-only.
 * El default DEBE ser OFF: tras el incidente de egress 2026-06 el owner
 * pidio que nada se reintente solo.
 *
 * Run with:
 *   npx tsx --test api/workers/__tests__/sifen-auto-dispatch-flag.test.ts
 *
 * Nota: importamos el modulo dinamicamente DESPUES de inyectar env dummy de
 * Supabase, porque api/db/connection.ts (importado transitivamente) lanza si
 * faltan SUPABASE_*. No abrimos ninguna conexion real: solo testeamos la
 * funcion pura del flag.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Stub de env requerido por connection.ts en la cadena de imports. Valores
// ficticios: el test no hace I/O, solo evalua la funcion del flag.
process.env.SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'stub-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub-service-role-key';

type FlagFn = (env?: NodeJS.ProcessEnv) => boolean;

describe('isAutoDispatchEnabled', () => {
  let isAutoDispatchEnabled: FlagFn;

  before(async () => {
    ({ isAutoDispatchEnabled } = await import('../sifen-dispatcher'));
  });

  it('defaults to OFF when the var is absent', () => {
    assert.equal(isAutoDispatchEnabled({}), false);
  });

  it('is OFF for the literal "false"', () => {
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: 'false' }), false);
  });

  it('is OFF for an empty string', () => {
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: '' }), false);
  });

  it('is OFF for arbitrary noise (no accidental enable)', () => {
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: 'yes' }), false);
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: 'on' }), false);
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: '0' }), false);
  });

  it('is ON only for "1" or "true" (case/space-insensitive)', () => {
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: '1' }), true);
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: 'true' }), true);
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: 'TRUE' }), true);
    assert.equal(isAutoDispatchEnabled({ SIFEN_AUTO_DISPATCH: '  true  ' }), true);
  });
});
