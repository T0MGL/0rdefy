import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Customer, Order } from '@/types';
import { customersService } from '@/services/customers.service';
import { formatCurrency } from '@/utils/currency';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Card } from './ui/card';
import {
  Mail,
  Phone,
  MessageCircle,
  MapPin,
  Tag,
  Calendar,
  DollarSign,
  ShoppingBag,
  Receipt,
  Package,
  ExternalLink,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';

interface CustomerQuickViewProps {
  customer: Customer | null;
  open: boolean;
  onClose: () => void;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800',
  contacted: 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800',
  awaiting_carrier: 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800',
  confirmed: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800',
  in_preparation: 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-800',
  ready_to_ship: 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-800',
  shipped: 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800',
  in_transit: 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800',
  delivered: 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800',
  returned: 'bg-gray-50 dark:bg-gray-950/20 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-800',
  cancelled: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800',
  incident: 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800',
};

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  contacted: 'Contactado',
  awaiting_carrier: 'Esperando',
  confirmed: 'Confirmado',
  in_preparation: 'En Preparacion',
  ready_to_ship: 'Preparado',
  shipped: 'Despachado',
  in_transit: 'En Transito',
  delivered: 'Entregado',
  returned: 'Devuelto',
  cancelled: 'Cancelado',
  incident: 'Incidencia',
};

const safeFormatDate = (dateString: string | null | undefined, formatStr: string): string => {
  try {
    if (!dateString) return 'Sin fecha';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Sin fecha';
    return format(date, formatStr, { locale: es });
  } catch {
    return 'Sin fecha';
  }
};

const safeFormatDistance = (dateString: string | null | undefined): string => {
  try {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return formatDistanceToNow(date, { addSuffix: true, locale: es });
  } catch {
    return '';
  }
};

const getInitials = (firstName: string, lastName: string): string => {
  const first = (firstName || '').charAt(0).toUpperCase();
  const last = (lastName || '').charAt(0).toUpperCase();
  return `${first}${last}` || '?';
};

const fadeIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: 'easeOut' },
};

const stagger = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

function OrdersSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-20 ml-auto" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function CustomerQuickView({ customer, open, onClose }: CustomerQuickViewProps) {
  const navigate = useNavigate();

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['customers', customer?.id, 'orders', 'quickview'],
    queryFn: () => customersService.getOrders(customer!.id, { limit: 5, offset: 0 }),
    enabled: !!customer?.id && open,
    staleTime: 2 * 60 * 1000,
  });

  if (!customer) return null;

  const fullName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Sin nombre';
  const avgTicket = customer.total_orders > 0 ? customer.total_spent / customer.total_orders : 0;
  const tags = customer.tags ? customer.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const locationParts = [customer.city, customer.country].filter(Boolean);
  const location = locationParts.join(', ');

  const orders = ordersData?.data || [];
  const notesPreview = customer.notes
    ? customer.notes.split('\n').slice(0, 3).join('\n')
    : null;
  const hasMoreNotes = customer.notes
    ? customer.notes.split('\n').length > 3
    : false;

  const handleWhatsApp = () => {
    if (!customer.phone) return;
    const phone = customer.phone.replace(/\D/g, '');
    const whatsappNumber = phone.startsWith('+') ? phone : `+${phone}`;
    window.open(`https://wa.me/${whatsappNumber}`, '_blank');
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto flex flex-col">
        <SheetHeader className="pb-0">
          <SheetTitle className="sr-only">Vista rapida de cliente</SheetTitle>
        </SheetHeader>

        <motion.div
          className="flex-1 space-y-6 mt-2"
          initial="initial"
          animate="animate"
          variants={stagger}
        >
          {/* Header: Avatar, Name, Contact */}
          <motion.div {...fadeIn} className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-primary">
                {getInitials(customer.first_name, customer.last_name)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-card-foreground truncate">{fullName}</h3>
              <div className="space-y-1 mt-1">
                {customer.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail size={14} className="shrink-0" />
                    <span className="truncate">{customer.email}</span>
                  </div>
                )}
                {customer.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone size={14} className="shrink-0" />
                    <span>{customer.phone}</span>
                  </div>
                )}
              </div>
              {customer.phone && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={handleWhatsApp}
                >
                  <MessageCircle size={14} className="mr-1.5" />
                  WhatsApp
                </Button>
              )}
            </div>
          </motion.div>

          {/* Stats: 3 cards */}
          <motion.div {...fadeIn} className="grid grid-cols-3 gap-3">
            <Card className="p-3 bg-card text-center">
              <DollarSign className="mx-auto text-green-600 mb-1" size={18} />
              <p className="text-xs text-muted-foreground">Total Gastado</p>
              <p className="text-sm font-bold text-card-foreground mt-0.5">
                {formatCurrency(customer.total_spent || 0)}
              </p>
            </Card>
            <Card className="p-3 bg-card text-center">
              <ShoppingBag className="mx-auto text-blue-600 mb-1" size={18} />
              <p className="text-xs text-muted-foreground">Pedidos</p>
              <p className="text-sm font-bold text-card-foreground mt-0.5">
                {customer.total_orders || 0}
              </p>
            </Card>
            <Card className="p-3 bg-card text-center">
              <Receipt className="mx-auto text-purple-600 mb-1" size={18} />
              <p className="text-xs text-muted-foreground">Ticket Prom.</p>
              <p className="text-sm font-bold text-card-foreground mt-0.5">
                {formatCurrency(avgTicket)}
              </p>
            </Card>
          </motion.div>

          {/* Info: Location, Marketing, Tags, Since */}
          <motion.div {...fadeIn} className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">INFO</h4>
            <div className="space-y-2.5">
              {location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin size={14} className="text-muted-foreground shrink-0" />
                  <span className="text-card-foreground">{location}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Badge variant={customer.accepts_marketing ? 'default' : 'secondary'} className="text-xs">
                  {customer.accepts_marketing ? 'Acepta marketing' : 'No acepta marketing'}
                </Badge>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      <Tag size={10} className="mr-1" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar size={14} className="shrink-0" />
                <span>
                  Cliente desde {safeFormatDate(customer.created_at, 'MMMM yyyy')}
                  {' '}({safeFormatDistance(customer.created_at)})
                </span>
              </div>
            </div>
          </motion.div>

          {/* Recent Orders (last 5) */}
          <motion.div {...fadeIn} className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">ULTIMOS PEDIDOS</h4>
            {ordersLoading ? (
              <OrdersSkeleton />
            ) : orders.length === 0 ? (
              <div className="p-4 bg-muted/30 rounded-lg border border-dashed text-center">
                <Package className="mx-auto text-muted-foreground mb-2" size={24} />
                <p className="text-sm text-muted-foreground">Sin pedidos</p>
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="p-2.5 text-left font-medium text-xs"># Pedido</th>
                      <th className="p-2.5 text-left font-medium text-xs">Estado</th>
                      <th className="p-2.5 text-right font-medium text-xs">Total</th>
                      <th className="p-2.5 text-right font-medium text-xs">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {orders.map((order: Order) => (
                      <tr
                        key={order.id}
                        className="hover:bg-accent/50 cursor-pointer transition-colors"
                        onClick={() => {
                          onClose();
                          navigate(`/orders?q=${order.shopify_order_number || order.id.slice(0, 8)}`);
                        }}
                      >
                        <td className="p-2.5 font-mono text-xs font-medium text-primary">
                          #{order.shopify_order_number || order.id.slice(0, 8)}
                        </td>
                        <td className="p-2.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] leading-tight font-medium ${statusColors[order.status] || ''}`}
                          >
                            {statusLabels[order.status] || order.status}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-right font-semibold text-card-foreground text-xs">
                          {formatCurrency(order.total ?? 0)}
                        </td>
                        <td className="p-2.5 text-right text-muted-foreground text-xs">
                          {safeFormatDate(order.date, 'dd MMM')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>

          {/* Notes Preview */}
          <motion.div {...fadeIn} className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">NOTAS</h4>
            {notesPreview ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800/30 border-dashed">
                <p className="text-sm whitespace-pre-wrap text-amber-900 dark:text-amber-200">
                  {notesPreview}
                </p>
                {hasMoreNotes && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline mt-2"
                    onClick={() => {
                      onClose();
                      navigate(`/customers/${customer.id}`);
                    }}
                  >
                    Ver mas...
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3 bg-muted/30 rounded-lg border border-dashed text-center">
                <p className="text-sm text-muted-foreground">Sin notas</p>
              </div>
            )}
          </motion.div>
        </motion.div>

        {/* Footer */}
        <SheetFooter className="mt-6 pt-4 border-t flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              onClose();
              navigate(`/customers/${customer.id}`);
            }}
          >
            <ExternalLink size={14} className="mr-1.5" />
            Ver Perfil Completo
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onClose();
              navigate(`/customers/${customer.id}`);
            }}
          >
            Editar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
