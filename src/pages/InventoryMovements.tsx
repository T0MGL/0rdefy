import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryService, InventoryMovement } from '@/services/inventory';
import { Input } from '@/components/ui/input';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, TrendingDown, TrendingUp, Package, Calendar } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
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

export function InventoryMovements() {
  const { currentStore } = useAuth();
  const timezone = currentStore?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [movementType, setMovementType] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchDebounced(search);
    }, 500);

    return () => clearTimeout(timer);
  }, [search]);

  // Fetch movements
  const { data: movementsData, isLoading, error } = useQuery({
    queryKey: ['inventory-movements', searchDebounced, movementType, dateFrom, dateTo],
    queryFn: () =>
      inventoryService.getMovements({
        search: searchDebounced || undefined,
        movement_type: movementType !== 'all' ? movementType : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 100,
      }),
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

  const handleClearFilters = () => {
    setMovementType('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

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
              variant={showFilters ? 'default' : 'outline'}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-4 h-4 mr-2" />
              Filtros
            </Button>
          </div>

          {/* Filters Panel */}
          {showFilters && (
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
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Date To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Hasta
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="pl-10"
                  />
                </div>
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
          {/* Loading State */}
          {isLoading && (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="text-center py-12">
              <p className="text-red-600 dark:text-red-400">
                Error al cargar los movimientos de inventario
              </p>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && movements.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                No se encontraron movimientos de inventario
              </p>
            </div>
          )}

          {/* Movements Table */}
          {!isLoading && !error && movements.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement) => (
                    <TableRow key={movement.id}>
                      {/* Product */}
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

                      {/* SKU */}
                      <TableCell>
                        <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                          {movement.products?.sku || '-'}
                        </code>
                      </TableCell>

                      {/* Quantity Change */}
                      <TableCell>{renderQuantityChange(movement.quantity_change)}</TableCell>

                      {/* Stock Before → After */}
                      <TableCell>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {movement.stock_before} → {movement.stock_after}
                        </span>
                      </TableCell>

                      {/* Movement Type */}
                      <TableCell>{renderMovementBadge(movement)}</TableCell>

                      {/* Description */}
                      <TableCell className="max-w-xs truncate">
                        {renderDescription(movement)}
                      </TableCell>

                      {/* Date */}
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

              {/* Results Summary */}
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-400 text-center">
                Mostrando {movements.length} de {totalMovements} movimientos
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
