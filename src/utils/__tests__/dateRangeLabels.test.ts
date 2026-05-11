/**
 * Unit tests for the dashboard period-label helpers. These guarantee that the
 * dashboard card titles and subtitles always reflect the active filter, never
 * a stale literal like "Hoy" baked into JSX at build time.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getPeriodSuffix,
    getPeriodSubtitle,
} from '../dateRangeLabels';

describe('dateRangeLabels', () => {
    describe('getPeriodSuffix (verbose)', () => {
        it('maps today to "hoy"', () => {
            assert.equal(getPeriodSuffix('today'), 'hoy');
        });

        it('maps 7d to "últimos 7 días"', () => {
            assert.equal(getPeriodSuffix('7d'), 'últimos 7 días');
        });

        it('maps 30d to "últimos 30 días"', () => {
            assert.equal(getPeriodSuffix('30d'), 'últimos 30 días');
        });

        it('maps all to "desde siempre"', () => {
            assert.equal(getPeriodSuffix('all'), 'desde siempre');
        });

        it('renders a custom range as dd/mm – dd/mm', () => {
            const range = {
                from: new Date(2026, 0, 15),
                to: new Date(2026, 1, 28),
            };
            assert.equal(getPeriodSuffix('custom', range), '15/01 – 28/02');
        });

        it('falls back to "rango personalizado" when custom range is null', () => {
            assert.equal(
                getPeriodSuffix('custom', null),
                'rango personalizado',
            );
        });
    });

    describe('getPeriodSuffix (short)', () => {
        it('returns short tokens used inside card titles', () => {
            assert.equal(getPeriodSuffix('today', null, true), 'hoy');
            assert.equal(getPeriodSuffix('7d', null, true), '7d');
            assert.equal(getPeriodSuffix('30d', null, true), '30d');
            assert.equal(getPeriodSuffix('all', null, true), 'all');
        });
    });

    describe('getPeriodSubtitle', () => {
        it('prefixes the verbose suffix with "Período:"', () => {
            assert.equal(getPeriodSubtitle('today'), 'Período: hoy');
            assert.equal(getPeriodSubtitle('all'), 'Período: desde siempre');
        });

        it('handles custom ranges', () => {
            const range = {
                from: new Date(2026, 4, 1),
                to: new Date(2026, 4, 11),
            };
            assert.equal(
                getPeriodSubtitle('custom', range),
                'Período: 01/05 – 11/05',
            );
        });
    });
});
