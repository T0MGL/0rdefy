import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { MetricCard } from '@/components/MetricCard';
import { MetricCardSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { ExportButton } from '@/components/ExportButton';
import { Input } from '@/components/ui/input';
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
import { CustomerFilters, CustomerFilterValues } from '@/components/customers/CustomerFilters';
import { CustomerQuickView } from '@/components/CustomerQuickView';
import { customersService } from '@/services/customers.service';
import { useToast } from '@/hooks/use-toast';
import { useDebounce } from '@/hooks/useDebounce';
import { CustomerForm, CustomerFormData } from '@/components/forms/CustomerForm';
import { Plus, Edit, Trash2, Users, Mail, Phone, ShoppingBag, Search, X, ArrowUpDown, DollarSign, Loader2, LayoutGrid, List, Eye, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Customer } from '@/types';
import { customersExportColumns } from '@/utils/exportConfigs';
import { formatCurrency } from '@/utils/currency';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

type SortField = 'name' | 'total_spent' | 'total_orders' | 'created_at';
type SortDirection = 'asc' | 'desc';

type ViewMode = 'cards' | 'table';

const PAGE_SIZE = 30;
const VIEW_MODE_KEY = 'ordefy_customers_view_mode';

const SORT_FIELD_MAP: Record<SortField, string> = {
  name: 'first_name',
  total_spent: 'total_spent',
  total_orders: 'total_orders',
  created_at: 'created_at',
};

function getStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === 'table' || stored === 'cards') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'cards';
}

function formatRelativeDate(dateString: string | undefined | null): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return formatDistanceToNow(date, { addSuffix: true, locale: es });
  } catch {
    return '';
  }
}

function sanitizePhone(phone: string | undefined | null): string {
  if (!phone) return '';
  return phone.replace(/[^0-9+]/g, '');
}

