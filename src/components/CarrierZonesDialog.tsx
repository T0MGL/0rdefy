// ================================================================
// CARRIER ZONES DIALOG
// ================================================================
// Manages zone-based pricing for a carrier
// ================================================================

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { carrierZonesService, CarrierZone } from '@/services/carrier-zones.service';
import { formatCurrency } from '@/utils/currency';
import { Plus, Pencil, Trash2, MapPin, Loader2 } from 'lucide-react';

interface CarrierZonesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carrierId: string;
  carrierName: string;
}

export function CarrierZonesDialog({ open, onOpenChange, carrierId, carrierName }: CarrierZonesDialogProps) {
  const [zones, setZones] = useState<CarrierZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingZone, setEditingZone] = useState<CarrierZone | null>(null);
  const [formData, setFormData] = useState({
    zone_name: '',
    zone_code: '',
    rate: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    if (open && carrierId) {
      loadZones();
    }
  }, [open, carrierId]);

  const loadZones = async () => {
    try {
      setLoading(true);
      const response = await carrierZonesService.getZonesByCarrier(carrierId);
      setZones(response.zones);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar las zonas',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingZone(null);
    setFormData({ zone_name: '', zone_code: '', rate: '' });
    setShowForm(true);
  };

  const handleEdit = (zone: CarrierZone) => {
    setEditingZone(zone);
    setFormData({
      zone_name: zone.zone_name,
      zone_code: zone.zone_code || '',
      rate: zone.rate.toString(),
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.zone_name || !formData.rate) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El nombre de zona y la tarifa son requeridos',
      });
      return;
    }

    try {
      if (editingZone) {
        await carrierZonesService.updateZone(editingZone.id, {
          zone_name: formData.zone_name,
          zone_code: formData.zone_code || undefined,
          rate: parseFloat(formData.rate),
        });
        toast({
          title: 'Zona actualizada',
          description: 'La zona ha sido actualizada exitosamente',
        });
      } else {
        await carrierZonesService.createZone(carrierId, {
          zone_name: formData.zone_name,
          zone_code: formData.zone_code || undefined,
          rate: parseFloat(formData.rate),
        });
        toast({
          title: 'Zona creada',
          description: 'La zona ha sido creada exitosamente',
        });
      }

      setShowForm(false);
      setFormData({ zone_name: '', zone_code: '', rate: '' });
      await loadZones();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo guardar la zona',
      });
    }
  };

  const handleDelete = async (zoneId: string) => {
    if (!confirm('¿Estás seguro de eliminar esta zona?')) return;

    try {
      await carrierZonesService.deleteZone(zoneId);
      toast({
        title: 'Zona eliminada',
        description: 'La zona ha sido eliminada exitosamente',
      });
      await loadZones();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo eliminar la zona',
      });
    }
  };

  // Import formatCurrency from utils instead of defining it locally
  // This ensures consistent currency formatting across the app

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Zonas y Tarifas - {carrierName}
          </DialogTitle>
          <DialogDescription>
            Define las tarifas de envío por zona geográfica
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Zones List */}
              {!showForm && (
                <div className="space-y-3">
                  {zones.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                      <MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No hay zonas configuradas</p>
                      <p className="text-sm">Agrega zonas para definir tarifas de envío</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {zones.map((zone) => (
                        <div
                          key={zone.id}
                          className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors dark:border-gray-800"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{zone.zone_name}</span>
                              {zone.zone_code && (
                                <Badge variant="outline" className="text-xs">
                                  {zone.zone_code}
                                </Badge>
                              )}
                              {!zone.is_active && (
                                <Badge variant="destructive" className="text-xs">
                                  Inactiva
                                </Badge>
                              )}
                            </div>
                            <div className="text-2xl font-bold text-primary mt-1">
                              {formatCurrency(zone.rate)}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(zone)}
                              className="hover:bg-blue-50 dark:hover:bg-blue-950"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(zone.id)}
                              className="hover:bg-red-50 dark:hover:bg-red-950 text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button onClick={handleCreate} className="w-full gap-2">
                    <Plus className="h-4 w-4" />
                    Agregar Zona
                  </Button>
                </div>
              )}

              {/* Zone Form */}
              {showForm && (
                <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg dark:border-gray-800">
                  <h3 className="font-semibold text-lg">
                    {editingZone ? 'Editar Zona' : 'Nueva Zona'}
                  </h3>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="zone_name">Nombre de Zona *</Label>
                      <Input
                        id="zone_name"
                        placeholder="Ej: Asunción, Interior"
                        value={formData.zone_name}
                        onChange={(e) => setFormData({ ...formData, zone_name: e.target.value })}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="zone_code">Código (opcional)</Label>
                      <Input
                        id="zone_code"
                        placeholder="Ej: ASU, INT"
                        value={formData.zone_code}
                        onChange={(e) => setFormData({ ...formData, zone_code: e.target.value })}
                        maxLength={20}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rate">Tarifa de Envío (₲) *</Label>
                    <Input
                      id="rate"
                      type="number"
                      placeholder="Ej: 30000"
                      value={formData.rate}
                      onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                      min="0"
                      step="1"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Costo de envío en Guaraníes
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowForm(false);
                        setFormData({ zone_name: '', zone_code: '', rate: '' });
                      }}
                      className="flex-1"
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" className="flex-1">
                      {editingZone ? 'Actualizar' : 'Crear'}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
