
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, DollarSign, TrendingUp, Users, Settings, Edit, Trash2, Calendar, Repeat } from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { onboardingService } from '@/services/onboarding.service';
import { additionalValuesService } from '@/services/additional-values.service';
import { recurringAdditionalValuesService, RecurringAdditionalValue } from '@/services/recurring-additional-values.service';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { AdditionalValue } from '@/types';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';
import { logger } from '@/utils/logger';

const categoryIcons: Record<string, JSX.Element> = {
  gasto_publicitario: <DollarSign className="text-accent" size={24} />,
  sales: <TrendingUp className="text-primary" size={24} />,
  employees: <Users className="text-purple-500" size={24} />,
  operational: <Settings className="text-blue-500" size={24} />,
};

const categoryLabels: Record<string, string> = {
  gasto_publicitario: 'Gasto Publicitario',
  sales: 'Ventas',
  employees: 'Empleados',
  operational: 'Operacional',
};

// --- ONE-TIME VALUE FORM ---
function AdditionalValueForm({ value, onSubmit, onCancel }: { value?: AdditionalValue; onSubmit: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    category: value?.category || 'gasto_publicitario',
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
            <SelectItem value="gasto_publicitario">Gasto Publicitario</SelectItem>
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
          <label className="text-sm font-medium">Monto ({getCurrencySymbol()}) *</label>
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

// --- RECURRING VALUE FORM ---
function RecurringValueForm({ value, onSubmit, onCancel }: { value?: RecurringAdditionalValue; onSubmit: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    category: value?.category || 'gasto_publicitario',
    description: value?.description || '',
    amount: value?.amount || 0,
    type: value?.type || 'expense',
    frequency: value?.frequency || 'monthly',
    start_date: value?.start_date ? new Date(value.start_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-blue-50 text-blue-700 p-3 rounded-md text-sm mb-4 flex items-start gap-2">
        <Calendar className="mt-0.5 shrink-0" size={16} />
        <p>Los valores recurrentes se generarán automáticamente en la fecha correspondiente según la frecuencia elegida.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Categoría *</label>
        <Select value={formData.category} onValueChange={(val) => setFormData({ ...formData, category: val })}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gasto_publicitario">Gasto Publicitario</SelectItem>
            <SelectItem value="sales">Ventas</SelectItem>
            <SelectItem value="employees">Empleados</SelectItem>
            <SelectItem value="operational">Operacional</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Descripción *</label>
        <Input
          placeholder="Ej: Alquiler de Oficina"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Monto ({getCurrencySymbol()}) *</label>
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Frecuencia *</label>
          <Select value={formData.frequency} onValueChange={(val: any) => setFormData({ ...formData, frequency: val })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Mensual</SelectItem>
              <SelectItem value="annually">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Fecha Inicio *</label>
          <Input
            type="date"
            value={formData.start_date}
            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90">
          {value ? 'Actualizar' : 'Crear Recurrente'}
        </Button>
      </div>
    </form>
  );
}


export default function AdditionalValues() {
  const [values, setValues] = useState<AdditionalValue[]>([]);
  const [recurringValues, setRecurringValues] = useState<RecurringAdditionalValue[]>([]);
  const [summary, setSummary] = useState({ gasto_publicitario: 0, sales: 0, employees: 0, operational: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteRecurringDialogOpen, setDeleteRecurringDialogOpen] = useState(false);

  // Selection states
  const [selectedValue, setSelectedValue] = useState<AdditionalValue | null>(null);
  const [selectedRecurringValue, setSelectedRecurringValue] = useState<RecurringAdditionalValue | null>(null);
  const [valueToDelete, setValueToDelete] = useState<string | null>(null);
  const [recurringToDelete, setRecurringToDelete] = useState<string | null>(null);

  // Ordefy Subscription Dialog
  const [ordefyDialogOpen, setOrdefyDialogOpen] = useState(false);
  const [ordefyAmount, setOrdefyAmount] = useState(29.99);
  const [ordefyStartDate, setOrdefyStartDate] = useState(new Date().toISOString().split('T')[0]);

  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [valuesData, summaryData, recurringData] = await Promise.all([
        additionalValuesService.getAll(),
        additionalValuesService.getSummary(),
        recurringAdditionalValuesService.getAll()
      ]);
      setValues(valuesData);
      setSummary(summaryData);
      setRecurringValues(recurringData);
    } catch (error) {
      logger.error("Failed to load data", error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Handlers for One-Time Values ---
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
      toast({ title: 'Valor eliminado', description: 'El valor ha sido eliminado exitosamente.' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      if (selectedValue) {
        await additionalValuesService.update(selectedValue.id, data);
        toast({ title: 'Valor actualizado', description: 'Cambios guardados exitosamente.' });
      } else {
        await additionalValuesService.create(data);
        toast({ title: 'Valor registrado', description: 'Valor registrado exitosamente.' });
        // Mark first action completed (hides the onboarding tip)
        onboardingService.markFirstActionCompleted('additional-values');
      }
      await loadData();
      setDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  // --- Handlers for Recurring Values ---
  const handleCreateRecurring = () => {
    setSelectedRecurringValue(null);
    setRecurringDialogOpen(true);
  };

  const handleEditRecurring = (value: RecurringAdditionalValue) => {
    setSelectedRecurringValue(value);
    setRecurringDialogOpen(true);
  };

  const handleDeleteRecurring = (id: string) => {
    setRecurringToDelete(id);
    setDeleteRecurringDialogOpen(true);
  };

  const confirmDeleteRecurring = async () => {
    if (!recurringToDelete) return;
    try {
      await recurringAdditionalValuesService.delete(recurringToDelete);
      await loadData();
      toast({ title: 'Valor recurrente eliminado', description: 'La plantilla recurrente ha sido eliminada.' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleSubmitRecurring = async (data: any) => {
    try {
      if (selectedRecurringValue && selectedRecurringValue.id) {
        await recurringAdditionalValuesService.update(selectedRecurringValue.id, data);
        toast({ title: 'Valor recurrente actualizado', description: 'Cambios guardados exitosamente.' });
      } else {
        await recurringAdditionalValuesService.create(data);
        toast({ title: 'Valor recurrente creado', description: 'Se generarán los valores automáticamente.' });
      }
      await loadData();
      setRecurringDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  // --- Ordefy Subscription Handler ---
  const handleAddOrdefy = async () => {
    try {
      await recurringAdditionalValuesService.createOrdefySubscription(ordefyAmount, ordefyStartDate);
      toast({ title: 'Suscripción agregada', description: 'Se ha configurado la suscripción de Ordefy.' });
      await loadData();
      setOrdefyDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <div className="space-y-6"><div className="text-center py-8">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6">
      <FirstTimeWelcomeBanner
        moduleId="additional-values"
        title="¡Bienvenido a Valores Adicionales!"
        description="Registra gastos e ingresos que afectan tu rentabilidad. Incluye publicidad, empleados y costos operativos."
        tips={['Registra gastos únicos', 'Configura recurrentes', 'Ve impacto en Analytics']}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Valores Adicionales</h2>
          <p className="text-muted-foreground">Gestiona gastos e ingresos (únicos o recurrentes)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setOrdefyDialogOpen(true)}>
            <img src="/ordefy-icon.png" alt="Ordefy" className="w-4 h-4 object-contain" onError={(e) => {
              // Fallback if image fails
              e.currentTarget.style.display = 'none';
            }} />
            Incurrir Ordefy
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Gasto Publicitario"
          value={formatCurrency(Math.abs(summary.gasto_publicitario))}
          icon={categoryIcons.gasto_publicitario}
          variant="secondary"
        />
        <MetricCard
          title="Ventas"
          value={formatCurrency(Math.abs(summary.sales))}
          icon={categoryIcons.sales}
          variant="primary"
        />
        <MetricCard
          title="Empleados"
          value={formatCurrency(Math.abs(summary.employees))}
          icon={categoryIcons.employees}
          variant="purple"
        />
        <MetricCard
          title="Operacional"
          value={formatCurrency(Math.abs(summary.operational))}
          icon={categoryIcons.operational}
          variant="accent"
        />
      </div>

      <Tabs defaultValue="unique" className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-4">
          <TabsTrigger value="unique">Valores Únicos</TabsTrigger>
          <TabsTrigger value="recurring">Valores Recurrentes</TabsTrigger>
        </TabsList>

        <TabsContent value="unique" className="space-y-4">
          <div className="flex justify-end">
            <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={handleCreate}>
              <Plus size={18} />
              Registrar Nuevo
            </Button>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">Categoría</th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">Descripción</th>
                    <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">Tipo</th>
                    <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">Monto</th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">Fecha</th>
                    <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {values.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No hay valores registrados.
                      </td>
                    </tr>
                  ) : (
                    values.map((value) => (
                      <tr key={value.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            {categoryIcons[value.category]}
                            <span className="text-sm font-medium">{categoryLabels[value.category]}</span>
                          </div>
                        </td>
                        <td className="py-4 px-6 text-sm">{value.description}</td>
                        <td className="py-4 px-6 text-center">
                          <Badge variant="outline" className={value.type === 'expense' ? 'bg-red-500/20 text-red-700 border-red-500/30' : 'bg-primary/20 text-primary border-primary/30'}>
                            {value.type === 'expense' ? 'Gasto' : 'Ingreso'}
                          </Badge>
                        </td>
                        <td className="py-4 px-6 text-right text-sm font-semibold">{formatCurrency(value.amount)}</td>
                        <td className="py-4 px-6 text-sm">{value.date}</td>
                        <td className="py-4 px-6">
                          <div className="flex items-center justify-center gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(value)}><Edit size={16} /></Button>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(value.id)}><Trash2 size={16} /></Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="recurring" className="space-y-4">
          <div className="flex justify-end">
            <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={handleCreateRecurring}>
              <Repeat size={18} />
              Crear Recurrente
            </Button>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">Categoría</th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">Descripción</th>
                    <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">Frecuencia</th>
                    <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">Monto</th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">Fecha Inicio</th>
                    <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">Último Proc.</th>
                    <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {recurringValues.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No hay valores recurrentes configurados.
                      </td>
                    </tr>
                  ) : (
                    recurringValues.map((rv) => (
                      <tr key={rv.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            {categoryIcons[rv.category]}
                            <span className="text-sm font-medium">{categoryLabels[rv.category]}</span>
                          </div>
                        </td>
                        <td className="py-4 px-6 text-sm">
                          {rv.description}
                          {rv.is_ordefy_subscription && <Badge variant="secondary" className="ml-2 text-xs">Ordefy</Badge>}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <Badge variant="outline" className="capitalize">{rv.frequency === 'monthly' ? 'Mensual' : 'Anual'}</Badge>
                        </td>
                        <td className="py-4 px-6 text-right text-sm font-semibold">{formatCurrency(rv.amount)}</td>
                        <td className="py-4 px-6 text-sm">{rv.start_date.split('T')[0]}</td>
                        <td className="py-4 px-6 text-sm text-muted-foreground">
                          {rv.last_processed_date ? rv.last_processed_date.split('T')[0] : 'Pendiente'}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center justify-center gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleEditRecurring(rv)}><Edit size={16} /></Button>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteRecurring(rv.id!)}><Trash2 size={16} /></Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Unique Value Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedValue ? 'Editar Valor' : 'Registrar Nuevo Valor'}</DialogTitle>
          </DialogHeader>
          <AdditionalValueForm
            value={selectedValue || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Recurring Value Dialog */}
      <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedRecurringValue ? 'Editar Recurrente' : 'Nuevo Valor Recurrente'}</DialogTitle>
          </DialogHeader>
          <RecurringValueForm
            value={selectedRecurringValue || undefined}
            onSubmit={handleSubmitRecurring}
            onCancel={() => setRecurringDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Ordefy Subscription Dialog */}
      <Dialog open={ordefyDialogOpen} onOpenChange={setOrdefyDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Suscripción Ordefy</DialogTitle>
            <DialogDescription>Configura el costo mensual de tu suscripción.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Monto ({getCurrencySymbol()})</label>
              <Input type="number" value={ordefyAmount} onChange={(e) => setOrdefyAmount(parseFloat(e.target.value))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Fecha de Inicio</label>
              <Input type="date" value={ordefyStartDate} onChange={(e) => setOrdefyStartDate(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOrdefyDialogOpen(false)}>Cancelar</Button>
              <Button className="flex-1 bg-primary text-primary-foreground" onClick={handleAddOrdefy}>Guardar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation (Unique) */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="¿Eliminar valor?"
        description="Esta acción eliminará este registro histórico permanentemente."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />

      {/* Delete Confirmation (Recurring) */}
      <ConfirmDialog
        open={deleteRecurringDialogOpen}
        onOpenChange={setDeleteRecurringDialogOpen}
        title="¿Eliminar recurrente?"
        description="Esto detendrá la generación automática de futuros valores. Los valores ya generados se mantendrán en el historial."
        onConfirm={confirmDeleteRecurring}
        variant="destructive"
        confirmText="Eliminar Recurrente"
      />
    </div>
  );
}
