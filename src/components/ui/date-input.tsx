import * as React from "react";
import { format, setMonth, setYear, getMonth, getYear } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CaptionProps } from "react-day-picker";

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const FROM_YEAR = 2020;
const TO_YEAR = 2035;

const YEARS = Array.from({ length: TO_YEAR - FROM_YEAR + 1 }, (_, i) => FROM_YEAR + i);

interface DateInputProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string; // YYYY-MM-DD
  max?: string; // YYYY-MM-DD
  className?: string;
  id?: string;
  required?: boolean;
}

function DateInput({
  value,
  onChange,
  placeholder = "Seleccionar fecha...",
  disabled = false,
  min,
  max,
  className,
  id,
}: DateInputProps) {
  const [open, setOpen] = React.useState(false);

  const selectedDate = value ? new Date(value + "T00:00:00") : undefined;
  const minDate = min ? new Date(min + "T00:00:00") : undefined;
  const maxDate = max ? new Date(max + "T00:00:00") : undefined;

  const [month, setCurrentMonth] = React.useState<Date>(
    selectedDate ?? new Date()
  );

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"));
    } else {
      onChange("");
    }
    setOpen(false);
  };

  const isDateDisabled = (date: Date) => {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  };

  function CustomCaption({ displayMonth }: CaptionProps) {
    const currentMonthIndex = getMonth(displayMonth);
    const currentYear = getYear(displayMonth);

    const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      setCurrentMonth(setMonth(displayMonth, parseInt(e.target.value, 10)));
    };

    const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      setCurrentMonth(setYear(displayMonth, parseInt(e.target.value, 10)));
    };

    return (
      <div className="flex items-center justify-center gap-2 px-1 py-0.5">
        <select
          value={currentMonthIndex}
          onChange={handleMonthChange}
          className="text-sm bg-card border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer text-foreground"
        >
          {MONTHS_ES.map((name, idx) => (
            <option key={name} value={idx}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={currentYear}
          onChange={handleYearChange}
          className="text-sm bg-card border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer text-foreground"
        >
          {YEARS.map((yr) => (
            <option key={yr} value={yr}>
              {yr}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-10",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selectedDate
            ? format(selectedDate, "dd/MM/yyyy", { locale: es })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          disabled={isDateDisabled}
          initialFocus
          locale={es}
          month={month}
          onMonthChange={setCurrentMonth}
          showOutsideDays={false}
          components={{ Caption: CustomCaption }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DateInput };
