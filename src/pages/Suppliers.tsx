import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ExportButton } from '@/components/ExportButton';
import { suppliersService } from '@/services/suppliers.service';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { onboardingService } from '@/services/onboarding.service';
import { Plus, Star, Edit, Trash2, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { Supplier } from '@/types';
import { suppliersExportColumns } from '@/utils/exportConfigs';

// Supplier Form Component
function SupplierForm({ supplier, onSubmit, onCancel }: { supplier?: Supplier; onSubmit: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: supplier?.name || '',
    contact_person: supplier?.contact_person || '',
    email: supplier?.email || '',
    phone: supplier?.phone || '',
    rating: supplier?.rating || 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Nombre del Proveedor *</label>
        <Input
          placeholder="TechSupply LATAM"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Persona de Contacto</label>
        <Input
          placeholder="Juan Pérez"
          value={formData.contact_person}
          onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <Input
            type="email"
            placeholder="contacto@proveedor.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Teléfono</label>
          <Input
            type="tel"
            placeholder="+595981234567"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Rating (0-5)</label>
        <Input
          type="number"
          min="0"
          max="5"
          step="0.1"
          value={formData.rating}
          onChange={(e) => setFormData({ ...formData, rating: parseFloat(e.target.value) })}
        />
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90">
          {supplier ? 'Actualizar' : 'Crear'}
        </Button>
      </div>
    </form>
  );
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    const data = await suppliersService.getAll();
    setSuppliers(data);
    setIsLoading(false);
  };

  const handleCreate = () => {
    setSelectedSupplier(null);
    setDialogOpen(true);
  };

  const handleEdit = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setSupplierToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!supplierToDelete) return;

    try {
      await suppliersService.delete(supplierToDelete);
      await loadSuppliers();
      toast({
        title: 'Proveedor eliminado',
        description: 'El proveedor ha sido eliminado exitosamente.',
      });
    } catch (error: any) {
      toast({
        title: 'Error al eliminar',
        description: error.message || 'No se pudo eliminar el proveedor.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      if (selectedSupplier) {
        await suppliersService.update(selectedSupplier.id, data);
        toast({
          title: 'Proveedor actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        await suppliersService.create(data);
        toast({
          title: 'Proveedor creado',
          description: 'El proveedor ha sido agregado exitosamente.',
        });
        // Mark first action completed (hides the onboarding tip)
        onboardingService.markFirstActionCompleted('suppliers');
      }
      await loadSuppliers();
      setDialogOpen(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Ocurrió un error al guardar el proveedor.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Proveedores</h2>
            <p className="text-muted-foreground">Gestiona tus proveedores y contactos</p>
          </div>
        </div>
        <CardSkeleton />
      </div>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Proveedores</h2>
            <p className="text-muted-foreground">Gestiona tus proveedores y contactos</p>
          </div>
        </div>
        <EmptyState
          icon={Users}
          title="No hay proveedores registrados"
          description="Comienza agregando tu primer proveedor para gestionar tu inventario."
          action={{
            label: 'Agregar Primer Proveedor',
            onClick: handleCreate,
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FirstTimeWelcomeBanner
        moduleId="suppliers"
        title="¡Bienvenido a Proveedores!"
        description="Registra tus proveedores de productos. Centraliza contactos y facilita la gestión de mercadería entrante."
        tips={['Agrega proveedores', 'Guarda datos de contacto', 'Asocia a envíos de mercadería']}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Proveedores</h2>
          <p className="text-muted-foreground">
            {suppliers.length} proveedor{suppliers.length !== 1 ? 'es' : ''} registrado{suppliers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={suppliers}
            filename="proveedores"
            columns={suppliersExportColumns}
            title="Proveedores - Ordefy"
            variant="outline"
          />
          <Button
            onClick={() => {
              logger.log('🖱️ [SUPPLIERS] Button clicked - opening dialog');
            handleCreate();
          }}
          className="gap-2 bg-primary hover:bg-primary/90 cursor-pointer hover:scale-105 active:scale-95 transition-all duration-200 z-50 relative"
        >
          <Plus size={18} />
          Agregar Proveedor
        </Button>
        </div>
      </div>

      {/* Suppliers Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Nombre
                </th>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Contacto
                </th>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Email
                </th>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Teléfono
                </th>
                <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                  Rating
                </th>
                <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                  Productos
                </th>
                <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr
                  key={supplier.id}
                  className="border-t border-border hover:bg-muted/30 transition-colors"
                >
                  <td className="py-4 px-6 text-sm font-medium">{supplier.name}</td>
                  <td className="py-4 px-6 text-sm">{supplier.contact_person || '-'}</td>
                  <td className="py-4 px-6 text-sm text-muted-foreground">{supplier.email || '-'}</td>
                  <td className="py-4 px-6 text-sm text-muted-foreground">{supplier.phone || '-'}</td>
                  <td className="py-4 px-6">
                    <div className="flex items-center justify-center gap-1">
                      {supplier.rating ? (
                        <>
                          <Star className="fill-primary text-primary" size={16} />
                          <span className="text-sm font-semibold">{supplier.rating.toFixed(1)}</span>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <Badge variant="outline">{supplier.products_supplied || supplier.products_count || 0}</Badge>
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(supplier)}
                      >
                        <Edit size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(supplier.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Supplier Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            </DialogTitle>
          </DialogHeader>
          <SupplierForm
            supplier={selectedSupplier || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="¿Eliminar proveedor?"
        description="Esta acción no se puede deshacer. El proveedor será eliminado permanentemente si no tiene productos asignados."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />
    </div>
  );
}
