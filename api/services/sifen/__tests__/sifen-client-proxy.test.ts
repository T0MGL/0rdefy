/**
 * Unit tests for the SIFEN egress proxy agent (incident 2026-06).
 *
 * The durable fix routes ALL SeT traffic through a fixed clean IPv4 via an HTTP
 * CONNECT tunnel, while keeping mTLS end to end (worker<->SeT). The critical
 * correctness property is that the client certificate/key terminate at SeT
 * THROUGH the tunnel, never at the proxy, and that rejectUnauthorized stays
 * true. A naive proxy-agent can silently drop the client cert; these tests pin
 * the behavior so a refactor cannot regress it.
 *
 * No network I/O: we only inspect the agent object that buildEgressAgent
 * returns. The destination TLS handshake is exercised in production by the boot
 * probe (consultLote) once SIFEN_EGRESS_PROXY is set.
 *
 * Run with:
 *   npx tsx --test api/services/sifen/__tests__/sifen-client-proxy.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { buildEgressAgent } from '../sifen-client';
import type { SifenMtls } from '../sifen-client';

// Throwaway PEM-shaped strings. buildEgressAgent does not parse them (no TLS
// handshake happens in this test), it only attaches them to the agent options.
const MTLS: SifenMtls = {
  certPem: '-----BEGIN CERTIFICATE-----\nTEST-CERT\n-----END CERTIFICATE-----',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nTEST-KEY\n-----END PRIVATE KEY-----',
};

const ORIGINAL = process.env.SIFEN_EGRESS_PROXY;

describe('buildEgressAgent', () => {
  beforeEach(() => {
    delete process.env.SIFEN_EGRESS_PROXY;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SIFEN_EGRESS_PROXY;
    else process.env.SIFEN_EGRESS_PROXY = ORIGINAL;
  });

  it('returns a direct https.Agent (not a proxy agent) when SIFEN_EGRESS_PROXY is unset', () => {
    const agent = buildEgressAgent(MTLS);
    assert.ok(agent instanceof https.Agent, 'should be an https.Agent');
    assert.ok(
      !(agent instanceof HttpsProxyAgent),
      'must NOT be a proxy agent when the env var is unset (direct mTLS, unchanged behavior)',
    );
    // Direct agent must not pin a single socket (F5 keep-alive trap).
    assert.equal(
      (agent as https.Agent & { keepAlive?: boolean }).keepAlive,
      false,
      'direct agent must use keepAlive:false',
    );
  });

  it('treats an empty/whitespace SIFEN_EGRESS_PROXY as unset (direct mode)', () => {
    process.env.SIFEN_EGRESS_PROXY = '   ';
    const agent = buildEgressAgent(MTLS);
    assert.ok(
      !(agent instanceof HttpsProxyAgent),
      'blank proxy URL must fall back to direct mode, not build a broken proxy agent',
    );
  });

  it('returns an HttpsProxyAgent carrying the client cert/key and rejectUnauthorized:true when the proxy is set', () => {
    process.env.SIFEN_EGRESS_PROXY = 'http://user:pass@198.51.100.10:8888';
    const agent = buildEgressAgent(MTLS);

    assert.ok(
      agent instanceof HttpsProxyAgent,
      'must build a proxy agent when SIFEN_EGRESS_PROXY is set',
    );

    // The cert/key/rejectUnauthorized passed to HttpsProxyAgent are the options
    // it spreads into tls.connect() for the DESTINATION socket (after CONNECT),
    // so the client identity terminates at SeT, not at the proxy. We assert the
    // agent retained them. The lib stores constructor opts on connectOpts.
    const connectOpts = (
      agent as unknown as {
        connectOpts?: {
          cert?: string;
          key?: string;
          rejectUnauthorized?: boolean;
        };
      }
    ).connectOpts;

    assert.ok(connectOpts, 'proxy agent should expose connectOpts');
    assert.equal(
      connectOpts?.cert,
      MTLS.certPem,
      'client cert must be attached to the proxy agent so it reaches the SeT TLS handshake through the tunnel',
    );
    assert.equal(
      connectOpts?.key,
      MTLS.privateKeyPem,
      'client private key must be attached to the proxy agent',
    );
    assert.equal(
      connectOpts?.rejectUnauthorized,
      true,
      'rejectUnauthorized must stay true: we still verify the SeT server cert end to end',
    );
  });

  it('points the tunnel at the configured proxy host/port', () => {
    process.env.SIFEN_EGRESS_PROXY = 'http://user:pass@198.51.100.10:8888';
    const agent = buildEgressAgent(MTLS) as HttpsProxyAgent<string>;

    const proxy = (agent as unknown as { proxy?: URL }).proxy;
    assert.ok(proxy, 'proxy agent should expose the parsed proxy URL');
    assert.equal(proxy?.hostname, '198.51.100.10');
    assert.equal(proxy?.port, '8888');
    assert.equal(proxy?.username, 'user');
    assert.equal(proxy?.password, 'pass');
  });
});
