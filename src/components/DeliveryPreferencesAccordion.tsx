import { useState, useEffect } from 'react';
import { format, addDays, isAfter, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Calendar as CalendarIcon,
  Clock,
  MessageSquare,
  X,
  Check,
} from 'lucide-react';

// Types
export interface DeliveryPreferences {
  not_before_date?: string | null;  // ISO date string (YYYY-MM-DD)
  preferred_time_slot?: 'any' | 'morning' | 'afternoon' | 'evening' | null;
  delivery_notes?: string | null;
}

interface DeliveryPreferencesAccordionProps {
  value: DeliveryPreferences | null;
  onChange: (preferences: DeliveryPreferences | null) => void;
  disabled?: boolean;
  className?: string;
}

// Time slot labels in Spanish
const TIME_SLOT_LABELS: Record<string, { label: string; description: string }> = {
  any: { label: 'Cualquier horario', description: 'Sin preferencia de horario' },
  morning: { label: 'Mañana', description: '8:00 - 12:00' },
  afternoon: { label: 'Tarde', description: '14:00 - 18:00' },
  evening: { label: 'Noche', description: '18:00 - 21:00' },
};

/**
 * DeliveryPreferencesAccordion - Collapsible section for delivery scheduling preferences
 *
 * Features:
 * - Optional "not before" date picker (min: tomorrow)
 * - Preferred time slot selector
 * - Free-text delivery notes for the courier
 * - Shows badge summary when collapsed and has preferences
 * - Seamlessly integrates with OrderConfirmationDialog
 */
export function DeliveryPreferencesAccordion({
  value,
  onChange,
  disabled = false,
  className,
}: DeliveryPreferencesAccordionProps) {
  // Local state for form fields
  const [notBeforeDate, setNotBeforeDate] = useState<Date | undefined>(
    value?.not_before_date ? new Date(value.not_before_date) : undefined
  );
  const [timeSlot, setTimeSlot] = useState<string>(value?.preferred_time_slot || 'any');
  const [notes, setNotes] = useState<string>(value?.delivery_notes || '');
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Check if any preference is set
  const hasPreferences = Boolean(
    notBeforeDate ||
    (timeSlot && timeSlot !== 'any') ||
    (notes && notes.trim())
  );

  // Generate summary text for badge
  const getSummary = (): string => {
    const parts: string[] = [];

    if (notBeforeDate) {
      parts.push(`Desde ${format(notBeforeDate, 'dd/MM', { locale: es })}`);
    }

    if (timeSlot && timeSlot !== 'any') {
      parts.push(TIME_SLOT_LABELS[timeSlot]?.label || timeSlot);
    }

    if (notes && notes.trim()) {
      const truncated = notes.length > 20 ? notes.substring(0, 17) + '...' : notes;
      parts.push(`"${truncated}"`);
    }

    return parts.join(' • ');
  };

  // Sync local state with parent value
  useEffect(() => {
    if (value) {
      setNotBeforeDate(value.not_before_date ? new Date(value.not_before_date) : undefined);
      setTimeSlot(value.preferred_time_slot || 'any');
      setNotes(value.delivery_notes || '');
    } else {
      setNotBeforeDate(undefined);
      setTimeSlot('any');
      setNotes('');
    }
  }, [value]);

  // Notify parent of changes
  const handleChange = (updates: Partial<DeliveryPreferences>) => {
    const newDate = 'not_before_date' in updates ? updates.not_before_date : (notBeforeDate ? format(notBeforeDate, 'yyyy-MM-dd') : null);
    const newSlot = 'preferred_time_slot' in updates ? updates.preferred_time_slot : timeSlot;
    const newNotes = 'delivery_notes' in updates ? updates.delivery_notes : notes;

    // If everything is empty/default, return null
    if (!newDate && (!newSlot || newSlot === 'any') && (!newNotes || !newNotes.trim())) {
      onChange(null);
      return;
    }

    onChange({
      not_before_date: newDate,
      preferred_time_slot: newSlot === 'any' ? null : newSlot as DeliveryPreferences['preferred_time_slot'],
      delivery_notes: newNotes?.trim() || null,
    });
  };

  // Handle date selection
  const handleDateSelect = (date: Date | undefined) => {
    setNotBeforeDate(date);
    setDatePickerOpen(false);
    handleChange({
      not_before_date: date ? format(date, 'yyyy-MM-dd') : null
    });
  };

  // Clear the date
  const handleClearDate = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNotBeforeDate(undefined);
    handleChange({ not_before_date: null });
  };

  // Handle time slot change
  const handleTimeSlotChange = (slot: string) => {
    setTimeSlot(slot);
    handleChange({ preferred_time_slot: slot as DeliveryPreferences['preferred_time_slot'] });
  };

  // Handle notes change (debounced via onBlur)
  const handleNotesBlur = () => {
    handleChange({ delivery_notes: notes.trim() || null });
  };

  // Minimum date is tomorrow
  const minDate = addDays(startOfDay(new Date()), 1);

  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      <Accordion type="single" collapsible disabled={disabled}>
        <AccordionItem value="delivery-preferences" className="border-0">
          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50 rounded-t-lg transition-colors">
            <div className="flex items-center gap-2 text-sm">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Preferencias de entrega</span>
              <span className="text-muted-foreground font-normal">(opcional)</span>

              {hasPreferences && (
                <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  <Check className="h-3 w-3 mr-1" />
                  Configurado
                </Badge>
              )}
            </div>
          </AccordionTrigger>

          {/* Summary when collapsed */}
          {hasPreferences && (
            <div className="px-4 pb-2 -mt-2">
              <p className="text-xs text-muted-foreground pl-6">
                {getSummary()}
              </p>
            </div>
          )}

          <AccordionContent className="px-4 pb-4">
            <div className="space-y-4 pt-2">
              {/* Not Before Date */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4" />
                  No entregar antes del
                </Label>
                <p className="text-xs text-muted-foreground">
                  El cliente estará de viaje o no disponible hasta esta fecha
                </p>
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !notBeforeDate && "text-muted-foreground"
                      )}
                      disabled={disabled}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {notBeforeDate ? (
                        <span className="flex items-center justify-between w-full">
                          <span>{format(notBeforeDate, "PPP", { locale: es })}</span>
                          <X
                            className="h-4 w-4 ml-2 hover:text-destructive transition-colors"
                            onClick={handleClearDate}
                          />
                        </span>
                      ) : (
                        "Seleccionar fecha..."
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={notBeforeDate}
                      onSelect={handleDateSelect}
                      disabled={(date) => !isAfter(date, new Date())}
                      initialFocus
                      locale={es}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Preferred Time Slot */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4" />
                  Horario preferido
                </Label>
                <Select
                  value={timeSlot}
                  onValueChange={handleTimeSlotChange}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar horario..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIME_SLOT_LABELS).map(([slot, { label, description }]) => (
                      <SelectItem key={slot} value={slot}>
                        <div className="flex items-center justify-between w-full gap-4">
                          <span>{label}</span>
                          <span className="text-xs text-muted-foreground">
                            {description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Delivery Notes */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4" />
                  Notas para el repartidor
                </Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={handleNotesBlur}
                  placeholder="Ej: Dejar con el portero, llamar 10 min antes, tocar timbre 2B..."
                  className="resize-none"
                  rows={2}
                  maxLength={500}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {notes.length}/500
                </p>
              </div>

              {/* Preview summary */}
              {hasPreferences && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-900 dark:text-blue-100 font-medium flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    Preferencias configuradas
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    {getSummary()}
                  </p>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export default DeliveryPreferencesAccordion;
