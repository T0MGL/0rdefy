import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { usePhoneAutoPasteSimple } from '@/hooks/usePhoneAutoPaste';
import { Customer } from '@/types';

export interface CustomerFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  accepts_marketing: boolean;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  notes?: string;
}

interface CustomerFormProps {
  customer?: Customer;
  onSubmit: (data: CustomerFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  showNotes?: boolean;
}

export function CustomerForm({
  customer,
  onSubmit,
  onCancel,
  isSubmitting,
  showNotes = false,
}: CustomerFormProps) {
  const [formData, setFormData] = useState<CustomerFormData>({
    first_name: customer?.first_name || '',
    last_name: customer?.last_name || '',
    email: customer?.email || '',
    phone: customer?.phone || '',
    accepts_marketing: customer?.accepts_marketing ?? true,
    address: customer?.address || '',
    city: customer?.city || '',
    state: customer?.state || '',
    postal_code: customer?.postal_code || '',
    country: customer?.country || '',
    notes: customer?.notes || '',
  });

  const handlePhonePaste = usePhoneAutoPasteSimple((fullPhone) => {
    setFormData(prev => ({ ...prev, phone: fullPhone }));
  });

  const update = (field: keyof CustomerFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section 1: Contacto */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Contacto
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="cf-first-name">Nombre</Label>
            <Input
              id="cf-first-name"
              placeholder="Juan"
              value={formData.first_name}
              onChange={(e) => update('first_name', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cf-last-name">Apellido</Label>
            <Input
              id="cf-last-name"
              placeholder="Perez"
              value={formData.last_name}
              onChange={(e) => update('last_name', e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cf-email">Email</Label>
          <Input
            id="cf-email"
            type="email"
            placeholder="cliente@ejemplo.com"
            value={formData.email}
            onChange={(e) => update('email', e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cf-phone">Telefono</Label>
          <Input
            id="cf-phone"
            type="tel"
            placeholder="+595981234567"
            value={formData.phone}
            onChange={(e) => update('phone', e.target.value)}
            onPaste={handlePhonePaste}
            required
          />
        </div>
      </fieldset>

      {/* Section 2: Direccion */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Direccion
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="cf-address">Direccion</Label>
            <Input
              id="cf-address"
              placeholder="Av. Mariscal Lopez 1234"
              value={formData.address}
              onChange={(e) => update('address', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cf-city">Ciudad</Label>
            <Input
              id="cf-city"
              placeholder="Asuncion"
              value={formData.city}
              onChange={(e) => update('city', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="cf-state">Departamento</Label>
            <Input
              id="cf-state"
              placeholder="Central"
              value={formData.state}
              onChange={(e) => update('state', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cf-postal-code">Codigo Postal</Label>
            <Input
              id="cf-postal-code"
              placeholder="1234"
              value={formData.postal_code}
              onChange={(e) => update('postal_code', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cf-country">Pais</Label>
            <Input
              id="cf-country"
              placeholder="Paraguay"
              value={formData.country}
              onChange={(e) => update('country', e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      {/* Section 3: Preferencias */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Preferencias
        </legend>
        <div className="flex items-center gap-3">
          <Switch
            id="cf-accepts-marketing"
            checked={formData.accepts_marketing}
            onCheckedChange={(checked) => update('accepts_marketing', checked)}
          />
          <Label htmlFor="cf-accepts-marketing" className="cursor-pointer">
            Acepta recibir comunicaciones de marketing
          </Label>
        </div>
      </fieldset>

      {/* Section 4: Notas (solo en modo edit) */}
      {showNotes && (
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Notas
          </legend>
          <div className="space-y-2">
            <Textarea
              id="cf-notes"
              placeholder="Notas internas sobre el cliente..."
              value={formData.notes}
              onChange={(e) => update('notes', e.target.value)}
              className="min-h-[100px] resize-y"
            />
          </div>
        </fieldset>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1 bg-primary hover:bg-primary/90">
          {isSubmitting ? 'Guardando...' : customer ? 'Actualizar' : 'Crear'}
        </Button>
      </div>
    </form>
  );
}
