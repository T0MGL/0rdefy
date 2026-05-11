// Single source of truth for human-friendly period labels rendered alongside
// dashboard metric cards. The previous implementation hardcoded "Hoy" / "(7d)"
// into the card titles, which silently lied about the active filter when the
// user picked "Desde siempre" or any other range. Cards now ask this util for
// the suffix and subtitle that match the currently selected period.
//
// Two shapes:
//   - getPeriodSuffix("Tasa de Entrega") -> "Tasa de Entrega (hoy)" etc. Used
//     inline in the title to keep older muscle memory.
//   - getPeriodSubtitle()                -> "Periodo: desde siempre". Used
//     under the value as secondary text.
//
// Both stay locale-aware (Spanish) because the rest of the dashboard is
// Spanish; if we ever ship i18n we route through this file.

import type { DateRangeValue, DateRange } from '@/contexts/DateRangeContext';

const SUFFIX_MAP: Record<Exclude<DateRangeValue, 'custom'>, string> = {
    today: 'hoy',
    '7d': 'últimos 7 días',
    '30d': 'últimos 30 días',
    all: 'desde siempre',
};

const SHORT_SUFFIX_MAP: Record<Exclude<DateRangeValue, 'custom'>, string> = {
    today: 'hoy',
    '7d': '7d',
    '30d': '30d',
    all: 'all',
};

function formatCustomRange(range: DateRange | null): string {
    if (!range) return 'rango personalizado';
    const fmt = (d: Date) =>
        `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `${fmt(range.from)} – ${fmt(range.to)}`;
}

export function getPeriodSuffix(
    selectedRange: DateRangeValue,
    customRange: DateRange | null = null,
    short = false,
): string {
    if (selectedRange === 'custom') return formatCustomRange(customRange);
    const map = short ? SHORT_SUFFIX_MAP : SUFFIX_MAP;
    return map[selectedRange];
}

export function getPeriodSubtitle(
    selectedRange: DateRangeValue,
    customRange: DateRange | null = null,
): string {
    return `Período: ${getPeriodSuffix(selectedRange, customRange)}`;
}
