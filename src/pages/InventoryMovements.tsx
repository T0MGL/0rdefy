import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { inventoryService, InventoryMovement } from '@/services/inventory';
import { useDebounce } from '@/hooks/useDebounce';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, TrendingDown, TrendingUp, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { es } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';

// Movement type labels and colors
const MOVEMENT_TYPES = {
  order_ready: { label: 'Pedido Listo', color: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400', icon: TrendingDown },
  order_cancelled: { label: 'Pedido Cancelado', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400', icon: TrendingUp },
  order_reverted: { label: 'Pedido Revertido', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400', icon: TrendingUp },
  manual_adjustment: { label: 'Ajuste Manual', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400', icon: Package },
  return_accepted: { label: 'Devolución Aceptada', color: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400', icon: TrendingUp },
  return_rejected: { label: 'Devolución Rechazada', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400', icon: Package },
  inbound_received: { label: 'Recepción de Proveedor', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-400', icon: TrendingUp },
};

const PAGE_SIZE = 50;

export function InventoryMovements() {
  const { currentStore } = useAuth();
  const timezone = currentStore?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [searchParams, setSearchParams] = useSearchParams();

  // URL params as source of truth for filters and pagination
  const search = searchParams.get('q') || '';
  const movementType = searchParams.get('type') || 'all';
  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';
  const page = parseInt(searchParams.get('page') || '0', 10);

  const [showFiltersPanel, setShowFiltersPanel] = useState(
    movementType !== 'all' || !!dateFrom || !!dateTo
  );

  const searchDebounced = useDebounce(search, 300);

  const setSearch = useCallback((value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set('q', value);
      else next.delete('q');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setMovementType = useCallback((value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value && value !== 'all') next.set('type', value);
      else next.delete('type');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setDateFrom = useCallback((value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set('from', value);
      else next.delete('from');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setDateTo = useCallback((value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set('to', value);
      else next.delete('to');
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setPage = useCallback((p: number) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (p > 0) next.set('page', String(p));
      else next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Fetch movements with pagination
  const { data: movementsData, isLoading, error, refetch } = useQuery({
    queryKey: ['inventory-movements', searchDebounced, movementType, dateFrom, dateTo, page],
    queryFn: () =>
      inventoryService.getMovements({
        search: searchDebounced || undefined,
        movement_type: movementType !== 'all' ? movementType : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  // Fetch summary
  const { data: summary } = useQuery({
    queryKey: ['inventory-summary', dateFrom, dateTo],
    queryFn: () =>
      inventoryService.getSummary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
  });

  const movements = movementsData?.data || [];
  const totalMovements = movementsData?.count || 0;

  const totalPages = Math.ceil(totalMovements / PAGE_SIZE);

  const hasActiveFilters = search || movementType !== 'all' || dateFrom || dateTo;

  const handleClearFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const renderMovementBadge = (movement: InventoryMovement) => {
    const typeInfo = MOVEMENT_TYPES[movement.movement_type];
    const Icon = typeInfo?.icon || Package;

    return (
      <Badge variant="secondary" className={typeInfo?.color}>
        <Icon className="w-3 h-3 mr-1" />
        {typeInfo?.label || movement.movement_type}
      </Badge>
    );
  };

  const renderQuantityChange = (change: number) => {
    const isPositive = change > 0;
    return (
      <span className={`font-semibold ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        {isPositive ? '+' : ''}{change}
      </span>
    );
  };

  const renderDescription = (movement: InventoryMovement) => {
    if (movement.notes) {
      return movement.notes;
    }

    if (movement.order_id && movement.orders) {
      const customerName = [
        movement.orders.customer_first_name,
        movement.orders.customer_last_name,
      ]
        .filter(Boolean)
        .join(' ') || 'Cliente';

      return `Pedido de ${customerName}`;
    }

    return movement.movement_type === 'manual_adjustment' ? 'Ajuste manual de inventario' : '-';
  };

  return (
    <div className="p-6 space-y-6">
      <FirstTimeWelcomeBanner
        moduleId="inventory"
        title="¡Bienvenido a Movimientos!"
        description="Visualiza el historial completo de cambios en tu inventario. Cada ajuste, venta y devolución queda registrado."
        tips={['Filtra por tipo de movimiento', 'Busca por producto', 'Exporta el historial']}
      />

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Movimientos de Inventario
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Historial completo de todos los cambios en el stock de productos
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Total Movimientos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {summary.total_movements}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Total Decrementos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                -{summary.total_decrements}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Total Incrementos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                +{summary.total_increments}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Cambio Neto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${summary.net_change >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {summary.net_change >= 0 ? '+' : ''}{summary.net_change}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Buscar por producto o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter Button */}
            <Button
              variant={showFiltersPanel ? 'default' : 'outline'}
              onClick={() => setShowFiltersPanel(!showFiltersPanel)}
            >
              <Filter className="w-4 h-4 mr-2" />
              Filtros
            </Button>
          </div>

          {/* Filters Panel */}
          {showFiltersPanel && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Movement Type Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tipo de Movimiento
                </label>
                <Select value={movementType} onValueChange={setMovementType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="order_ready">Pedido Listo</SelectItem>
                    <SelectItem value="order_cancelled">Pedido Cancelado</SelectItem>
                    <SelectItem value="order_reverted">Pedido Revertido</SelectItem>
                    <SelectItem value="manual_adjustment">Ajuste Manual</SelectItem>
                    <SelectItem value="return_accepted">Devolución Aceptada</SelectItem>
                    <SelectItem value="return_rejected">Devolución Rechazada</SelectItem>
                    <SelectItem value="inbound_received">Recepción de Proveedor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date From */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Desde
                </label>
                <DateInput
                  value={dateFrom}
                  onChange={(val) => setDateFrom(val)}
                />
              </div>

              {/* Date To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Hasta
                </label>
                <DateInput
                  value={dateTo}
                  onChange={(val) => setDateTo(val)}
                />
              </div>

              {/* Clear Filters Button */}
              <div className="md:col-span-3 flex justify-end">
                <Button variant="ghost" onClick={handleClearFilters}>
                  Limpiar Filtros
                </Button>
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent>
          {/* Skeleton Loading State */}
          {isLoading && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Codigo</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descripcion</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md bg-muted animate-pulse" />
                          <div className="h-4 w-28 bg-muted animate-pulse rounded" />
                        </div>
                      </TableCell>
                      <TableCell><div className="h-4 w-16 bg-muted animate-pulse rounded" /></TableCell>
                      <TableCell><div className="h-4 w-10 bg-muted animate-pulse rounded" /></TableCell>
                      <TableCell><div className="h-4 w-20 bg-muted animate-pulse rounded" /></TableCell>
                      <TableCell><div className="h-5 w-24 bg-muted animate-pulse rounded-full" /></TableCell>
                      <TableCell><div className="h-4 w-32 bg-muted animate-pulse rounded" /></TableCell>
                      <TableCell><div className="h-4 w-20 bg-muted animate-pulse rounded" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="text-center py-12">
              <p className="text-red-600 dark:text-red-400 mb-4">
                Error al cargar los movimientos de inventario
              </p>
              <button
                onClick={() => refetch()}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Empty State: differentiate between no results with filters vs genuinely empty */}
          {!isLoading && !error && movements.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              {hasActiveFilters ? (
                <>
                  <p className="text-gray-600 dark:text-gray-400 font-medium">
                    No se encontraron movimientos con estos filtros
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Intenta cambiar los filtros o limpiar la busqueda
                  </p>
                  <Button variant="ghost" className="mt-4" onClick={handleClearFilters}>
                    Limpiar filtros
                  </Button>
                </>
              ) : (
                <p className="text-gray-600 dark:text-gray-400">
                  No hay movimientos de inventario registrados
                </p>
              )}
            </div>
          )}

          {/* Movements Table */}
          {!isLoading && !error && movements.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Codigo</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descripcion</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {movement.products?.image_url ? (
                            <img
                              src={movement.products.image_url}
                              alt={movement.products.name}
                              className="w-10 h-10 rounded-md object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                              <Package className="w-5 h-5 text-gray-400" />
                            </div>
                          )}
                          <span className="font-medium text-gray-900 dark:text-white">
                            {movement.products?.name || 'Producto eliminado'}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                          {movement.products?.sku || '-'}
                        </code>
                      </TableCell>

                      <TableCell>{renderQuantityChange(movement.quantity_change)}</TableCell>

                      <TableCell>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {movement.stock_before} &rarr; {movement.stock_after}
                        </span>
                      </TableCell>

                      <TableCell>{renderMovementBadge(movement)}</TableCell>

                      <TableCell className="max-w-xs truncate">
                        {renderDescription(movement)}
                      </TableCell>

                      <TableCell>
                        <div className="text-sm">
                          <div className="text-gray-900 dark:text-white">
                            {formatInTimeZone(new Date(movement.created_at), timezone, 'dd/MM/yyyy', { locale: es })}
                          </div>
                          <div className="text-gray-500 dark:text-gray-400">
                            {formatInTimeZone(new Date(movement.created_at), timezone, 'HH:mm', { locale: es })}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {totalMovements > 0
                    ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, totalMovements)} de ${totalMovements} movimientos`
                    : `${movements.length} movimientos`}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                    >
                      <ChevronLeft size={16} />
                      Anterior
                    </Button>
                    <span className="text-sm text-muted-foreground px-2">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                    >
                      Siguiente
                      <ChevronRight size={16} />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
