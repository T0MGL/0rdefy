import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Order } from '@/types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issue with Vite
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  iconRetinaUrl: iconRetina,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom markers by status
const getMarkerIcon = (status: Order['status']) => {
  const colors: Record<string, string> = {
    preparing: '🔵',
    out_for_delivery: '🚚',
    delivered: '✅',
    delivery_failed: '❌',
    confirmed: '🟡',
  };

  const emoji = colors[status] || '📍';

  return L.divIcon({
    html: `<div style="font-size: 24px;">${emoji}</div>`,
    className: 'custom-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
};

interface DeliveryMapProps {
  orders: Order[];
  center?: [number, number];
  zoom?: number;
  height?: string;
}

// Component to recenter map when orders change
function MapUpdater({ orders }: { orders: Order[] }) {
  const map = useMap();

  useEffect(() => {
    if (orders.length > 0) {
      const bounds = orders
        .filter(o => o.latitude && o.longitude)
        .map(o => [o.latitude!, o.longitude!] as [number, number]);

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [orders, map]);

  return null;
}

export function DeliveryMap({
  orders,
  center = [-25.2637, -57.5759], // Asunción, Paraguay por defecto
  zoom = 12,
  height = '500px'
}: DeliveryMapProps) {
  const [isMounted, setIsMounted] = useState(false);

  // Only render map on client side
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const ordersWithLocation = orders.filter(o => o.latitude && o.longitude);

  if (!isMounted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Mapa de Entregas</CardTitle>
          <CardDescription>Cargando mapa...</CardDescription>
        </CardHeader>
        <CardContent>
          <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Cargando...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (ordersWithLocation.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Mapa de Entregas</CardTitle>
          <CardDescription>No hay pedidos con ubicación para mostrar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            <p>Agrega latitud y longitud a tus pedidos para verlos en el mapa</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: Order['status']) => {
    const colors: Record<string, string> = {
      preparing: 'bg-blue-500',
      out_for_delivery: 'bg-purple-500',
      delivered: 'bg-green-500',
      delivery_failed: 'bg-red-500',
      confirmed: 'bg-yellow-500',
      pending: 'bg-gray-500',
    };
    return colors[status] || 'bg-gray-500';
  };

  const getStatusLabel = (status: Order['status']) => {
    const labels: Record<string, string> = {
      preparing: 'Preparando',
      out_for_delivery: 'En camino',
      delivered: 'Entregado',
      delivery_failed: 'Fallo en entrega',
      confirmed: 'Confirmado',
      pending: 'Pendiente',
      cancelled: 'Cancelado',
      rejected: 'Rechazado',
    };
    return labels[status] || status;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mapa de Entregas</CardTitle>
        <CardDescription>
          {ordersWithLocation.length} pedido(s) con ubicación
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height, width: '100%', borderRadius: '8px' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapUpdater orders={ordersWithLocation} />

          {ordersWithLocation.map((order) => (
            <Marker
              key={order.id}
              position={[order.latitude!, order.longitude!]}
              icon={getMarkerIcon(order.status)}
            >
              <Popup>
                <div className="p-2 min-w-[200px]">
                  <div className="font-semibold mb-2">{order.customer}</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Estado:</span>
                      <Badge className={getStatusColor(order.status)}>
                        {getStatusLabel(order.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Monto:</span>
                      <span className="font-medium">${order.total}</span>
                    </div>
                    {order.phone && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Teléfono:</span>
                        <span>{order.phone}</span>
                      </div>
                    )}
                    {order.customer_address && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {order.customer_address}
                      </div>
                    )}
                    {order.address_reference && (
                      <div className="mt-1 text-xs italic">
                        Ref: {order.address_reference}
                      </div>
                    )}
                    {order.neighborhood && (
                      <div className="mt-1 text-xs">
                        Barrio: {order.neighborhood}
                      </div>
                    )}
                    {order.delivery_attempts && order.delivery_attempts > 0 && (
                      <div className="mt-2 pt-2 border-t">
                        <span className="text-xs text-amber-600">
                          Intentos de entrega: {order.delivery_attempts}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span>🟡</span>
            <span className="text-muted-foreground">Confirmado</span>
          </div>
          <div className="flex items-center gap-2">
            <span>🔵</span>
            <span className="text-muted-foreground">Preparando</span>
          </div>
          <div className="flex items-center gap-2">
            <span>🚚</span>
            <span className="text-muted-foreground">En camino</span>
          </div>
          <div className="flex items-center gap-2">
            <span>✅</span>
            <span className="text-muted-foreground">Entregado</span>
          </div>
          <div className="flex items-center gap-2">
            <span>❌</span>
            <span className="text-muted-foreground">Fallo en entrega</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
