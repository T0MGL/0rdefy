import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Store } from 'lucide-react';

interface CreateStoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const countries = [
  { code: 'PY', name: 'Paraguay', currency: 'PYG' },
  { code: 'AR', name: 'Argentina', currency: 'ARS' },
  { code: 'BR', name: 'Brasil', currency: 'BRL' },
  { code: 'CL', name: 'Chile', currency: 'CLP' },
  { code: 'CO', name: 'Colombia', currency: 'COP' },
  { code: 'PE', name: 'Perú', currency: 'PEN' },
  { code: 'UY', name: 'Uruguay', currency: 'UYU' },
  { code: 'BO', name: 'Bolivia', currency: 'BOB' },
  { code: 'EC', name: 'Ecuador', currency: 'USD' },
  { code: 'MX', name: 'México', currency: 'MXN' },
  { code: 'US', name: 'Estados Unidos', currency: 'USD' },
];

const currencies = [
  { code: 'USD', symbol: '$', name: 'Dólar estadounidense' },
  { code: 'PYG', symbol: 'Gs.', name: 'Guaraní paraguayo' },
  { code: 'ARS', symbol: '$', name: 'Peso argentino' },
  { code: 'BRL', symbol: 'R$', name: 'Real brasileño' },
  { code: 'CLP', symbol: '$', name: 'Peso chileno' },
  { code: 'COP', symbol: '$', name: 'Peso colombiano' },
  { code: 'PEN', symbol: 'S/', name: 'Sol peruano' },
  { code: 'UYU', symbol: '$U', name: 'Peso uruguayo' },
  { code: 'BOB', symbol: 'Bs.', name: 'Boliviano' },
  { code: 'MXN', symbol: '$', name: 'Peso mexicano' },
];

export function CreateStoreDialog({ open, onOpenChange }: CreateStoreDialogProps) {
  const { createStore } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    country: 'PY',
    currency: 'USD',
    taxRate: 10,
    adminFee: 0,
  });

  const [errors, setErrors] = useState({
    name: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const newErrors = {
      name: '',
    };

    if (!formData.name.trim()) {
      newErrors.name = 'El nombre de la tienda es requerido';
    }

    setErrors(newErrors);

    if (newErrors.name) {
      return;
    }

    setLoading(true);

    try {
      const result = await createStore({
        name: formData.name.trim(),
        country: formData.country,
        currency: formData.currency,
        taxRate: formData.taxRate,
        adminFee: formData.adminFee,
      });

      if (result.success) {
        toast({
          title: 'Tienda creada',
          description: 'Tu nueva tienda ha sido creada exitosamente',
        });

        // Reset form
        setFormData({
          name: '',
          country: 'PY',
          currency: 'USD',
          taxRate: 10,
          adminFee: 0,
        });

        onOpenChange(false);
      } else {
        toast({
          title: 'Error',
          description: result.error || 'No se pudo crear la tienda',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Ocurrió un error inesperado',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCountryChange = (country: string) => {
    const selectedCountry = countries.find(c => c.code === country);
    setFormData({
      ...formData,
      country,
      currency: selectedCountry?.currency || 'USD',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Crear Nueva Tienda
          </DialogTitle>
          <DialogDescription>
            Completa los detalles de tu nueva tienda para comenzar a gestionar tus ventas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          {/* Store Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Nombre de la tienda <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Mi Tienda Online"
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
                setErrors({ ...errors, name: '' });
              }}
              className={errors.name ? 'border-destructive' : ''}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Country */}
          <div className="space-y-2">
            <Label htmlFor="country">País</Label>
            <Select
              value={formData.country}
              onValueChange={handleCountryChange}
            >
              <SelectTrigger id="country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countries.map((country) => (
                  <SelectItem key={country.code} value={country.code}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Currency */}
          <div className="space-y-2">
            <Label htmlFor="currency">Moneda</Label>
            <Select
              value={formData.currency}
              onValueChange={(value) =>
                setFormData({ ...formData, currency: value })
              }
            >
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((currency) => (
                  <SelectItem key={currency.code} value={currency.code}>
                    {currency.symbol} {currency.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tax Rate */}
          <div className="space-y-2">
            <Label htmlFor="taxRate">Tasa de impuesto (%)</Label>
            <Input
              id="taxRate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={formData.taxRate}
              onChange={(e) =>
                setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground">
              IVA u otro impuesto aplicable a las ventas
            </p>
          </div>

          {/* Admin Fee */}
          <div className="space-y-2">
            <Label htmlFor="adminFee">Comisión administrativa (%)</Label>
            <Input
              id="adminFee"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={formData.adminFee}
              onChange={(e) =>
                setFormData({ ...formData, adminFee: parseFloat(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Comisión extra que se aplicará a los pedidos
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando...
                </>
              ) : (
                'Crear Tienda'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
