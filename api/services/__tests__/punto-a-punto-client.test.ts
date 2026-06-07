/**
 * Punto a Punto adapter unit tests. fetch is stubbed; zero real network calls.
 *
 *   npx tsx --test api/services/__tests__/punto-a-punto-client.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { puntoAPuntoAdapter, __clearTokenCacheForTests } from '../carriers/punto-a-punto/client';
import type { CarrierCredentials, CarrierOrderInput } from '../carriers/carrier-adapter';

const creds: CarrierCredentials = {
  username: 'bright.commerce',
  password: 'secret',
  tenantId: '2',
  baseUrl: 'https://rastreo.puntoapunto.com.py/trackerservices',
};

const order: CarrierOrderInput = {
  storeId: 'store-1',
  orderNumber: 'ORD-1001',
  customerName: 'Juan Perez',
  customerPhone: '0981123456',
  customerDocument: '1234567',
  address: 'Av. Mcal Lopez 123',
  city: 'asuncion',
  department: 'central',
  description: 'Pedido ORD-1001',
  codAmount: 250000,
};

interface StubCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

const calls: StubCall[] = [];
const originalFetch = globalThis.fetch;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (call: StubCall) => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers as Record<string, string>) ?? {};
    const call: StubCall = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

beforeEach(() => {
  calls.length = 0;
  __clearTokenCacheForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('authenticate + token cache', () => {
  it('sends Abp.TenantId header and caches the token across calls', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/api/TokenAuth/Authenticate')) {
        return jsonResponse(200, { result: { accessToken: 'tok-123', expireInSeconds: 2592000 } });
      }
      return jsonResponse(200, { result: { items: [{ value: 1, displayText: 'Paquete' }] } });
    });

    const first = await puntoAPuntoAdapter.validateCredentials(creds);
    const second = await puntoAPuntoAdapter.validateCredentials(creds);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const authCalls = calls.filter((c) => c.url.endsWith('/api/TokenAuth/Authenticate'));
    assert.equal(authCalls.length, 1, 'token must be reused, not re-fetched');
    assert.equal(authCalls[0].headers['Abp.TenantId'], '2');

    const lookupCall = calls.find((c) => c.url.includes('GetDatosComboboxItems'));
    assert.ok(lookupCall);
    assert.equal(lookupCall!.headers.Authorization, 'Bearer tok-123');
  });
});

describe('validateCredentials', () => {
  it('returns ok=false with the ABP message on auth failure, never throws', async () => {
    stubFetch(() => jsonResponse(401, { error: { code: 0, message: 'Login failed' } }));
    const result = await puntoAPuntoAdapter.validateCredentials(creds);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Login failed');
  });

  it('returns ok=false when the catalog is empty', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/api/TokenAuth/Authenticate')) {
        return jsonResponse(200, { result: { accessToken: 'tok' } });
      }
      return jsonResponse(200, { result: { items: [] } });
    });
    const result = await puntoAPuntoAdapter.validateCredentials(creds);
    assert.equal(result.ok, false);
  });
});

describe('createShipment mapping', () => {
  it('maps order to a flat CreatePaqueteV2 payload with defaults and no formaPago', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/api/TokenAuth/Authenticate')) {
        return jsonResponse(200, { result: { accessToken: 'tok' } });
      }
      return jsonResponse(200, { result: { nroGuia: 'GUIA-999', id: 4242 } });
    });

    const result = await puntoAPuntoAdapter.createShipment(creds, order);
    assert.deepEqual(result, { externalId: '4242', nroGuia: 'GUIA-999' });

    const createCall = calls.find((c) => c.url.endsWith('/External/CreatePaqueteV2'));
    assert.ok(createCall);
    const body = createCall!.body as Record<string, unknown>;
    assert.equal(body.nroGuia1, 'ORD-1001');
    assert.equal(body.referencia, 'ORD-1001');
    assert.equal(body.nombre, 'Juan Perez');
    assert.equal(body.telefono, '0981123456');
    assert.equal(body.nroDoc, '1234567');
    assert.equal(body.importe, 250000);
    assert.equal(body.ciudad, 'asuncion');
    assert.equal(body.dpto, 'central');
    assert.equal(body.tipoPaquete, 'Paquete');
    assert.equal(body.tipoEntrega, 'Cliente final');
    assert.equal(body.prioridadEntrega, 'Normal');
    assert.ok(!('formaPago' in body), 'V2 must not send formaPago');
  });

  it('coerces importe to a number type for the schema', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/api/TokenAuth/Authenticate')) {
        return jsonResponse(200, { result: { accessToken: 'tok' } });
      }
      return jsonResponse(200, { result: { nroGuia: 'G', id: 1 } });
    });
    await puntoAPuntoAdapter.createShipment(creds, { ...order, codAmount: 0 });
    const createCall = calls.find((c) => c.url.endsWith('/External/CreatePaqueteV2'));
    assert.equal(typeof (createCall!.body as Record<string, unknown>).importe, 'number');
  });
});

describe('findExistingByReference idempotency guard', () => {
  it('returns the external id when a package exists for the reference', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/api/TokenAuth/Authenticate')) {
        return jsonResponse(200, { result: { accessToken: 'tok' } });
      }
      return jsonResponse(200, { result: { id: 777, nroGuia: 'G-777' } });
    });
    const found = await puntoAPuntoAdapter.findExistingByReference(creds, 'ORD-1001');
    assert.deepEqual(found, { externalId: '777', nroGuia: 'G-777' });
  });

  it('returns null when no package exists', async () => {
    stubFetch((call) => {
      if (call.url.endsWith('/api/TokenAuth/Authenticate')) {
        return jsonResponse(200, { result: { accessToken: 'tok' } });
      }
      return jsonResponse(200, { result: null });
    });
    const found = await puntoAPuntoAdapter.findExistingByReference(creds, 'ORD-NOPE');
    assert.equal(found, null);
  });
});
