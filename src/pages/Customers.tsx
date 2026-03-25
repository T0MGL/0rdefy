import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { ExportButton } from '@/components/ExportButton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { customersService } from '@/services/customers.service';
import { useToast } from '@/hooks/use-toast';
import { usePhoneAutoPasteSimple } from '@/hooks/usePhoneAutoPaste';
import { useDebounce } from '@/hooks/useDebounce';
import { Plus, Edit, Trash2, Users, Mail, Phone, ShoppingBag, Search, X, ArrowUpDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Customer } from '@/types';
import { customersExportColumns } from '@/utils/exportConfigs';
import { formatCurrency } from '@/utils/currency';

interface CustomerFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  accepts_marketing: boolean;
}

function CustomerForm({
  customer,
  onSubmit,
  onCancel,
  isSubmitting
}: {
  customer?: Customer;
  onSubmit: (data: CustomerFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}) {
  const [formData, setFormData] = useState({
    first_name: customer?.first_name || '',
    last_name: customer?.last_name || '',
    email: customer?.email || '',
    phone: customer?.phone || '',
    accepts_marketing: customer?.accepts_marketing ?? true,
  });

  // Auto-format phone on paste
  const handlePhonePaste = usePhoneAutoPasteSimple((fullPhone) => {
    setFormData({ ...formData, phone: fullPhone });
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Nombre</label>
          <Input
            placeholder="Juan"
            value={formData.first_name}
            onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Apellido</label>
          <Input
            placeholder="Pérez"
            value={formData.last_name}
            onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Email</label>
        <Input
          type="email"
          placeholder="cliente@ejemplo.com"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Teléfono</label>
        <Input
          type="tel"
          placeholder="+595981234567"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          onPaste={handlePhonePaste}
          required
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="accepts_marketing"
          checked={formData.accepts_marketing}
          onChange={(e) => setFormData({ ...formData, accepts_marketing: e.target.checked })}
          className="rounded border-gray-300"
        />
        <label htmlFor="accepts_marketing" className="text-sm">
          Acepta recibir comunicaciones de marketing
        </label>
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1 bg-primary hover:bg-primary/90">
          {isSubmitting ? 'Guardando...' : customer ? 'Actualizar' : 'Crear'}
        </Button>
      </div>
    </form>
  );
}

type SortField = 'name' | 'total_spent' | 'total_orders' | 'created_at';
type SortDirection = 'asc' | 'desc';

export default function Customers() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // URL-param-driven state for search and sort
  const searchQuery = searchParams.get('q') || '';
  const sortField = (searchParams.get('sort') || 'created_at') as SortField;
  const sortDirection = (searchParams.get('dir') || 'desc') as SortDirection;

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

  // Extended stale window: customer data changes infrequently
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: customersService.getAll,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const debouncedSearch = useDebounce(searchQuery, 300);

  const filteredCustomers = useMemo(() => {
    let result = customers;

    if (debouncedSearch.trim() !== '') {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (customer) =>
          (customer.first_name || '').toLowerCase().includes(query) ||
          (customer.last_name || '').toLowerCase().includes(query) ||
          (customer.email || '').toLowerCase().includes(query) ||
          (customer.phone || '').includes(query)
      );
    }

    // Sort
    const sorted = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name': {
          const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
          const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
          comparison = nameA.localeCompare(nameB);
          break;
        }
        case 'total_spent':
          comparison = (a.total_spent || 0) - (b.total_spent || 0);
          break;
        case 'total_orders':
          comparison = (a.total_orders || 0) - (b.total_orders || 0);
          break;
        case 'created_at': {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          comparison = dateA - dateB;
          break;
        }
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [debouncedSearch, customers, sortField, sortDirection]);

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

  const confirmDelete = async () => {
    if (!customerToDelete) return;

    try {
      // Optimistic update: remove from cache immediately
      queryClient.setQueryData<Customer[]>(['customers'], (old = []) =>
        old.filter(c => c.id !== customerToDelete)
      );

      await customersService.delete(customerToDelete);

      setDeleteDialogOpen(false);
      setCustomerToDelete(null);

      toast({
        title: 'Cliente eliminado',
        description: 'El cliente ha sido eliminado exitosamente.',
      });
    } catch (error: unknown) {
      queryClient.invalidateQueries({ queryKey: ['customers'] });

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
          // Optimistic update: update in React Query cache
          queryClient.setQueryData<Customer[]>(['customers'], (old = []) =>
            old.map(c => (c.id === selectedCustomer.id ? updatedCustomer : c))
          );
        }

        toast({
          title: 'Cliente actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        const newCustomer = await customersService.create(data);

        // Optimistic update: add to React Query cache
        queryClient.setQueryData<Customer[]>(['customers'], (old = []) =>
          [newCustomer, ...old]
        );

        toast({
          title: 'Cliente creado',
          description: 'El cliente ha sido agregado exitosamente.',
        });
      }
      setDialogOpen(false);
    } catch (error: unknown) {
      queryClient.invalidateQueries({ queryKey: ['customers'] });

      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Ocurrió un error al guardar el cliente.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Clientes</h2>
            <p className="text-muted-foreground">Gestiona tu base de clientes</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (customers.length === 0) {
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
          <DialogContent className="max-w-md">
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
        title="¡Bienvenido a Clientes!"
        description="Aquí gestionas tu base de clientes con datos de contacto e historial de compras."
        tips={['Guarda direcciones completas', 'Ve historial de pedidos', 'Confirma por WhatsApp']}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Clientes</h2>
          <p className="text-muted-foreground">
            {customers.length} cliente{customers.length !== 1 ? 's' : ''} registrado{customers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={filteredCustomers}
            filename="clientes"
            columns={customersExportColumns}
            title="Base de Clientes - Ordefy"
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

        {/* Sort Controls */}
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
        </div>
      </div>

      {/* Customers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCustomers.map((customer, index) => (
          <motion.div
            key={customer.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 hover:border-primary/50">
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
                    <Mail size={16} className="text-muted-foreground" />
                    <span className="text-muted-foreground truncate">{customer.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone size={16} className="text-muted-foreground" />
                    <span className="text-muted-foreground">{customer.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <ShoppingBag size={16} className="text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Gastado: <span className="font-semibold">{formatCurrency(customer.total_spent)}</span>
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
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

      {filteredCustomers.length === 0 && searchQuery && (
        <EmptyState
          icon={Search}
          title="No se encontraron clientes"
          description={`No hay resultados para "${searchQuery}"`}
        />
      )}

      {/* Customer Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
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

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="¿Eliminar cliente?"
        description="Esta acción no se puede deshacer. El cliente será eliminado permanentemente si no tiene pedidos asociados."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />
    </div>
  );
}
