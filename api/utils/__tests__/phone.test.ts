/**
 * Unit tests for normalizeParaguayPhone.
 *
 * Run with:
 *   npx tsx --test api/utils/__tests__/phone.test.ts
 *
 * The function is intentionally conservative: it only rewrites a number
 * when the input is unambiguously Paraguayan. These tests document the
 * exact PY shapes we collapse, and (critically) the foreign shapes we
 * MUST leave alone so we never lose contact with a non-PY customer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParaguayPhone } from '../phone';

describe('normalizeParaguayPhone — Paraguay normalization', () => {
  it('canonicalises the three Shopify variants reported in production', () => {
    assert.equal(normalizeParaguayPhone('0983912902'), '+595983912902');
    assert.equal(normalizeParaguayPhone('+5950983912902'), '+595983912902');
    assert.equal(normalizeParaguayPhone('+595983912902'), '+595983912902');
  });

  it('strips formatting characters before classifying', () => {
    assert.equal(normalizeParaguayPhone(' +595 983 912 902 '), '+595983912902');
    assert.equal(normalizeParaguayPhone('+595-983-912-902'), '+595983912902');
    assert.equal(normalizeParaguayPhone('(0983) 912-902'), '+595983912902');
  });

  it('handles bare 9-digit PY mobile and 595-without-plus', () => {
    assert.equal(normalizeParaguayPhone('983912902'), '+595983912902');
    assert.equal(normalizeParaguayPhone('595983912902'), '+595983912902');
  });

  it('covers all PY mobile blocks 96/97/98/99', () => {
    assert.equal(normalizeParaguayPhone('0961234567'), '+595961234567');
    assert.equal(normalizeParaguayPhone('0971234567'), '+595971234567');
    assert.equal(normalizeParaguayPhone('0981234567'), '+595981234567');
    assert.equal(normalizeParaguayPhone('0991234567'), '+595991234567');
  });

  it('is idempotent', () => {
    const inputs = ['0983912902', '+5950983912902', '+595983912902', '983912902', '595983912902'];
    for (const input of inputs) {
      const once = normalizeParaguayPhone(input);
      const twice = normalizeParaguayPhone(once);
      const thrice = normalizeParaguayPhone(twice);
      assert.equal(twice, once, `idempotency broke for ${input}`);
      assert.equal(thrice, once, `idempotency broke twice for ${input}`);
    }
  });
});

describe('normalizeParaguayPhone — safety: never mangle foreign numbers', () => {
  // Every test below MUST return the original input untouched. A failure
  // here means we just silently corrupted a real customer's phone number.

  it('passes through Argentina numbers', () => {
    assert.equal(normalizeParaguayPhone('+5491123456789'), '+5491123456789');
    assert.equal(normalizeParaguayPhone('+541112345678'), '+541112345678');
    // Argentine local format (11 digits with leading 0)
    assert.equal(normalizeParaguayPhone('01112345678'), '01112345678');
  });

  it('passes through Brazil numbers', () => {
    assert.equal(normalizeParaguayPhone('+5511987654321'), '+5511987654321');
    assert.equal(normalizeParaguayPhone('+551133334444'), '+551133334444');
  });

  it('passes through Uruguay numbers (country code 598, close to 595)', () => {
    assert.equal(normalizeParaguayPhone('+59899123456'), '+59899123456');
    assert.equal(normalizeParaguayPhone('+598212345678'), '+598212345678');
  });

  it('passes through other South American country codes', () => {
    // Peru +51, Chile +56, Colombia +57, Bolivia +591, Ecuador +593
    assert.equal(normalizeParaguayPhone('+51987654321'), '+51987654321');
    assert.equal(normalizeParaguayPhone('+56912345678'), '+56912345678');
    assert.equal(normalizeParaguayPhone('+573001234567'), '+573001234567');
    assert.equal(normalizeParaguayPhone('+59171234567'), '+59171234567');
    assert.equal(normalizeParaguayPhone('+593987654321'), '+593987654321');
  });

  it('passes through US/Canada numbers', () => {
    assert.equal(normalizeParaguayPhone('+14155552671'), '+14155552671');
    assert.equal(normalizeParaguayPhone('+12125551234'), '+12125551234');
  });

  it('passes through European numbers', () => {
    // France local with leading 0 (10 digits) — this is the critical
    // collision case that the first draft of this function got wrong.
    assert.equal(normalizeParaguayPhone('0112345678'), '0112345678');
    assert.equal(normalizeParaguayPhone('+33112345678'), '+33112345678');
    // Spain mobile (9 digits starting with 6 or 7, NOT 9)
    assert.equal(normalizeParaguayPhone('612345678'), '612345678');
    assert.equal(normalizeParaguayPhone('712345678'), '712345678');
    // UK
    assert.equal(normalizeParaguayPhone('+442071234567'), '+442071234567');
    // Germany
    assert.equal(normalizeParaguayPhone('+4915112345678'), '+4915112345678');
  });

  it('passes through PY landlines (9-digit, start with 02/03/04/05/07)', () => {
    // PY landlines do not match any of our rewrite rules (length != 10,
    // and the 9-digit rule requires a leading 9). They stay as-is.
    assert.equal(normalizeParaguayPhone('021234567'), '021234567');
    assert.equal(normalizeParaguayPhone('071234567'), '071234567');
  });
});

describe('normalizeParaguayPhone — edge cases', () => {
  it('returns empty string for nullish / empty input', () => {
    assert.equal(normalizeParaguayPhone(null), '');
    assert.equal(normalizeParaguayPhone(undefined), '');
    assert.equal(normalizeParaguayPhone(''), '');
    assert.equal(normalizeParaguayPhone('   '), '');
  });

  it('passes through obviously invalid input rather than mangling', () => {
    assert.equal(normalizeParaguayPhone('abc'), 'abc');
    assert.equal(normalizeParaguayPhone('123'), '123');
    // 10 digits starting with 0 but NOT 09 (e.g. landline-ish, French, etc.)
    assert.equal(normalizeParaguayPhone('0212345678'), '0212345678');
    // 11 digits starting with 0 (Argentine pattern)
    assert.equal(normalizeParaguayPhone('09839129021'), '09839129021');
    // 9 digits not starting with 9 (e.g. Spain mobile)
    assert.equal(normalizeParaguayPhone('612345678'), '612345678');
  });
});
