import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Star, Eye, Edit, Power, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { carriersService } from '@/services/carriers.service';

interface CarrierTableProps {
  carriers: any[];
  onEdit?: (carrier: any) => void;
  onRefresh?: () => void;
  onManageZones?: (carrier: any) => void;
  isHighlighted?: (id: string) => boolean;
}

export function CarrierTable({ carriers, onEdit, onRefresh, onManageZones, isHighlighted }: CarrierTableProps) {
  const { toast } = useToast();

  const handleEdit = (carrier: any) => {
    if (onEdit) {
      onEdit(carrier);
    } else {
      toast({
        title: "Editar repartidor",
        description: `Esta función estará disponible pronto.`,
      });
    }
  };

  const handleToggleStatus = async (carrier: any) => {
    try {
      await carriersService.toggleStatus(carrier.id);
      const newStatus = carrier.is_active ? 'inactivo' : 'activo';
      toast({
        title: "Estado actualizado",
        description: `${carrier.name} ahora está ${newStatus}.`,
      });
      if (onRefresh) {
        onRefresh();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "No se pudo cambiar el estado",
        variant: "destructive",
      });
    }
  };

  if (carriers.length === 0) {
    return (
      <Card className="p-12 text-center bg-card">
        <div className="flex flex-col items-center">
          <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <MapPin className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No hay repartidores registrados</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Agrega tu primer repartidor para empezar a asignar entregas y gestionar tu logística.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden bg-card">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Repartidor
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contacto
              </th>
              <th className="text-center py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Estado
              </th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Entregas
              </th>
              <th className="text-right py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Tasa Éxito
              </th>
              <th className="text-center py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Rating
              </th>
              <th className="text-center py-3 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {carriers.map((carrier) => {
              const carrierName = carrier.name || carrier.carrier_name || 'Sin nombre';
              return (
                <tr
                  key={carrier.id}
                  id={`item-${carrier.id}`}
                  className={`hover:bg-muted/20 transition-all ${
                    isHighlighted && isHighlighted(carrier.id)
                      ? 'bg-yellow-100 dark:bg-yellow-900/30 ring-2 ring-yellow-400 dark:ring-yellow-500'
                      : ''
                  }`}
                >
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">
                          {carrierName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-sm text-card-foreground">{carrierName}</p>
                        {carrier.notes && (
                          <p className="text-xs text-muted-foreground">{carrier.notes}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div>
                      {carrier.phone && (
                        <p className="text-sm text-card-foreground">{carrier.phone}</p>
                      )}
                      {carrier.email && (
                        <p className="text-xs text-muted-foreground">{carrier.email}</p>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-center">
                    <Badge
                      variant={carrier.is_active ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {carrier.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="py-4 px-4 text-right text-sm text-card-foreground font-medium">
                    {carrier.total_deliveries || 0}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="text-sm font-semibold text-muted-foreground">
                      {carrier.delivery_rate ? `${carrier.delivery_rate.toFixed(1)}%` : '0%'}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center justify-center gap-1">
                      {carrier.average_rating > 0 ? (
                        <>
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                          <span className="text-sm font-semibold text-card-foreground">
                            {carrier.average_rating.toFixed(1)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({carrier.total_ratings || 0})
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin ratings</span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center justify-center gap-1">
                      <Link to={`/carriers/${carrier.id}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 min-h-[44px] min-w-[44px]"
                          aria-label={`Ver detalles de ${carrierName}`}
                        >
                          <Eye size={18} />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 min-h-[44px] min-w-[44px] hover:bg-blue-50 dark:hover:bg-blue-950"
                        onClick={() => onManageZones && onManageZones(carrier)}
                        aria-label={`Gestionar zonas de ${carrierName}`}
                      >
                        <MapPin size={18} className="text-blue-600 dark:text-blue-400" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 min-h-[44px] min-w-[44px]"
                        onClick={() => handleEdit(carrier)}
                        aria-label={`Editar ${carrierName}`}
                      >
                        <Edit size={18} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-10 w-10 min-h-[44px] min-w-[44px] ${
                          carrier.is_active ? 'text-primary hover:text-primary' : 'text-muted-foreground'
                        }`}
                        onClick={() => handleToggleStatus(carrier)}
                        aria-label={carrier.is_active ? `Desactivar ${carrierName}` : `Activar ${carrierName}`}
                      >
                        <Power size={18} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
