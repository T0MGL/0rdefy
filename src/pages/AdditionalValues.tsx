import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, DollarSign, TrendingUp, Users, Settings, Edit, Trash2 } from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';
import { additionalValuesService } from '@/services/additional-values.service';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { AdditionalValue } from '@/types';

const categoryIcons = {
  marketing: <DollarSign className="text-accent" size={24} />,
  sales: <TrendingUp className="text-primary" size={24} />,
  employees: <Users className="text-purple-500" size={24} />,
  operational: <Settings className="text-blue-500" size={24} />,
};

const categoryLabels = {
  marketing: 'Marketing',
  sales: 'Ventas',
  employees: 'Empleados',
  operational: 'Operacional',
};

// Form Component
function AdditionalValueForm({ value, onSubmit, onCancel }: { value?: AdditionalValue; onSubmit: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    category: value?.category || 'marketing',
    description: value?.description || '',
    amount: value?.amount || 0,
    type: value?.type || 'expense',
    date: value?.date || new Date().toISOString().split('T')[0],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Categoría *</label>
        <Select value={formData.category} onValueChange={(val) => setFormData({ ...formData, category: val })}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="marketing">Marketing</SelectItem>
            <SelectItem value="sales">Ventas</SelectItem>
            <SelectItem value="employees">Empleados</SelectItem>
            <SelectItem value="operational">Operacional</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Descripción *</label>
        <Input
          placeholder="Ej: Campaña Facebook Ads"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Monto (Gs.) *</label>
          <Input
            type="number"
            placeholder="0"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
            required
            min="0"
            step="0.01"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Tipo *</label>
          <Select value={formData.type} onValueChange={(val) => setFormData({ ...formData, type: val })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Gasto</SelectItem>
              <SelectItem value="income">Ingreso</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Fecha *</label>
        <Input
          type="date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          required
        />
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90">
          {value ? 'Actualizar' : 'Registrar'}
        </Button>
      </div>
    </form>
  );
}

export default function AdditionalValues() {
  const [values, setValues] = useState<AdditionalValue[]>([]);
  const [summary, setSummary] = useState({ marketing: 0, sales: 0, employees: 0, operational: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState<AdditionalValue | null>(null);
  const [valueToDelete, setValueToDelete] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [valuesData, summaryData] = await Promise.all([
      additionalValuesService.getAll(),
      additionalValuesService.getSummary()
    ]);
    setValues(valuesData);
    setSummary(summaryData);
    setIsLoading(false);
  };

  const handleCreate = () => {
    setSelectedValue(null);
    setDialogOpen(true);
  };

  const handleEdit = (value: AdditionalValue) => {
    setSelectedValue(value);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setValueToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!valueToDelete) return;

    try {
      await additionalValuesService.delete(valueToDelete);
      await loadData();
      toast({
        title: 'Valor eliminado',
        description: 'El valor ha sido eliminado exitosamente.',
      });
    } catch (error: any) {
      toast({
        title: 'Error al eliminar',
        description: error.message || 'No se pudo eliminar el valor.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      if (selectedValue) {
        await additionalValuesService.update(selectedValue.id, data);
        toast({
          title: 'Valor actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        await additionalValuesService.create(data);
        toast({
          title: 'Valor registrado',
          description: 'El valor ha sido registrado exitosamente.',
        });
      }
      await loadData();
      setDialogOpen(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Ocurrió un error al guardar el valor.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <div className="space-y-6"><div className="text-center py-8">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Valores Adicionales</h2>
          <p className="text-muted-foreground">Registra gastos e ingresos adicionales</p>
        </div>
        <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={handleCreate}>
          <Plus size={18} />
          Registrar Valor
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Marketing"
          value={`Gs. ${Math.abs(summary.marketing).toLocaleString()}`}
          icon={categoryIcons.marketing}
          variant="secondary"
        />
        <MetricCard
          title="Ventas"
          value={`Gs. ${Math.abs(summary.sales).toLocaleString()}`}
          icon={categoryIcons.sales}
          variant="primary"
        />
        <MetricCard
          title="Empleados"
          value={`Gs. ${Math.abs(summary.employees).toLocaleString()}`}
          icon={categoryIcons.employees}
          variant="purple"
        />
        <MetricCard
          title="Operacional"
          value={`Gs. ${Math.abs(summary.operational).toLocaleString()}`}
          icon={categoryIcons.operational}
          variant="accent"
        />
      </div>

      {/* Values Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Categoría
                </th>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Descripción
                </th>
                <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                  Tipo
                </th>
                <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">
                  Monto
                </th>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Fecha
                </th>
                <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {values.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No hay valores registrados. Haz clic en "Registrar Valor" para comenzar.
                  </td>
                </tr>
              ) : (
                values.map((value) => (
                  <tr key={value.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        {categoryIcons[value.category]}
                        <span className="text-sm font-medium">
                          {categoryLabels[value.category]}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm">{value.description}</td>
                    <td className="py-4 px-6 text-center">
                      <Badge
                        variant="outline"
                        className={
                          value.type === 'expense'
                            ? 'bg-red-500/20 text-red-700 border-red-500/30'
                            : 'bg-primary/20 text-primary border-primary/30'
                        }
                      >
                        {value.type === 'expense' ? 'Gasto' : 'Ingreso'}
                      </Badge>
                    </td>
                    <td className="py-4 px-6 text-right text-sm font-semibold">
                      Gs. {value.amount.toLocaleString()}
                    </td>
                    <td className="py-4 px-6 text-sm">{value.date}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(value)}
                        >
                          <Edit size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(value.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedValue ? 'Editar Valor' : 'Registrar Nuevo Valor'}
            </DialogTitle>
          </DialogHeader>
          <AdditionalValueForm
            value={selectedValue || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="¿Eliminar valor?"
        description="Esta acción no se puede deshacer. El valor será eliminado permanentemente."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />
    </div>
  );
}
