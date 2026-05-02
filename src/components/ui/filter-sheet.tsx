/**
 * Mobile filter system: horizontal chips strip + "Filtros" button that
 * opens a bottom-sheet with multi-select sections.
 *
 * Replaces dropdown/popover desktop filters on mobile while keeping desktop
 * intact (consumers wrap with their own `lg:` visibility).
 *
 * Usage:
 *   <FilterChipStrip
 *     chips={[
 *       { id: 'all', label: 'Todos', active: filter === 'all', onClick: () => set('all') },
 *       { id: 'pending', label: 'Pendientes', count: 12, active: filter === 'pending', onClick: () => set('pending') },
 *     ]}
 *     onOpenSheet={() => setSheetOpen(true)}
 *     activeFilterCount={2}
 *   />
 *
 *   <FilterSheet
 *     open={sheetOpen}
 *     onOpenChange={setSheetOpen}
 *     onClear={clearAll}
 *     onApply={applyAll}
 *     activeCount={2}
 *   >
 *     <FilterSection title="Estado">
 *       <FilterCheckbox checked={...} onChange={...} label="Pendiente" />
 *     </FilterSection>
 *   </FilterSheet>
 */
import * as React from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from './responsive-dialog';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { tap } from '@/lib/haptics';

export interface FilterChip {
  id: string;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

interface FilterChipStripProps {
  chips: FilterChip[];
  onOpenSheet?: () => void;
  activeFilterCount?: number;
  className?: string;
}

export function FilterChipStrip({
  chips,
  onOpenSheet,
  activeFilterCount = 0,
  className,
}: FilterChipStripProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-4 px-4 py-2',
        'bg-background/85 backdrop-blur-md border-b border-border/40',
        className,
      )}
      role="toolbar"
      aria-label="Filtros rapidos"
    >
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {onOpenSheet && (
          <button
            type="button"
            onClick={() => {
              tap();
              onOpenSheet();
            }}
            className={cn(
              'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium',
              'border border-border/60 bg-card hover:border-primary/40 active:scale-[0.97] transition-all',
              activeFilterCount > 0 && 'border-primary/60 bg-primary/5 text-primary',
            )}
            aria-label={
              activeFilterCount > 0
                ? `Filtros (${activeFilterCount} activos)`
                : 'Abrir filtros'
            }
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>Filtros</span>
            {activeFilterCount > 0 && (
              <span
                className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums"
                aria-hidden="true"
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        )}
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => {
              tap();
              chip.onClick();
            }}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium',
              'border transition-all active:scale-[0.97]',
              chip.active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border/60 bg-card text-foreground hover:border-primary/40',
            )}
            aria-pressed={chip.active}
          >
            {chip.label}
            {typeof chip.count === 'number' && chip.count > 0 && (
              <span
                className={cn(
                  'tabular-nums text-[11px]',
                  chip.active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                {chip.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  onApply: () => void;
  activeCount?: number;
  title?: string;
  children: React.ReactNode;
}

export function FilterSheet({
  open,
  onOpenChange,
  onClear,
  onApply,
  activeCount = 0,
  title = 'Filtros',
  children,
}: FilterSheetProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopMaxWidth="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <div className="space-y-5">{children}</div>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="!flex-row gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              tap();
              onClear();
            }}
            className="flex-1 h-12 text-[15px]"
          >
            Limpiar
          </Button>
          <Button
            onClick={() => {
              tap();
              onApply();
              onOpenChange(false);
            }}
            className="flex-1 h-12 text-[15px]"
          >
            Aplicar{activeCount > 0 ? ` (${activeCount})` : ''}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
}

export function FilterSection({ title, children }: FilterSectionProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

interface FilterCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  count?: number;
  disabled?: boolean;
}

/**
 * 24px multi-select checkbox aligned with spec touch targets.
 */
export function FilterCheckbox({
  checked,
  onChange,
  label,
  count,
  disabled,
}: FilterCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        tap();
        onChange(!checked);
      }}
      className={cn(
        'w-full flex items-center gap-3 rounded-xl px-2 py-2.5 text-left',
        'transition-colors active:scale-[0.99]',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-muted/40 cursor-pointer',
      )}
    >
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
          checked
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-muted-foreground/40',
        )}
        aria-hidden="true"
      >
        {checked && <Check size={16} />}
      </span>
      <span className="flex-1 text-[15px]">{label}</span>
      {typeof count === 'number' && (
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </button>
  );
}

interface FilterRadioProps {
  checked: boolean;
  onChange: () => void;
  label: React.ReactNode;
  description?: string;
}

/**
 * Single-select radio variant. Same touch target, circular indicator.
 */
export function FilterRadio({
  checked,
  onChange,
  label,
  description,
}: FilterRadioProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={() => {
        tap();
        onChange();
      }}
      className={cn(
        'w-full flex items-start gap-3 rounded-xl px-2 py-2.5 text-left',
        'transition-colors hover:bg-muted/40 active:scale-[0.99]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          checked ? 'border-primary' : 'border-muted-foreground/40',
        )}
        aria-hidden="true"
      >
        {checked && <span className="h-3 w-3 rounded-full bg-primary" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px]">{label}</span>
        {description && (
          <span className="block text-[13px] text-muted-foreground mt-0.5">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
