/**
 * Unit tests for normalizeSearch and tokenizeSearch.
 *
 * Run with:
 *   npx tsx --test api/utils/__tests__/sanitize.test.ts
 *
 * These helpers back the multi-token search introduced in Migration 195
 * (orders.search_text). The JS-side normalization MUST stay byte-for-byte
 * compatible with the DB-side immutable_unaccent(lower(...)) applied to
 * the stored column, otherwise queries silently miss rows that exist.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, tokenizeSearch } from '../sanitize';

describe('normalizeSearch', () => {
  it('strips Spanish diacritics so accented names match unaccented stored text', () => {
    assert.equal(normalizeSearch('Gómez'), 'gomez');
    assert.equal(normalizeSearch('Báez'), 'baez');
    assert.equal(normalizeSearch('Núñez'), 'nunez');
    assert.equal(normalizeSearch('Verónica Giménez'), 'veronica gimenez');
  });

  it('lowercases mixed-case input', () => {
    assert.equal(normalizeSearch('SoL GoMeZ'), 'sol gomez');
    assert.equal(normalizeSearch('PEDIDO-1234'), 'pedido-1234');
  });

  it('preserves ñ-to-n folding and tilde-bearing vowels', () => {
    assert.equal(normalizeSearch('Niño'), 'nino');
    assert.equal(normalizeSearch('Año'), 'ano');
    assert.equal(normalizeSearch('Mañana'), 'manana');
  });

  it('returns empty string for empty, null, or non-string input', () => {
    assert.equal(normalizeSearch(''), '');
    assert.equal(normalizeSearch(null as any), '');
    assert.equal(normalizeSearch(undefined as any), '');
    assert.equal(normalizeSearch(12345 as any), '');
  });

  it('preserves digits and ASCII punctuation untouched', () => {
    assert.equal(normalizeSearch('ord-20260335'), 'ord-20260335');
    assert.equal(normalizeSearch("O'Brien"), "o'brien");
    assert.equal(normalizeSearch('+595983912902'), '+595983912902');
  });

  it('preserves emoji and non-Latin scripts untouched (no NFD collateral damage)', () => {
    assert.equal(normalizeSearch('café ☕'), 'cafe ☕');
    assert.equal(normalizeSearch('日本語'), '日本語');
  });

  it('keeps interior whitespace so the tokenizer can split on it', () => {
    assert.equal(normalizeSearch('Sol  Gomez'), 'sol  gomez');
    assert.equal(normalizeSearch('  leading and trailing  '), '  leading and trailing  ');
  });
});

describe('tokenizeSearch', () => {
  it('splits multi-word input on whitespace', () => {
    assert.deepEqual(tokenizeSearch('sol gomez'), ['sol', 'gomez']);
    assert.deepEqual(tokenizeSearch('veronica gimenez perez'), ['veronica', 'gimenez', 'perez']);
  });

  it('collapses repeated whitespace and trims edges', () => {
    assert.deepEqual(tokenizeSearch('  sol    gomez  '), ['sol', 'gomez']);
    assert.deepEqual(tokenizeSearch('\t\tab\nc'), ['ab']);
  });

  it('drops single-character non-numeric tokens (a, b, x)', () => {
    assert.deepEqual(tokenizeSearch('a sol b gomez c'), ['sol', 'gomez']);
    assert.deepEqual(tokenizeSearch('x y z'), []);
  });

  it('keeps single-digit numeric tokens (short order suffix)', () => {
    assert.deepEqual(tokenizeSearch('9'), ['9']);
    assert.deepEqual(tokenizeSearch('order 5'), ['order', '5']);
  });

  it('returns empty array for empty, null, or non-string input', () => {
    assert.deepEqual(tokenizeSearch(''), []);
    assert.deepEqual(tokenizeSearch(null as any), []);
    assert.deepEqual(tokenizeSearch(undefined as any), []);
  });

  it('caps token count at default maxTokens=6 to bound ILIKE chain length', () => {
    const input = 'one two three four five six seven eight nine';
    const out = tokenizeSearch(input);
    assert.equal(out.length, 6);
    assert.deepEqual(out, ['one', 'two', 'three', 'four', 'five', 'six']);
  });

  it('honors a custom maxTokens cap', () => {
    assert.deepEqual(tokenizeSearch('a1 b2 c3 d4 e5', 3), ['a1', 'b2', 'c3']);
  });

  it('preserves long single tokens unchanged (phone, order id)', () => {
    assert.deepEqual(tokenizeSearch('+595983912902'), ['+595983912902']);
    assert.deepEqual(tokenizeSearch('ord-20260335'), ['ord-20260335']);
  });

  it('returns empty array for whitespace-only and single-char non-numeric input', () => {
    // Single-char tokens are dropped by the length>=2 gate unless purely numeric,
    // so a lone emoji (1 UTF-16 unit) collapses to no tokens.
    assert.deepEqual(tokenizeSearch('   '), []);
    assert.deepEqual(tokenizeSearch('☕'), []);
  });
});

describe('normalizeSearch + tokenizeSearch composition', () => {
  it('end-to-end on the Sol Gomez bug reproduction case', () => {
    const raw = 'Sol Gomez';
    const normalized = normalizeSearch(raw);
    const tokens = tokenizeSearch(normalized);
    assert.equal(normalized, 'sol gomez');
    assert.deepEqual(tokens, ['sol', 'gomez']);
  });

  it('end-to-end on accented multi-token input', () => {
    const raw = 'Verónica Giménez';
    const tokens = tokenizeSearch(normalizeSearch(raw));
    assert.deepEqual(tokens, ['veronica', 'gimenez']);
  });

  it('order-independent tokenization matches reverse input', () => {
    const a = tokenizeSearch(normalizeSearch('Sol Gomez'));
    const b = tokenizeSearch(normalizeSearch('Gomez Sol'));
    assert.deepEqual([...a].sort(), [...b].sort());
  });
});
