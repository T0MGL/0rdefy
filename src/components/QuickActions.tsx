import { Card } from './ui/card';
import { Button } from './ui/button';
import { Plus, Package, Truck, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function QuickActions() {
  const navigate = useNavigate();

  const actions = [
    {
      icon: Plus,
      label: 'Crear Pedido',
      description: 'Registra un nuevo pedido',
      onClick: () => navigate('/orders'),
      color: 'text-primary',
    },
    {
      icon: Package,
      label: 'Agregar Producto',
      description: 'Añade al catálogo',
      onClick: () => navigate('/products'),
      color: 'text-blue-600',
    },
    {
      icon: Truck,
      label: 'Rastrear Envío',
      description: 'Consulta estado',
      onClick: () => navigate('/carriers'),
      color: 'text-purple-600',
    },
    {
      icon: ClipboardList,
      label: 'Pendientes Hoy',
      description: 'Ver tareas del día',
      onClick: () => navigate('/orders'),
      color: 'text-orange-600',
    },
  ];

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Acciones Rápidas</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            className="h-auto flex-col gap-3 p-4 hover:border-primary hover:bg-primary/5 hover:text-foreground transition-all"
            onClick={action.onClick}
          >
            <action.icon size={28} className={action.color} />
            <div className="text-center">
              <p className="font-semibold text-sm">{action.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
            </div>
          </Button>
        ))}
      </div>
    </Card>
  );
}
