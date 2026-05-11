/**
 * Regression guard for the dashboard period-card labels.
 *
 * Background: Gaston reported on 2026-05-11 that the dashboard cards still
 * said "FACTURACION REAL HOY" and "TASA DE ENTREGA (7D)" even when the active
 * filter was "Desde siempre". The numbers were correct (verified against
 * production Supabase), but the JSX hardcoded the period suffix into the card
 * titles, so they lied about which period the user was looking at.
 *
 * This test scans the Dashboard source for any string literal that hardcodes
 * a period suffix into the visible card titles. If a future change reintroduces
 * one, CI fails before it ships.
 *
 * NOTE: we intentionally use a textual scan instead of rendering the React
 * tree. Mounting Dashboard pulls in auth, supabase, router and recharts, which
 * would require setting up a full vitest+jsdom rig for a single regression
 * check. A focused source scan catches the exact class of regression Gaston
 * flagged and stays trivially maintainable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = resolve(HERE, '../Dashboard.tsx');
const SOURCE = readFileSync(DASHBOARD_PATH, 'utf8');

// Patterns that must never appear as raw literals inside the JSX title slots.
// Each pattern is a `(label, regex)` pair: the regex must match a *literal*
// occurrence (i.e. quoted string in source), not a template that interpolates
// the period helper.
const FORBIDDEN_TITLE_LITERALS: Array<{ label: string; needle: RegExp }> = [
    {
        label: 'Facturación Real Hoy (must be derived from periodSuffix)',
        needle: /Facturaci[oó]n\s+Real\s+Hoy/i,
    },
    {
        label: 'Tasa de Entrega (7d) hardcoded (must use periodSuffixShort)',
        needle: /Tasa\s+de\s+Entrega\s*\(\s*7d\s*\)/i,
    },
    {
        label: 'Tasa de Entrega (7D) hardcoded',
        needle: /Tasa\s+de\s+Entrega\s*\(\s*7D\s*\)/,
    },
];

describe('Dashboard period-label regression guard', () => {
    it('does not hardcode "Hoy" or "(7d)" inside metric card titles', () => {
        for (const { label, needle } of FORBIDDEN_TITLE_LITERALS) {
            assert.ok(
                !needle.test(SOURCE),
                `Forbidden hardcoded label found in Dashboard.tsx: ${label}. ` +
                    `Use getPeriodSuffix(selectedRange, customRange) or ` +
                    `getPeriodSubtitle(...) from '@/utils/dateRangeLabels'.`,
            );
        }
    });

    it('imports the period-label helpers (otherwise the cards cannot be dynamic)', () => {
        assert.ok(
            /from\s+['"]@\/utils\/dateRangeLabels['"]/.test(SOURCE),
            'Dashboard.tsx must import getPeriodSuffix/getPeriodSubtitle from ' +
                "'@/utils/dateRangeLabels' so card labels reflect the active filter.",
        );
        assert.ok(
            /getPeriodSuffix\s*\(/.test(SOURCE),
            'Dashboard.tsx must call getPeriodSuffix to derive the card period label.',
        );
    });

    it('still reads selectedRange/customRange from useDateRange', () => {
        // Catches the silent regression where someone removes the destructuring
        // but leaves periodSuffix referenced (would throw at runtime).
        const useDateRangeCall = /useDateRange\(\)/.exec(SOURCE);
        assert.ok(
            useDateRangeCall,
            'Dashboard.tsx must call useDateRange() to access the active filter.',
        );
        assert.ok(
            /selectedRange/.test(SOURCE) && /customRange/.test(SOURCE),
            'Dashboard.tsx must destructure selectedRange and customRange ' +
                'from useDateRange() to feed the period-label helpers.',
        );
    });
});
