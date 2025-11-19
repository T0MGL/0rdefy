import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetricCard } from '@/components/MetricCard';
import { CarrierTable } from '@/components/carriers/CarrierTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExportButton } from '@/components/ExportButton';
import { useToast } from '@/hooks/use-toast';
import { carriersService, Carrier } from '@/services/carriers.service';
import { Plus, Package, TrendingUp, Clock, Star, Search } from 'lucide-react';
import { carriersExportColumns } from '@/utils/exportConfigs';

// Form Component
function CarrierForm({ carrier, onSubmit, onCancel }: { carrier?: Carrier; onSubmit: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: carrier?.name || '',
    phone: carrier?.phone || '',
    email: carrier?.email || '',
    notes: carrier?.notes || '',
    is_active: carrier?.is_active ?? true,
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Teléfono *</label>
          <Input
            type="tel"
            placeholder="+595981234567"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
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
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [carriers, setCarriers] = useState<any[]>([]);
  const [dbCarriers, setDbCarriers] = useState<Carrier[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState<Carrier | null>(null);
  const [performanceStats, setPerformanceStats] = useState<any>(null);

  useEffect(() => {
    loadCarriers();
    loadPerformanceStats();
  }, []);

  const loadCarriers = async () => {
    const data = await carriersService.getAll();
    setDbCarriers(data);
    // Map DB carriers to display format
    setCarriers(data);
  };

  const loadPerformanceStats = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/couriers/performance/all`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });
      if (response.ok) {
        const data = await response.json();
        setPerformanceStats(data.data || []);
      }
    } catch (error) {
      console.error('Error loading performance stats:', error);
    }
  };

  const handleCreate = () => {
    setSelectedCarrier(null);
    setDialogOpen(true);
  };

  const handleEdit = (carrier: Carrier) => {
    setSelectedCarrier(carrier);
    setDialogOpen(true);
  };

  const handleSubmit = async (data: any) => {
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
      }
      await loadCarriers();
      await loadPerformanceStats();
      setDialogOpen(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Ocurrió un error al guardar el repartidor.',
        variant: 'destructive',
      });
    }
  };

  // Merge carriers with their performance stats
  const carriersWithStats = carriers.map(carrier => {
    const stats = performanceStats?.find((s: any) => s.courier_id === carrier.id);
    return {
      ...carrier,
      total_deliveries: stats?.total_deliveries || 0,
      successful_deliveries: stats?.successful_deliveries || 0,
      failed_deliveries: stats?.failed_deliveries || 0,
      delivery_rate: stats?.delivery_rate || 0,
    };
  });

  const filteredCarriers = carriersWithStats.filter((carrier) => {
    const matchesSearch = (carrier.name || carrier.carrier_name || '')
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && carrier.is_active) ||
      (statusFilter === 'inactive' && !carrier.is_active);
    return matchesSearch && matchesStatus;
  });

  // Calculate global metrics
  const totalDeliveries = carriersWithStats.reduce((sum, c) => sum + (c.total_deliveries || 0), 0);
  const avgDeliveryRate = carriersWithStats.length > 0
    ? carriersWithStats.reduce((sum, c) => sum + (c.delivery_rate || 0), 0) / carriersWithStats.length
    : 0;

  // Calculate average rating (only from carriers with ratings)
  const carriersWithRatings = carriersWithStats.filter(c => c.average_rating > 0);
  const avgRating = carriersWithRatings.length > 0
    ? carriersWithRatings.reduce((sum, c) => sum + (c.average_rating || 0), 0) / carriersWithRatings.length
    : 0;

  return (
    <div className="space-y-6">
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

      {/* Carriers Table */}
      <CarrierTable
        carriers={filteredCarriers}
        onEdit={handleEdit}
        onRefresh={async () => {
          await loadCarriers();
          await loadPerformanceStats();
        }}
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
    </div>
  );
}
