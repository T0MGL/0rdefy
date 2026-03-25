import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MetricCard } from '@/components/MetricCard';
import { CarrierTable } from '@/components/carriers/CarrierTable';
import { CarrierZonesDialog } from '@/components/CarrierZonesDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ExportButton } from '@/components/ExportButton';
import { useToast } from '@/hooks/use-toast';
import { useHighlight } from '@/hooks/useHighlight';
import { usePhoneAutoPasteSimple } from '@/hooks/usePhoneAutoPaste';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { onboardingService } from '@/services/onboarding.service';
import { carriersService, Carrier } from '@/services/carriers.service';
import { Plus, Package, TrendingUp, Clock, Star, Search } from 'lucide-react';
import { carriersExportColumns } from '@/utils/exportConfigs';
import { logger } from '@/utils/logger';
import apiClient from '@/services/api.client';

interface CourierPerformanceStat {
  courier_id: string;
  courier_name: string;
  total_deliveries: number;
  successful_deliveries: number;
  failed_deliveries: number;
  delivery_rate: number;
}

interface CarrierFormData {
  name: string;
  phone: string;
  email: string;
  notes: string;
  carrier_type: string;
  is_active: boolean;
}

function CarrierForm({ carrier, onSubmit, onCancel }: { carrier?: Carrier; onSubmit: (data: CarrierFormData) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: carrier?.name || '',
    phone: carrier?.phone || '',
    email: carrier?.email || '',
    notes: carrier?.notes || '',
    carrier_type: carrier?.carrier_type || 'internal',
    is_active: carrier?.is_active ?? true,
  });

  // Auto-format phone on paste
  const handlePhonePaste = usePhoneAutoPasteSimple((fullPhone) => {
    setFormData({ ...formData, phone: fullPhone });
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Nombre del Repartidor *</label>
        <Input
          placeholder="Ej: Juan Pérez"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="carrier_type">Tipo de Repartidor *</Label>
        <Select
          value={formData.carrier_type}
          onValueChange={(value) => setFormData({ ...formData, carrier_type: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="internal">Interno (Rendición Diaria)</SelectItem>
            <SelectItem value="external">Externo (Liquidación Semanal)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Interno: cobra efectivo y rinde diario. Externo: cobra y liquida semanalmente.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Teléfono *</label>
          <Input
            type="tel"
            placeholder="+595981234567"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            onPaste={handlePhonePaste}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <Input
            type="email"
            placeholder="repartidor@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Notas</label>
        <Input
          placeholder="Ej: Conoce bien la zona norte"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
          className="rounded border-gray-300"
        />
        <label htmlFor="is_active" className="text-sm font-medium">
          Repartidor activo
        </label>
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90">
          {carrier ? 'Actualizar' : 'Crear'}
        </Button>
      </div>
    </form>
  );
}

export default function Carriers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { isHighlighted } = useHighlight();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [performanceFilter, setPerformanceFilter] = useState<'all' | 'poor-performance'>('all');
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [dbCarriers, setDbCarriers] = useState<Carrier[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState<Carrier | null>(null);
  const [performanceStats, setPerformanceStats] = useState<CourierPerformanceStat[] | null>(null);
  const [zonesDialogOpen, setZonesDialogOpen] = useState(false);
  const [zonesCarrier, setZonesCarrier] = useState<{ id: string; name: string } | null>(null);

  // Refs for memory leak prevention
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const loadCarriers = useCallback(async () => {
    const data = await carriersService.getAll();
    if (!isMountedRef.current) return;
    setDbCarriers(data);
    setCarriers(data);
  }, []);

  const loadPerformanceStats = useCallback(async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await apiClient.get('/couriers/performance/all', {
        signal: controller.signal,
      });
      if (!isMountedRef.current || controller.signal.aborted) return;
      setPerformanceStats(response.data.data || []);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const axiosErr = error as { code?: string };
      if (axiosErr.code === 'ERR_CANCELED') return;
      logger.error('Error loading performance stats:', error);
    }
  }, []);

  useEffect(() => {
    loadCarriers();
    loadPerformanceStats();
  }, [loadCarriers, loadPerformanceStats]);

  // Process URL query parameters for filtering and navigation from notifications
  useEffect(() => {
    const filter = searchParams.get('filter');
    const highlightId = searchParams.get('highlight');

    // Apply filter from URL
    if (filter) {
      switch (filter) {
        case 'poor-performance':
          setPerformanceFilter('poor-performance');
          break;
        default:
          setPerformanceFilter('all');
          break;
      }

      // Clean up URL after applying filter (keep highlight if present)
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('filter');
      if (newParams.toString() !== searchParams.toString()) {
        setSearchParams(newParams, { replace: true });
      }
    }

    // Validate highlighted carrier exists after data loads
    if (highlightId && dbCarriers.length > 0) {
      const carrierExists = dbCarriers.some(c => c.id === highlightId);
      if (!carrierExists) {
        // Carrier not found - show toast and clean URL
        toast({
          title: 'Transportadora no encontrada',
          description: 'La transportadora a la que intentas acceder ya no existe o fue eliminada.',
          variant: 'destructive',
        });
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('highlight');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, setSearchParams, dbCarriers, toast]);

  const handleCreate = () => {
    setSelectedCarrier(null);
    setDialogOpen(true);
  };

  const handleEdit = (carrier: Carrier) => {
    setSelectedCarrier(carrier);
    setDialogOpen(true);
  };

  const handleManageZones = (carrier: Carrier) => {
    setZonesCarrier({ id: carrier.id, name: carrier.name || carrier.carrier_name || '' });
    setZonesDialogOpen(true);
  };

  const handleSubmit = async (data: CarrierFormData) => {
    try {
      if (selectedCarrier) {
        await carriersService.update(selectedCarrier.id, data);
        toast({
          title: 'Repartidor actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        await carriersService.create(data);
        toast({
          title: 'Repartidor creado',
          description: 'El repartidor ha sido registrado exitosamente.',
        });
        // Mark first action completed (hides the onboarding tip)
        onboardingService.markFirstActionCompleted('carriers');
      }
      await Promise.all([loadCarriers(), loadPerformanceStats()]);
      setDialogOpen(false);
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Ocurrio un error al guardar el repartidor.',
        variant: 'destructive',
      });
    }
  };

  // Merge carriers with their performance stats
  const carriersWithStats = useMemo(() => carriers.map(carrier => {
    const stats = performanceStats?.find((s) => s.courier_id === carrier.id);
    return {
      ...carrier,
      total_deliveries: stats?.total_deliveries || 0,
      successful_deliveries: stats?.successful_deliveries || 0,
      failed_deliveries: stats?.failed_deliveries || 0,
      delivery_rate: stats?.delivery_rate || 0,
    };
  }), [carriers, performanceStats]);

  const filteredCarriers = useMemo(() => carriersWithStats.filter((carrier) => {
    const matchesSearch = (carrier.name || carrier.carrier_name || '')
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && carrier.is_active) ||
      (statusFilter === 'inactive' && !carrier.is_active);
    // Apply performance filter from URL notifications
    const matchesPerformance =
      performanceFilter === 'all' ||
      (performanceFilter === 'poor-performance' && (carrier.delivery_rate || 0) < 80);
    return matchesSearch && matchesStatus && matchesPerformance;
  }), [carriersWithStats, searchTerm, statusFilter, performanceFilter]);

  // Calculate global metrics
  const { totalDeliveries, avgDeliveryRate, avgRating } = useMemo(() => {
    const total = carriersWithStats.reduce((sum, c) => sum + (c.total_deliveries || 0), 0);

    const withDeliveries = carriersWithStats.filter(c => (c.total_deliveries || 0) > 0);
    const avgRate = withDeliveries.length > 0
      ? withDeliveries.reduce((sum, c) => sum + (c.delivery_rate || 0), 0) / withDeliveries.length
      : 0;

    const withRatings = carriersWithStats.filter(c => c.average_rating > 0);
    const avgRat = withRatings.length > 0
      ? withRatings.reduce((sum, c) => sum + (c.average_rating || 0), 0) / withRatings.length
      : 0;

    return { totalDeliveries: total, avgDeliveryRate: avgRate, avgRating: avgRat };
  }, [carriersWithStats]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([loadCarriers(), loadPerformanceStats()]);
  }, [loadCarriers, loadPerformanceStats]);

  return (
    <div className="space-y-6">
      <FirstTimeWelcomeBanner
        moduleId="carriers"
        title="¡Bienvenido a Repartidores!"
        description="Gestiona tus couriers y motoristas. Asigna pedidos y analiza su rendimiento de entregas."
        tips={['Agrega repartidores', 'Asigna zonas de entrega', 'Ve métricas de rendimiento']}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">Repartidores</h2>
          <p className="text-muted-foreground text-sm">
            Gestiona tus repartidores y analiza su rendimiento en las entregas
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={carriersWithStats}
            filename="repartidores"
            columns={carriersExportColumns}
            title="Repartidores - Ordefy"
            variant="outline"
          />
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => navigate('/courier-performance')}
          >
            Ver Rendimiento
          </Button>
          <Button
            onClick={handleCreate}
            className="gap-2 cursor-pointer hover:scale-105 hover:bg-primary/90 active:scale-95 transition-all duration-200 z-50 relative"
          >
            <Plus size={18} />
            Agregar Repartidor
          </Button>
        </div>
      </div>

      {/* Global Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total de Envíos"
          value={totalDeliveries.toString()}
          icon={<Package className="text-primary" size={20} />}
        />
        <MetricCard
          title="Tasa de Entrega Promedio"
          value={`${avgDeliveryRate.toFixed(1)}%`}
          icon={<TrendingUp className="text-primary" size={20} />}
        />
        <MetricCard
          title="Repartidores Activos"
          value={carriersWithStats.filter(c => c.is_active).length.toString()}
          icon={<Clock className="text-blue-600" size={20} />}
        />
        <MetricCard
          title="Rating Promedio"
          value={avgRating > 0 ? `${avgRating.toFixed(1)} ⭐` : 'Sin ratings'}
          icon={<Star className="text-yellow-500 fill-yellow-500" size={20} />}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Buscar repartidor por nombre..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-card"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px] bg-card">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="inactive">Inactivo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Performance Filter Indicator */}
      {performanceFilter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtrando por:</span>
          <Badge
            variant="secondary"
            className="cursor-pointer hover:bg-destructive/20"
            onClick={() => setPerformanceFilter('all')}
          >
            Bajo rendimiento (&lt;80%)
            <span className="ml-1">×</span>
          </Badge>
          <span className="text-sm text-muted-foreground">
            ({filteredCarriers.length} de {carriersWithStats.length} transportadoras)
          </span>
        </div>
      )}

      {/* Carriers Table */}
      <CarrierTable
        carriers={filteredCarriers}
        onEdit={handleEdit}
        onManageZones={handleManageZones}
        onRefresh={handleRefresh}
        isHighlighted={isHighlighted}
      />

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedCarrier ? 'Editar Repartidor' : 'Nuevo Repartidor'}
            </DialogTitle>
          </DialogHeader>
          <CarrierForm
            carrier={selectedCarrier || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Zones Dialog */}
      {zonesCarrier && (
        <CarrierZonesDialog
          open={zonesDialogOpen}
          onOpenChange={setZonesDialogOpen}
          carrierId={zonesCarrier.id}
          carrierName={zonesCarrier.name}
        />
      )}
    </div>
  );
}