export default function Customers() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [quickViewCustomer, setQuickViewCustomer] = useState<Customer | null>(null);
  const [accumulatedCustomers, setAccumulatedCustomers] = useState<Customer[]>([]);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const prevParamsRef = useRef<string>('');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // localStorage unavailable
    }
  }, []);

  // URL-param-driven state for search and sort
  const searchQuery = searchParams.get('q') || '';
  const sortField = (searchParams.get('sort') || 'created_at') as SortField;
  const sortDirection = (searchParams.get('dir') || 'desc') as SortDirection;

  // URL-param-driven filter state
  const currentFilters = useMemo<CustomerFilterValues>(() => {
    const filters: CustomerFilterValues = {};
    const minOrders = searchParams.get('min_orders');
    const minSpent = searchParams.get('min_spent');
    const city = searchParams.get('city');
    const acceptsMarketing = searchParams.get('accepts_marketing');
    const lastOrderBefore = searchParams.get('last_order_before');
    if (minOrders) filters.min_orders = parseInt(minOrders, 10);
    if (minSpent) filters.min_spent = parseInt(minSpent, 10);
    if (city) filters.city = city;
    if (acceptsMarketing === 'true') filters.accepts_marketing = true;
    if (lastOrderBefore) filters.last_order_before = lastOrderBefore;
    return filters;
  }, [searchParams]);

  const hasActiveFilters = useMemo(() => {
    return Object.keys(currentFilters).some((k) => {
      const val = currentFilters[k as keyof CustomerFilterValues];
      return val !== undefined && val !== '' && val !== 0;
    });
  }, [currentFilters]);

  const handleFiltersChange = useCallback((filters: CustomerFilterValues) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      // Clear all filter params first
      next.delete('min_orders');
      next.delete('min_spent');
      next.delete('city');
      next.delete('accepts_marketing');
      next.delete('last_order_before');
      // Set new values
      if (filters.min_orders !== undefined && filters.min_orders > 0) next.set('min_orders', filters.min_orders.toString());
      if (filters.min_spent !== undefined && filters.min_spent > 0) next.set('min_spent', filters.min_spent.toString());
      if (filters.city) next.set('city', filters.city);
      if (filters.accepts_marketing === true) next.set('accepts_marketing', 'true');
      if (filters.last_order_before) next.set('last_order_before', filters.last_order_before);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleClearFilters = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('min_orders');
      next.delete('min_spent');
      next.delete('city');
      next.delete('accepts_marketing');
      next.delete('last_order_before');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSearchQuery = useCallback((value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set('q', value);
      } else {
        next.delete('q');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSortField = useCallback((value: SortField) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value !== 'created_at') {
        next.set('sort', value);
      } else {
        next.delete('sort');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSortDirection = useCallback((value: SortDirection) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value !== 'desc') {
        next.set('dir', value);
      } else {
        next.delete('dir');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Stats KPIs query (separate, long cache)
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['customers', 'stats'],
    queryFn: customersService.getStats,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Build a stable param key to detect search/sort/filter changes and reset accumulation
  const filterKey = JSON.stringify(currentFilters);
  const paramKey = `${debouncedSearch}|${sortField}|${sortDirection}|${filterKey}`;

  // Reset accumulated data when search, sort, or filters change
  useEffect(() => {
    if (prevParamsRef.current !== paramKey) {
      prevParamsRef.current = paramKey;
      setAccumulatedCustomers([]);
      setCurrentOffset(0);
    }
  }, [paramKey]);

  // Server-side paginated query (includes filter params)
  const { data: paginatedResponse, isLoading, isFetching } = useQuery({
    queryKey: ['customers', { search: debouncedSearch, sortField, sortDirection, offset: currentOffset, filters: currentFilters }],
    queryFn: () => customersService.getAllPaginated({
      search: debouncedSearch || undefined,
      sort_by: SORT_FIELD_MAP[sortField],
      sort_order: sortDirection,
      limit: PAGE_SIZE,
      offset: currentOffset,
      ...currentFilters,
    }),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const pageData = paginatedResponse?.data ?? [];
  const pagination = paginatedResponse?.pagination ?? { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false };

  // Accumulate fetched pages into a single list
  useEffect(() => {
    if (pageData.length === 0) return;
    setAccumulatedCustomers(prev => {
      if (currentOffset === 0) return pageData;
      const existingIds = new Set(prev.map(c => c.id));
      const newItems = pageData.filter(c => !existingIds.has(c.id));
      return [...prev, ...newItems];
    });
  }, [pageData, currentOffset]);

  // The visible customer list: accumulated data or current page data on first load
  const customers = accumulatedCustomers.length > 0 ? accumulatedCustomers : pageData;

  const handleLoadMore = useCallback(() => {
    setCurrentOffset(prev => prev + PAGE_SIZE);
  }, []);

  const handleCreate = () => {
    setSelectedCustomer(null);
    setDialogOpen(true);
  };

  const handleEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setCustomerToDelete(id);
    setDeleteDialogOpen(true);
  };

  const invalidateCustomers = useCallback(() => {
    setAccumulatedCustomers([]);
    setCurrentOffset(0);
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  }, [queryClient]);

  const confirmDelete = async () => {
    if (!customerToDelete) return;

    try {
      // Optimistic update: remove from accumulated list
      setAccumulatedCustomers(prev => prev.filter(c => c.id !== customerToDelete));

      await customersService.delete(customerToDelete);

      setDeleteDialogOpen(false);
      setCustomerToDelete(null);

      toast({
        title: 'Cliente eliminado',
        description: 'El cliente ha sido eliminado exitosamente.',
      });

      // Refresh stats after deletion
      queryClient.invalidateQueries({ queryKey: ['customers', 'stats'] });
    } catch (error: unknown) {
      invalidateCustomers();

      toast({
        title: 'Error al eliminar',
        description: error instanceof Error ? error.message : 'No se pudo eliminar el cliente.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (data: CustomerFormData) => {
    setIsSubmitting(true);
    try {
      if (selectedCustomer) {
        const updatedCustomer = await customersService.update(selectedCustomer.id, data);

        if (updatedCustomer) {
          // Optimistic update in accumulated list
          setAccumulatedCustomers(prev =>
            prev.map(c => (c.id === selectedCustomer.id ? updatedCustomer : c))
          );
        }

        toast({
          title: 'Cliente actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        await customersService.create(data);

        // Full refetch to get correct server-side ordering
        invalidateCustomers();

        toast({
          title: 'Cliente creado',
          description: 'El cliente ha sido agregado exitosamente.',
        });
      }
      setDialogOpen(false);
      // Refresh stats after create/update
      queryClient.invalidateQueries({ queryKey: ['customers', 'stats'] });
    } catch (error: unknown) {
      invalidateCustomers();

      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Ocurrió un error al guardar el cliente.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Initial loading state (no data at all yet)
  const isInitialLoad = isLoading && customers.length === 0;

  // Compute repeat customer percentage for subtitle
  const repeatPct = stats?.overview
    ? stats.overview.total_customers > 0
      ? Math.round((stats.overview.repeat_customers / stats.overview.total_customers) * 100)
      : 0
    : 0;

  if (isInitialLoad) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Clientes</h2>
            <p className="text-muted-foreground">Gestiona tu base de clientes</p>
          </div>
        </div>
        {/* Stats skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!isLoading && customers.length === 0 && !debouncedSearch && !hasActiveFilters) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Clientes</h2>
            <p className="text-muted-foreground">Gestiona tu base de clientes</p>
          </div>
        </div>
        <EmptyState
          icon={Users}
          title="No hay clientes registrados"
          description="Comienza agregando tu primer cliente para gestionar tus ventas."
          action={{
            label: 'Agregar Primer Cliente',
            onClick: handleCreate,
          }}
        />

        {/* Customer Form Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
              </DialogTitle>
            </DialogHeader>
            <CustomerForm
              customer={selectedCustomer || undefined}
              onSubmit={handleSubmit}
              onCancel={() => setDialogOpen(false)}
              isSubmitting={isSubmitting}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* First-time Welcome Banner */}
      <FirstTimeWelcomeBanner
        moduleId="customers"
        title="Bienvenido a Clientes"
        description="Aqui gestionas tu base de clientes con datos de contacto e historial de compras."
        tips={['Guarda direcciones completas', 'Ve historial de pedidos', 'Confirma por WhatsApp']}
      />

      {/* Stats KPIs Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              title="Total Clientes"
              value={stats?.overview.total_customers ?? 0}
              icon={<Users className="text-primary" size={24} />}
            />
            <MetricCard
              title="Clientes Recurrentes"
              value={stats?.overview.repeat_customers ?? 0}
              icon={<Users className="text-green-600" size={24} />}
              subtitle={`${repeatPct}% del total`}
            />
            <MetricCard
              title="Pedidos Promedio"
              value={(stats?.overview.avg_orders_per_customer ?? 0).toFixed(1)}
              icon={<ShoppingBag className="text-blue-600" size={24} />}
              subtitle="por cliente"
            />
            <MetricCard
              title="Valor Promedio"
              value={formatCurrency(stats?.overview.avg_lifetime_value ?? 0)}
              icon={<DollarSign className="text-emerald-600" size={24} />}
              subtitle="valor de vida"
            />
          </>
        )}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Clientes</h2>
          <p className="text-muted-foreground">
            {pagination.total > 0
              ? `${pagination.total} cliente${pagination.total !== 1 ? 's' : ''} registrado${pagination.total !== 1 ? 's' : ''}`
              : 'Gestiona tu base de clientes'}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={customers}
            filename="clientes"
            columns={customersExportColumns}
            title="Base de Clientes, Ordefy"
            variant="outline"
          />
          <Button onClick={handleCreate} className="gap-2 bg-primary hover:bg-primary/90">
            <Plus size={18} />
            Agregar Cliente
          </Button>
        </div>
      </div>

      {/* Search Bar + Sort Controls */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Buscar por nombre, email o telefono..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-9"
          />
          <AnimatePresence>
            {searchQuery && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors rounded-full p-0.5 hover:bg-muted"
                aria-label="Limpiar busqueda"
              >
                <X size={16} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Sort Controls + View Toggle */}
        <div className="flex items-center gap-2">
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger className="w-full md:w-44 h-10">
              <div className="flex items-center gap-2">
                <ArrowUpDown size={14} className="text-muted-foreground shrink-0" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Fecha de Registro</SelectItem>
              <SelectItem value="name">Nombre</SelectItem>
              <SelectItem value="total_spent">Total Gastado</SelectItem>
              <SelectItem value="total_orders">Total Pedidos</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
            title={sortDirection === 'asc' ? 'Ascendente (click para descendente)' : 'Descendente (click para ascendente)'}
          >
            <motion.div
              animate={{ rotate: sortDirection === 'asc' ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ArrowUpDown size={16} />
            </motion.div>
          </Button>

          {/* View Mode Toggle */}
          <div className="flex items-center rounded-md border bg-background">
            <Button
              variant="ghost"
              size="icon"
              className={`h-10 w-10 rounded-r-none ${viewMode === 'cards' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
              onClick={() => handleViewModeChange('cards')}
              title="Vista de tarjetas"
            >
              <LayoutGrid size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-10 w-10 rounded-l-none ${viewMode === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
              onClick={() => handleViewModeChange('table')}
              title="Vista de tabla"
            >
              <List size={16} />
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <CustomerFilters
        onFiltersChange={handleFiltersChange}
        currentFilters={currentFilters}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Customers: Cards or Table */}
      {viewMode === 'table' ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead>Telefono</TableHead>
                <TableHead className="hidden md:table-cell">Ciudad</TableHead>
                <TableHead className="text-center">Pedidos</TableHead>
                <TableHead className="text-right">Total Gastado</TableHead>
                <TableHead className="hidden lg:table-cell">Ultimo Pedido</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="popLayout">
                {customers.map((customer, index) => (
                  <motion.tr
                    key={customer.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: Math.min(index, 20) * 0.02, duration: 0.2 }}
                    className="border-b transition-colors hover:bg-muted/50 group"
                  >
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        onClick={() => navigate(`/customers/${customer.id}`)}
                        className="text-left cursor-pointer hover:underline decoration-primary/50 underline-offset-2"
                      >
                        {customer.first_name} {customer.last_name}
                      </button>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {customer.email || '-'}
                    </TableCell>
                    <TableCell>
                      {customer.phone ? (
                        <a
                          href={`https://wa.me/${sanitizePhone(customer.phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                        >
                          <Phone size={13} className="shrink-0" />
                          {customer.phone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {customer.city || '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="tabular-nums">
                        {customer.total_orders}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(customer.total_spent)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                      {customer.last_order_at ? formatRelativeDate(customer.last_order_at) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setQuickViewCustomer(customer)}
                          title="Vista rapida"
                        >
                          <Eye size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleEdit(customer)}
                          title="Editar"
                        >
                          <Edit size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(customer.id)}
                          title="Eliminar"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {customers.map((customer, index) => (
            <motion.div
              key={customer.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 12) * 0.05 }}
            >
              <Card
                className="overflow-hidden hover:shadow-lg transition-all duration-300 hover:border-primary/50 cursor-pointer"
                onClick={() => navigate(`/customers/${customer.id}`)}
              >
                <div className="p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-1">
                        {customer.first_name} {customer.last_name}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {customer.accepts_marketing && (
                          <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">
                            Marketing
                          </Badge>
                        )}
                        {customer.total_orders > 0 && (
                          <Badge variant="outline" className="bg-green-500/20 text-green-700 border-green-500/30">
                            {customer.total_orders} pedido{customer.total_orders !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail size={16} className="text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground truncate">{customer.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Phone size={16} className="text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">{customer.phone}</span>
                    </div>
                    {customer.city && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin size={16} className="text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">{customer.city}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm">
                      <ShoppingBag size={16} className="text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">
                        Gastado: <span className="font-semibold">{formatCurrency(customer.total_spent)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => navigate(`/customers/${customer.id}`)}
                    >
                      <Eye size={16} />
                      Ver
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2"
                      onClick={() => handleEdit(customer)}
                    >
                      <Edit size={16} />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(customer.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Load More */}
      {pagination.hasMore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-2 pt-2"
        >
          <p className="text-sm text-muted-foreground">
            Mostrando {customers.length} de {pagination.total}
          </p>
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isFetching}
            className="gap-2"
          >
            {isFetching ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Cargando...
              </>
            ) : (
              'Cargar mas'
            )}
          </Button>
        </motion.div>
      )}

      {customers.length === 0 && (debouncedSearch || hasActiveFilters) && !isLoading && (
        <EmptyState
          icon={Search}
          title="No se encontraron clientes"
          description={
            debouncedSearch
              ? `No hay resultados para "${debouncedSearch}"`
              : 'No hay clientes que coincidan con los filtros aplicados'
          }
        />
      )}

      {/* Customer Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
            </DialogTitle>
          </DialogHeader>
          <CustomerForm
            customer={selectedCustomer || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
            isSubmitting={isSubmitting}
          />
        </DialogContent>
      </Dialog>

      {/* Customer Quick View */}
      <CustomerQuickView
        customer={quickViewCustomer}
        open={!!quickViewCustomer}
        onClose={() => setQuickViewCustomer(null)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Eliminar cliente?"
        description="Esta accion no se puede deshacer. El cliente sera eliminado permanentemente si no tiene pedidos asociados."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />
    </div>
  );
}
