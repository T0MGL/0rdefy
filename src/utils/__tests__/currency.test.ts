/**
 * Unit tests for the currency formatting/parsing helpers. The contract under
 * test: rates and nullable amounts render 'N/A' (never a fake zero, never
 * "NaN"), parsers return NaN on garbage instead of a silent 0, and decimal
 * handling matches the currency (PYG has 0 decimals, USD has 2).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// currency.ts reads localStorage and the active store at module level helpers.
// Provide a minimal browser-shaped global before importing.
(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const {
  formatCurrency,
  formatCurrencyOrFallback,
  formatPercent,
  formatCompactCurrency,
  parseCurrency,
  parseAmountInput,
} = await import('../currency');

describe('formatCurrency', () => {
  it('formats PYG with zero decimals', () => {
    const out = formatCurrency(1234567, 'PYG');
    assert.match(out.replace(/ /g, ' '), /1\.234\.567/);
    assert.doesNotMatch(out, /,\d{2}$/);
  });

  it('formats USD with two decimals', () => {
    assert.match(formatCurrency(1234.5, 'USD'), /1,234\.50/);
  });

  it('formats a real zero as a currency amount, not N/A', () => {
    assert.notEqual(formatCurrency(0, 'PYG'), 'N/A');
  });

  it('returns N/A for NaN instead of rendering "NaN"', () => {
    assert.equal(formatCurrency(NaN, 'PYG'), 'N/A');
  });

  it('returns N/A for Infinity and -Infinity', () => {
    assert.equal(formatCurrency(Infinity, 'USD'), 'N/A');
    assert.equal(formatCurrency(-Infinity, 'PYG'), 'N/A');
  });
});

describe('formatCurrencyOrFallback', () => {
  it('renders the fallback for null and undefined', () => {
    assert.equal(formatCurrencyOrFallback(null), 'N/A');
    assert.equal(formatCurrencyOrFallback(undefined), 'N/A');
    assert.equal(formatCurrencyOrFallback(null, 'Sin datos'), 'Sin datos');
  });

  it('renders the fallback for non-finite numbers', () => {
    assert.equal(formatCurrencyOrFallback(NaN), 'N/A');
  });

  it('formats finite numbers including zero', () => {
    assert.notEqual(formatCurrencyOrFallback(0, 'N/A', 'PYG'), 'N/A');
    assert.match(formatCurrencyOrFallback(150000, 'N/A', 'PYG'), /150\.000/);
  });
});

describe('formatPercent', () => {
  it('renders N/A for null, undefined, and non-finite', () => {
    assert.equal(formatPercent(null), 'N/A');
    assert.equal(formatPercent(undefined), 'N/A');
    assert.equal(formatPercent(NaN), 'N/A');
    assert.equal(formatPercent(Infinity), 'N/A');
  });

  it('distinguishes a real 0% from N/A', () => {
    assert.equal(formatPercent(0), '0.0%');
  });

  it('respects the decimals argument', () => {
    assert.equal(formatPercent(94.719, 1), '94.7%');
    assert.equal(formatPercent(94.719, 0), '95%');
  });
});

describe('formatCompactCurrency', () => {
  it('renders N/A for null/undefined/non-finite', () => {
    assert.equal(formatCompactCurrency(null), 'N/A');
    assert.equal(formatCompactCurrency(undefined), 'N/A');
    assert.equal(formatCompactCurrency(NaN), 'N/A');
  });

  it('compacts thousands with the currency symbol', () => {
    const out = formatCompactCurrency(1234567, 'PYG');
    assert.match(out, /K$/);
    assert.match(out, /^Gs\./);
  });

  it('keeps sub-1000 amounts uncompacted', () => {
    assert.doesNotMatch(formatCompactCurrency(950, 'PYG'), /K$/);
  });
});

describe('parseCurrency', () => {
  it('parses PY-formatted strings', () => {
    assert.equal(parseCurrency('Gs. 1.234.567'), 1234567);
  });

  it('returns NaN for empty or non-numeric input instead of 0', () => {
    assert.ok(Number.isNaN(parseCurrency('')));
    assert.ok(Number.isNaN(parseCurrency('abc')));
    assert.ok(Number.isNaN(parseCurrency('Gs. ')));
  });

  it('still parses a real zero', () => {
    assert.equal(parseCurrency('0'), 0);
  });
});

describe('parseAmountInput (regression: existing contract intact)', () => {
  it('treats separators as thousands for 0-decimal currencies', () => {
    assert.equal(parseAmountInput('150.000', 0), 150000);
    assert.equal(parseAmountInput('150,000', 0), 150000);
  });

  it('returns NaN on empty input', () => {
    assert.ok(Number.isNaN(parseAmountInput('', 0)));
  });

  it('parses decimal currencies with mixed separators', () => {
    assert.equal(parseAmountInput('150.000,50', 2), 150000.5);
    assert.equal(parseAmountInput('150,000.50', 2), 150000.5);
  });
});
