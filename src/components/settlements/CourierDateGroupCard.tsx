import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, Package, DollarSign, Calendar, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export interface CourierDateGroup {
  carrier_id: string;
  carrier_name: string;
  dispatch_date: string;
  orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    customer_city: string;
    total_price: number;
    cod_amount: number;
    payment_method: string;
    is_cod: boolean;
    shipped_at: string;
  }>;
  total_orders: number;
  total_cod_expected: number;
  total_prepaid: number;
}

interface CourierDateGroupCardProps {
  group: CourierDateGroup;
  onSelect: () => void;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Gs';
};

export function CourierDateGroupCard({ group, onSelect }: CourierDateGroupCardProps) {
  const formattedDate = format(new Date(group.dispatch_date + 'T12:00:00'), 'EEEE, d MMMM', { locale: es });

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
      onClick={onSelect}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-lg">{group.carrier_name}</h3>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span className="capitalize">{formattedDate}</span>
              </div>
            </div>
          </div>
          <Badge variant="secondary" className="text-sm">
            <Package className="h-3.5 w-3.5 mr-1" />
            {group.total_orders} pedido{group.total_orders !== 1 ? 's' : ''}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-1">
              <DollarSign className="h-3.5 w-3.5 text-green-600" />
              COD Esperado
            </div>
            <p className="text-lg font-bold text-green-600">
              {formatCurrency(group.total_cod_expected)}
            </p>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-center">
            <div className="text-xs text-muted-foreground mb-1">
              Prepago
            </div>
            <p className="text-lg font-bold text-blue-600">
              {group.total_prepaid}
            </p>
          </div>
        </div>

        <Button className="w-full gap-2 group-hover:bg-primary group-hover:text-primary-foreground" variant="outline">
          Conciliar
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
