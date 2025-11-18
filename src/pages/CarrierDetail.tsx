import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { carriersService } from '@/services/carriers.service';
import {
  ArrowLeft,
  Star,
  Phone,
  Mail,
  MapPin,
  TrendingUp,
  Clock,
  DollarSign,
  Package,
  AlertCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export default function CarrierDetail() {
  const { id } = useParams();
  const [carrier, setCarrier] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCarrier = async () => {
      try {
        const carriers = await carriersService.getAll();
        const found = carriers.find((c) => c.id === id);
        setCarrier(found);
      } catch (error) {
        console.error('Error loading carrier:', error);
      } finally {
        setLoading(false);
      }
    };
    loadCarrier();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!carrier) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="mx-auto text-muted-foreground mb-4" size={48} />
          <h3 className="text-xl font-semibold mb-2">Transportadora no encontrada</h3>
          <Link to="/carriers">
            <Button variant="outline" className="mt-4">
              <ArrowLeft size={16} className="mr-2" />
              Volver a Transportadoras
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/carriers">
          <Button variant="outline" size="icon">
            <ArrowLeft size={18} />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
              <span className="text-2xl font-bold text-primary">
                {carrier.carrier_name?.charAt(0) || 'C'}
              </span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-card-foreground">{carrier.carrier_name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={carrier.is_active ? 'default' : 'secondary'}>
                  {carrier.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <Button>Editar Transportadora</Button>
      </div>

      {/* Contact Info */}
      <Card className="p-6 bg-card">
        <h3 className="font-semibold mb-4 text-card-foreground">Información de Transportadora</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Package size={18} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Nombre</p>
              <p className="text-sm font-medium text-card-foreground">{carrier.carrier_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <AlertCircle size={18} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estado</p>
              <p className="text-sm font-medium text-card-foreground">
                {carrier.is_active ? 'Activa' : 'Inactiva'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="performance">Rendimiento</TabsTrigger>
          <TabsTrigger value="pricing">Tarifas</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <Package className="text-primary" size={20} />
                <span className="text-sm text-muted-foreground">Total Envíos</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">0</p>
            </Card>
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="text-primary" size={20} />
                <span className="text-sm text-muted-foreground">Tasa de Entrega</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">0%</p>
            </Card>
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <Clock className="text-blue-600" size={20} />
                <span className="text-sm text-muted-foreground">Tiempo Promedio</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">0 días</p>
            </Card>
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="text-purple-600" size={20} />
                <span className="text-sm text-muted-foreground">Costo/Envío</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">Gs. 0</p>
            </Card>
          </div>

          {/* Shipment Status */}
          <Card className="p-6 bg-card">
            <h3 className="font-semibold mb-4 text-card-foreground">Estado de Envíos</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Entregados</p>
                <p className="text-2xl font-bold text-primary">0</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Retrasados</p>
                <p className="text-2xl font-bold text-yellow-600">0</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Devueltos</p>
                <p className="text-2xl font-bold text-orange-600">0</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Perdidos</p>
                <p className="text-2xl font-bold text-red-600">0</p>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <Card className="p-6 bg-card">
            <h3 className="font-semibold mb-6 text-card-foreground">Rendimiento por Región</h3>
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">No hay datos de rendimiento disponibles</p>
            </div>
          </Card>

          {/* Regional Details Table */}
          <Card className="p-6 bg-card">
            <h3 className="font-semibold mb-4 text-card-foreground">Detalles por Región</h3>
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">No hay datos regionales disponibles</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-6">
          <Card className="p-6 bg-card">
            <h3 className="font-semibold mb-6 text-card-foreground">Estructura de Tarifas</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Tarifa Base</p>
                <p className="text-2xl font-bold text-card-foreground">Gs. 0</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Precio por Kg</p>
                <p className="text-2xl font-bold text-card-foreground">Gs. 0</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Precio por Km</p>
                <p className="text-2xl font-bold text-card-foreground">Gs. 0</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Seguro</p>
                <p className="text-2xl font-bold text-card-foreground">No disponible</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-card">
            <h3 className="font-semibold mb-4 text-card-foreground">Ingresos Históricos</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Ingresos Totales</p>
                <p className="text-3xl font-bold text-primary">Gs. 0</p>
              </div>
              <div className="pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground mb-2">Último Envío</p>
                <p className="text-lg font-medium text-card-foreground">Sin envíos registrados</p>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
