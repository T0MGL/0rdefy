import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { PeriodType } from '@/utils/periodComparison';
import { Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface PeriodComparatorProps {
  value?: PeriodType;
  onPeriodChange: (period: PeriodType, customDates?: { start: Date; end: Date }) => void;
}

const periods = [
  { value: 'today-yesterday', label: 'Hoy vs Ayer' },
  { value: 'week-lastweek', label: 'Esta Semana vs Semana Pasada' },
  { value: 'month-lastmonth', label: 'Este Mes vs Mes Pasado' },
  { value: 'custom', label: 'Rango Personalizado' },
];

export function PeriodComparator({ value, onPeriodChange }: PeriodComparatorProps) {
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [showCalendar, setShowCalendar] = useState(false);

  const selected = value || 'week-lastweek';

  const handleChange = (newValue: string) => {
    const period = newValue as PeriodType;

    if (period !== 'custom') {
      onPeriodChange(period);
    } else {
      setShowCalendar(true);
    }
  };

  const handleApplyCustomDates = () => {
    if (startDate && endDate) {
      onPeriodChange('custom', { start: startDate, end: endDate });
      setShowCalendar(false);
    } else if (startDate && !endDate) {
      // Si solo hay fecha de inicio, usar el mismo día como fin
      onPeriodChange('custom', { start: startDate, end: startDate });
      setShowCalendar(false);
    }
  };

  const handleResetDates = () => {
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const getCustomLabel = () => {
    if (startDate && endDate) {
      if (format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd')) {
        return format(startDate, 'dd/MM/yyyy', { locale: es });
      }
      return `${format(startDate, 'dd/MM', { locale: es })} - ${format(endDate, 'dd/MM', { locale: es })}`;
    }
    return 'Rango Personalizado';
  };

  const currentLabel = selected === 'custom' && startDate
    ? getCustomLabel()
    : periods.find(p => p.value === selected)?.label || 'Seleccionar período';

  return (
    <div className="flex items-center gap-2">
      <Calendar size={18} className="text-muted-foreground" />
      <Select value={selected} onValueChange={handleChange}>
        <SelectTrigger className="w-[280px]">
          <SelectValue>{currentLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {periods.map(p => (
            <SelectItem key={p.value} value={p.value}>
              {p.value === 'custom' && startDate ? getCustomLabel() : p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Custom Date Picker Dialog */}
      {selected === 'custom' && (
        <Popover open={showCalendar} onOpenChange={setShowCalendar}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              {startDate ? getCustomLabel() : 'Seleccionar fechas'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-4" align="end">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Fecha de Inicio</p>
                <CalendarComponent
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  locale={es}
                  initialFocus
                />
              </div>

              {startDate && (
                <div>
                  <p className="text-sm font-medium mb-2">
                    Fecha de Fin <span className="text-muted-foreground text-xs">(opcional)</span>
                  </p>
                  <CalendarComponent
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    locale={es}
                    disabled={(date) => date < startDate}
                  />
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleApplyCustomDates} disabled={!startDate} className="flex-1">
                  Aplicar
                </Button>
                <Button onClick={handleResetDates} variant="outline">
                  Reset
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
