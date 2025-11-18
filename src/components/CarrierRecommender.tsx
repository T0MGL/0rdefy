import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { carriersService } from '@/services/carriers.service';
import { MapPin, Clock, DollarSign, TrendingUp, Trophy } from 'lucide-react';
import { useState, useEffect } from 'react';

export function CarrierRecommender() {
  const [destination, setDestination] = useState('');
  const [carriers, setCarriers] = useState<any[]>([]);

  useEffect(() => {
    const loadCarriers = async () => {
      try {
        const data = await carriersService.getAll();
        setCarriers(data);
      } catch (error) {
        console.error('Error loading carriers:', error);
      }
    };
    loadCarriers();
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-4">Comparador de Transportadoras</h2>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              placeholder="Ingresa el destino del pedido..."
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button>Comparar</Button>
        </div>
      </Card>

      <div className="grid gap-4">
        {carriers.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">No hay transportadoras disponibles</p>
            <p className="text-sm text-muted-foreground mt-2">Agrega transportadoras para comenzar a comparar</p>
          </Card>
        ) : (
          carriers.map((carrier) => (
            <Card key={carrier.id} className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-muted rounded flex items-center justify-center">
                    <span className="text-2xl font-bold text-primary">
                      {carrier.carrier_name?.charAt(0) || 'C'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{carrier.carrier_name}</h3>
                      <Badge variant={carrier.is_active ? 'default' : 'secondary'}>
                        {carrier.is_active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">ID: {carrier.id}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock size={14} />
                    <span className="text-xs">Tiempo Promedio</span>
                  </div>
                  <p className="text-lg font-semibold">0 días</p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <DollarSign size={14} />
                    <span className="text-xs">Costo Promedio</span>
                  </div>
                  <p className="text-lg font-semibold">Gs. 0</p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <TrendingUp size={14} />
                    <span className="text-xs">Tasa de Entrega</span>
                  </div>
                  <p className="text-lg font-semibold text-primary">0%</p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <TrendingUp size={14} />
                    <span className="text-xs">Entregas Totales</span>
                  </div>
                  <p className="text-lg font-semibold">0</p>
                </div>
              </div>

              <Button variant="outline" className="w-full mt-4">
                Seleccionar {carrier.carrier_name}
              </Button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
