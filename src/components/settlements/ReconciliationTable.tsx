import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import { CheckCircle2, XCircle, Calendar, ArrowUpDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export interface ReconciliationOrder {
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
  /**
   * Optional: when present, the table renders a "Fecha entrega" column,
   * sortable by clicking the header (default ASC, oldest first). Added in
   * Migration 182 because carrier-grouped settlements can span multiple
   * delivery dates.
   */
  delivered_at?: string | null;
}

export interface OrderReconciliation {
  delivered: boolean;
  failure_reason?: string;
  notes?: string;
}

interface ReconciliationTableProps {
  orders: ReconciliationOrder[];
  reconciliationState: Map<string, OrderReconciliation>;
  onToggleDelivered: (orderId: string) => void;
  onSetFailureReason: (orderId: string, reason: string) => void;
  onToggleAll: (delivered: boolean) => void;
  /**
   * If true, render the Fecha entrega column (sortable). Defaults to
   * inferring from data: if any order has a delivered_at value, the column
   * is shown. Pass `false` to force-hide.
   */
  showDeliveryDate?: boolean;
}

const FAILURE_REASONS = [
  { value: 'no_answer', label: 'No contesta' },
  { value: 'wrong_address', label: 'Direccion incorrecta' },
  { value: 'customer_absent', label: 'Cliente ausente' },
  { value: 'customer_rejected', label: 'Cliente rechazo' },
  { value: 'insufficient_funds', label: 'Sin dinero' },
  { value: 'rescheduled', label: 'Reprogramado' },
  { value: 'other', label: 'Otro' },
];


function formatRowDate(iso?: string | null): string {
  if (!iso) return '-';
  try {
    return format(parseISO(iso), 'dd/MM', { locale: es });
  } catch {
    return iso;
  }
}

export function ReconciliationTable({
  orders,
  reconciliationState,
  onToggleDelivered,
  onSetFailureReason,
  onToggleAll,
  showDeliveryDate,
}: ReconciliationTableProps) {
  const allDelivered = orders.every(o => reconciliationState.get(o.id)?.delivered ?? true);
  // Infer column visibility from data unless caller explicitly overrides.
  const renderDeliveryDate =
    showDeliveryDate ?? orders.some(o => Boolean(o.delivered_at));

  const [sortAsc, setSortAsc] = useState(true);
  const visibleOrders = renderDeliveryDate
    ? [...orders].sort((a, b) => {
        const da = a.delivered_at ? new Date(a.delivered_at).getTime() : 0;
        const db = b.delivered_at ? new Date(b.delivered_at).getTime() : 0;
        return sortAsc ? da - db : db - da;
      })
    : orders;

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-12">
              <Checkbox
                checked={allDelivered}
                onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
                aria-label="Seleccionar todos"
              />
            </TableHead>
            <TableHead>Pedido</TableHead>
            <TableHead>Cliente</TableHead>
            {renderDeliveryDate && (
              <TableHead className="w-32">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => setSortAsc(s => !s)}
                  aria-label="Ordenar por fecha de entrega"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  Fecha entrega
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
            )}
            <TableHead className="hidden md:table-cell">Dirección</TableHead>
            <TableHead className="text-right">COD</TableHead>
            <TableHead className="w-32">Estado</TableHead>
            <TableHead className="w-44">Motivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleOrders.map(order => {
            const state = reconciliationState.get(order.id);
            const delivered = state?.delivered ?? true;

            return (
              <TableRow
                key={order.id}
                className={cn(
                  'transition-colors',
                  delivered
                    ? 'bg-green-50/50 dark:bg-green-950/10 hover:bg-green-50 dark:hover:bg-green-950/20'
                    : 'bg-red-50/50 dark:bg-red-950/10 hover:bg-red-50 dark:hover:bg-red-950/20'
                )}
              >
                <TableCell>
                  <Checkbox
                    checked={delivered}
                    onCheckedChange={() => onToggleDelivered(order.id)}
                  />
                </TableCell>
                <TableCell className="font-mono font-bold text-sm">
                  #{order.order_number}
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">{order.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                  </div>
                </TableCell>
                {renderDeliveryDate && (
                  <TableCell className="font-mono text-sm">
                    {formatRowDate(order.delivered_at)}
                  </TableCell>
                )}
                <TableCell className="hidden md:table-cell max-w-xs">
                  <p className="text-sm truncate">{order.customer_address}</p>
                  {order.customer_city && (
                    <p className="text-xs text-muted-foreground">{order.customer_city}</p>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {order.is_cod ? (
                    <span className="font-medium text-green-600">
                      {formatCurrency(order.cod_amount)}
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-blue-600 border-blue-200">
                      Pagado
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={delivered ? 'default' : 'destructive'}
                    className={cn(
                      'gap-1',
                      delivered && 'bg-green-600 hover:bg-green-700'
                    )}
                  >
                    {delivered ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        Entregado
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3" />
                        No Entregado
                      </>
                    )}
                  </Badge>
                </TableCell>
                <TableCell>
                  {!delivered && (
                    <Select
                      value={state?.failure_reason || ''}
                      onValueChange={(v) => onSetFailureReason(order.id, v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {FAILURE_REASONS.map(r => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
