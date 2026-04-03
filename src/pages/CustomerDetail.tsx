import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { customersService } from '@/services/customers.service';
import { formatCurrency } from '@/utils/currency';
import { useToast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/useDebounce';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Edit,
  Trash2,
  MessageCircle,
  ShoppingBag,
  DollarSign,
  Receipt,
  MapPin,
  Tag,
  Mail,
  Phone,
  Calendar,
  Package,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import { Customer, Order } from '@/types';
import { logger } from '@/utils/logger';
import { CustomerForm, CustomerFormData } from '@/components/forms/CustomerForm';

// Order status colors (matching Orders.tsx palette)
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

// Safe date helpers (same pattern as CarrierDetail)
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

// Initials from name
const getInitials = (firstName: string, lastName: string): string => {
  const first = (firstName || '').charAt(0).toUpperCase();
  const last = (lastName || '').charAt(0).toUpperCase();
  return `${first}${last}` || '?';
};

// Build location string from address parts
const buildLocationString = (customer: Customer): string => {
  const parts = [customer.city, customer.state, customer.country].filter(Boolean);
  return parts.join(', ');
};

// Header skeleton for loading state
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-md" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
        </div>
      </div>
      <Skeleton className="h-10 w-80" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

// Animation variants
const fadeInUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: 'easeOut' },
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Notes autosave state
  const [localNotes, setLocalNotes] = useState<string>('');
  const [notesInitialized, setNotesInitialized] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Orders pagination
  const [ordersPage, setOrdersPage] = useState(0);
  const ordersLimit = 10;

  // Fetch customer data
  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => customersService.getById(id!),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch customer orders
  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['customers', id, 'orders', ordersPage],
    queryFn: () => customersService.getOrders(id!, { limit: ordersLimit, offset: ordersPage * ordersLimit }),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });

  // Initialize local notes when customer loads
  useEffect(() => {
    if (customer && !notesInitialized) {
      setLocalNotes(customer.notes || '');
      setNotesInitialized(true);
    }
  }, [customer, notesInitialized]);

  // Debounced notes value for autosave
  const debouncedNotes = useDebounce(localNotes, 400);

  // Notes autosave mutation
  const notesMutation = useMutation({
    mutationFn: (notes: string) => customersService.update(id!, { notes }),
    onSuccess: (updatedCustomer) => {
      if (updatedCustomer) {
        queryClient.setQueryData(['customers', id], updatedCustomer);
      }
      setSaveStatus('saved');
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: () => {
      setSaveStatus('idle');
      toast({
        title: 'Error al guardar notas',
        description: 'No se pudieron guardar las notas. Intenta de nuevo.',
        variant: 'destructive',
      });
    },
  });

  // Trigger autosave when debounced notes change (only after init)
  useEffect(() => {
    if (!notesInitialized || !customer) return;
    if (debouncedNotes === (customer.notes || '')) return;

    setSaveStatus('saving');
    notesMutation.mutate(debouncedNotes);
    // notesMutation is stable via useMutation, safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedNotes, notesInitialized]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Delete handler
  const handleDelete = useCallback(async () => {
    if (!id) return;
    try {
      await customersService.delete(id);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast({ title: 'Cliente eliminado', description: 'El cliente ha sido eliminado exitosamente.' });
      navigate('/customers');
    } catch (error: unknown) {
      toast({
        title: 'Error al eliminar',
        description: error instanceof Error ? error.message : 'No se pudo eliminar el cliente.',
        variant: 'destructive',
      });
    }
  }, [id, queryClient, toast, navigate]);

  // Edit submit handler
  const handleEditSubmit = useCallback(async (data: CustomerFormData) => {
    if (!id) return;
    setIsSubmitting(true);
    try {
      const updatedCustomer = await customersService.update(id, data);
      if (updatedCustomer) {
        queryClient.setQueryData(['customers', id], updatedCustomer);
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      }
      setEditDialogOpen(false);
      toast({ title: 'Cliente actualizado', description: 'Los cambios han sido guardados exitosamente.' });
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Ocurrio un error al guardar.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [id, queryClient, toast]);

  // WhatsApp handler
  const handleWhatsApp = useCallback(() => {
    if (!customer?.phone) return;
    const phone = customer.phone.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}`, '_blank');
  }, [customer?.phone]);

  // Loading state
  if (customerLoading) {
    return <DetailSkeleton />;
  }

  // Not found state
  if (!customer) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="mx-auto text-muted-foreground mb-4" size={48} />
          <h3 className="text-xl font-semibold mb-2">Cliente no encontrado</h3>
          <p className="text-muted-foreground mb-4">El cliente que buscas no existe o fue eliminado.</p>
          <Link to="/customers">
            <Button variant="outline">
              <ArrowLeft size={16} className="mr-2" />
              Volver a Clientes
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const fullName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Sin nombre';
  const location = buildLocationString(customer);
  const customerSince = safeFormatDate(customer.created_at, "MMMM yyyy");
  const avgTicket = customer.total_orders > 0 ? customer.total_spent / customer.total_orders : 0;
  const tags = customer.tags ? customer.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  const orders = ordersData?.data || [];
  const pagination = ordersData?.pagination;
  const totalPages = pagination ? Math.ceil(pagination.total / ordersLimit) : 0;

  return (
    <motion.div className="space-y-6" initial="initial" animate="animate" variants={staggerContainer}>
      {/* Header */}
      <motion.div {...fadeInUp} className="flex flex-col sm:flex-row sm:items-start gap-4">
        <Link to="/customers">
          <Button variant="outline" size="icon" className="shrink-0">
            <ArrowLeft size={18} />
          </Button>
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-primary">
                {getInitials(customer.first_name, customer.last_name)}
              </span>
            </div>

            <div className="min-w-0">
              <h2 className="text-2xl font-bold text-card-foreground truncate">{fullName}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
                {customer.email && (
                  <span className="flex items-center gap-1 truncate">
                    <Mail size={14} />
                    {customer.email}
                  </span>
                )}
                {customer.phone && (
                  <span className="flex items-center gap-1">
                    <Phone size={14} />
                    {customer.phone}
                  </span>
                )}
                {location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={14} />
                    {location}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  Cliente desde {customerSince}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
            <Edit size={16} className="mr-1.5" />
            Editar
          </Button>
          {customer.phone && (
            <Button variant="outline" size="sm" onClick={handleWhatsApp}>
              <MessageCircle size={16} className="mr-1.5" />
              WhatsApp
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setDeleteDialogOpen(true)} className="text-destructive hover:text-destructive">
            <Trash2 size={16} />
          </Button>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div {...fadeInUp}>
        <Tabs defaultValue="summary" className="space-y-6">
          <TabsList className="bg-muted">
            <TabsTrigger value="summary">Resumen</TabsTrigger>
            <TabsTrigger value="orders">Pedidos</TabsTrigger>
            <TabsTrigger value="notes">Notas</TabsTrigger>
          </TabsList>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-6">
            {/* Metric cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-5 bg-card">
                <div className="flex items-center gap-3 mb-2">
                  <DollarSign className="text-green-600" size={20} />
                  <span className="text-sm text-muted-foreground">Total Gastado</span>
                </div>
                <p className="text-2xl font-bold text-card-foreground">
                  {formatCurrency(customer.total_spent || 0)}
                </p>
              </Card>

              <Card className="p-5 bg-card">
                <div className="flex items-center gap-3 mb-2">
                  <ShoppingBag className="text-blue-600" size={20} />
                  <span className="text-sm text-muted-foreground">Total Pedidos</span>
                </div>
                <p className="text-2xl font-bold text-card-foreground">
                  {customer.total_orders || 0}
                </p>
              </Card>

              <Card className="p-5 bg-card">
                <div className="flex items-center gap-3 mb-2">
                  <Receipt className="text-purple-600" size={20} />
                  <span className="text-sm text-muted-foreground">Ticket Promedio</span>
                </div>
                <p className="text-2xl font-bold text-card-foreground">
                  {formatCurrency(avgTicket)}
                </p>
              </Card>
            </div>

            {/* Address and metadata */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Address card */}
              {(customer.address || customer.city || customer.state || customer.postal_code || customer.country) && (
                <Card className="p-5 bg-card">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="text-primary" size={18} />
                    <h3 className="font-semibold text-card-foreground">Direccion</h3>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {customer.address && <p>{customer.address}</p>}
                    <p>
                      {[customer.city, customer.state].filter(Boolean).join(', ')}
                      {customer.postal_code && ` (${customer.postal_code})`}
                    </p>
                    {customer.country && <p>{customer.country}</p>}
                  </div>
                </Card>
              )}

              {/* Tags and status card */}
              <Card className="p-5 bg-card">
                <div className="space-y-4">
                  {/* Marketing status */}
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">Marketing</h3>
                    <Badge variant={customer.accepts_marketing ? 'default' : 'secondary'}>
                      {customer.accepts_marketing ? 'Acepta marketing' : 'No acepta marketing'}
                    </Badge>
                  </div>

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">Etiquetas</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            <Tag size={12} className="mr-1" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Last order */}
                  {customer.last_order_at && (
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-1">Ultimo pedido</h3>
                      <p className="text-sm text-card-foreground">
                        {safeFormatDate(customer.last_order_at, 'dd MMM yyyy')}
                        <span className="text-muted-foreground ml-2">
                          ({safeFormatDistance(customer.last_order_at)})
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Shopify link */}
                  {customer.shopify_customer_id && (
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-1">Shopify</h3>
                      <Badge variant="outline" className="text-xs font-mono">
                        ID: {customer.shopify_customer_id}
                      </Badge>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders" className="space-y-4">
            {ordersLoading ? (
              <Card className="overflow-hidden">
                <div className="p-4 border-b">
                  <Skeleton className="h-5 w-32" />
                </div>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 border-b border-border last:border-b-0">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-40 flex-1" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </Card>
            ) : orders.length === 0 ? (
              <Card className="p-12">
                <div className="flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                    <Package className="text-muted-foreground" size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Sin pedidos</h3>
                    <p className="text-sm text-muted-foreground">Este cliente aun no tiene pedidos registrados.</p>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="bg-card overflow-hidden">
                <div className="p-4 border-b">
                  <h3 className="font-semibold text-card-foreground">
                    Pedidos ({pagination?.total ?? orders.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th className="p-4 font-medium"># Pedido</th>
                        <th className="p-4 font-medium">Producto(s)</th>
                        <th className="p-4 font-medium">Estado</th>
                        <th className="p-4 font-medium text-right">Total</th>
                        <th className="p-4 font-medium">Fecha</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {orders.map((order: Order) => (
                        <tr
                          key={order.id}
                          className="hover:bg-accent/50 cursor-pointer transition-colors"
                          onClick={() => navigate(`/orders?q=${order.shopify_order_number || order.id.slice(0, 8)}`)}
                        >
                          <td className="p-4 font-mono font-medium text-primary">
                            #{order.shopify_order_number || order.id.slice(0, 8)}
                          </td>
                          <td className="p-4 max-w-[200px] truncate text-card-foreground">
                            {order.product || 'Sin producto'}
                          </td>
                          <td className="p-4">
                            <Badge
                              variant="outline"
                              className={`text-xs font-medium ${statusColors[order.status] || ''}`}
                            >
                              {statusLabels[order.status] || order.status}
                            </Badge>
                          </td>
                          <td className="p-4 text-right font-semibold text-card-foreground">
                            {formatCurrency(order.total ?? 0)}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {safeFormatDate(order.date, 'dd MMM yyyy')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-sm text-muted-foreground">
                      Mostrando {ordersPage * ordersLimit + 1} a{' '}
                      {Math.min((ordersPage + 1) * ordersLimit, pagination?.total || 0)} de{' '}
                      {pagination?.total || 0}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOrdersPage(p => Math.max(0, p - 1))}
                        disabled={ordersPage === 0}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOrdersPage(p => p + 1)}
                        disabled={ordersPage >= totalPages - 1}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            )}
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="space-y-3">
            <Card className="p-5 bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-card-foreground">Notas internas</h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground h-5">
                  {saveStatus === 'saving' && (
                    <motion.span
                      className="flex items-center gap-1"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <Loader2 size={12} className="animate-spin" />
                      Guardando...
                    </motion.span>
                  )}
                  {saveStatus === 'saved' && (
                    <motion.span
                      className="flex items-center gap-1 text-green-600 dark:text-green-400"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <Check size={12} />
                      Guardado
                    </motion.span>
                  )}
                </div>
              </div>
              <Textarea
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                placeholder="Agrega notas internas sobre este cliente..."
                className="min-h-[200px] resize-y"
              />
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Cliente</DialogTitle>
          </DialogHeader>
          <CustomerForm
            customer={customer}
            onSubmit={handleEditSubmit}
            onCancel={() => setEditDialogOpen(false)}
            isSubmitting={isSubmitting}
            showNotes
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Eliminar cliente"
        description={`Estas seguro de que quieres eliminar a ${fullName}? Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        variant="destructive"
        confirmText="Eliminar"
        cancelText="Cancelar"
      />
    </motion.div>
  );
}
