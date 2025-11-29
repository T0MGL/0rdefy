// ================================================================
// SETTLEMENTS PAGE
// ================================================================
// Daily cash reconciliation and settlement management
// ================================================================

import { useEffect, useState, useCallback } from 'react';
import { DailySettlement } from '@/types';
import { settlementsService } from '@/services/settlements.service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, DollarSign, TrendingUp, TrendingDown, CheckCircle2, AlertCircle, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function Settlements() {
  const [settlements, setSettlements] = useState<DailySettlement[]>([]);
  const [todaySettlement, setTodaySettlement] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [selectedSettlement, setSelectedSettlement] = useState<DailySettlement | null>(null);
  const [formData, setFormData] = useState({
    collected_cash: '',
    notes: '',
  });
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [settlementsResponse, todayResponse, statsResponse] = await Promise.all([
        settlementsService.getAll({ limit: 20 }),
        settlementsService.getToday(),
        settlementsService.getStats(),
      ]);

      setSettlements(settlementsResponse.data);
      setTodaySettlement(todayResponse);
      setStats(statsResponse);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar las conciliaciones',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCompleteSettlement = async () => {
    if (!selectedSettlement) return;

    try {
      await settlementsService.complete(selectedSettlement.id, {
        collected_cash: parseFloat(formData.collected_cash),
        notes: formData.notes || undefined,
      });

      toast({
        title: 'Conciliación cerrada',
        description: 'La caja del día ha sido cerrada exitosamente',
      });

      setShowCompleteDialog(false);
      setSelectedSettlement(null);
      setFormData({ collected_cash: '', notes: '' });
      fetchData();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo cerrar la conciliación',
      });
    }
  };

  const handleCreateTodaySettlement = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const orderIds = todaySettlement?.delivered_orders?.map((o: any) => o.id) || [];

      await settlementsService.create({
        settlement_date: today,
        order_ids: orderIds,
        notes: 'Conciliación automática del día',
      });

      toast({
        title: 'Conciliación creada',
        description: 'Se ha creado la conciliación para el día de hoy',
      });

      fetchData();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear la conciliación',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: 'Pendiente', variant: 'outline' },
      completed: { label: 'Completado', variant: 'default' },
      with_issues: { label: 'Con diferencias', variant: 'destructive' },
    };

    const config = statusConfig[status] || { label: status, variant: 'outline' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-PY', {
      style: 'currency',
      currency: 'PYG',
      minimumFractionDigits: 0,
    }).format(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Conciliaciones de Caja</h1>
          <p className="text-muted-foreground">Gestiona el cierre diario de efectivo</p>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Efectivo Esperado</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats ? formatCurrency(stats.total_expected) : '₲0'}
            </div>
            <p className="text-xs text-muted-foreground">Total en período</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Efectivo Cobrado</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stats ? formatCurrency(stats.total_collected) : '₲0'}
            </div>
            <p className="text-xs text-muted-foreground">Total recaudado</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Diferencia</CardTitle>
            {stats && stats.total_difference >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${stats && stats.total_difference >= 0 ? 'text-green-600' : 'text-red-600'
                }`}
            >
              {stats ? formatCurrency(stats.total_difference) : '₲0'}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.completed_count || 0} conciliaciones completadas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Today's Settlement */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Conciliación de Hoy</CardTitle>
              <CardDescription>
                {format(new Date(), "EEEE, dd 'de' MMMM yyyy", { locale: es })}
              </CardDescription>
            </div>
            {!todaySettlement?.settlement && (
              <Button onClick={handleCreateTodaySettlement}>
                Crear Conciliación
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {todaySettlement?.settlement ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estado</p>
                  <div className="mt-1">{getStatusBadge(todaySettlement.settlement.status)}</div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Efectivo esperado</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(todaySettlement.settlement.expected_cash)}
                  </p>
                </div>
              </div>

              {todaySettlement.settlement.status === 'pending' && (
                <Button
                  className="w-full"
                  onClick={() => {
                    setSelectedSettlement(todaySettlement.settlement);
                    setFormData({
                      collected_cash: todaySettlement.settlement.expected_cash.toString(),
                      notes: '',
                    });
                    setShowCompleteDialog(true);
                  }}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Cerrar Caja
                </Button>
              )}

              {todaySettlement.settlement.status !== 'pending' && (
                <div className="grid grid-cols-2 gap-4 pt-4 border-t dark:border-gray-800">
                  <div>
                    <p className="text-sm text-muted-foreground">Cobrado</p>
                    <p className="text-lg font-semibold text-green-600">
                      {formatCurrency(todaySettlement.settlement.collected_cash)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Diferencia</p>
                    <p
                      className={`text-lg font-semibold ${todaySettlement.settlement.difference >= 0
                        ? 'text-green-600'
                        : 'text-red-600'
                        }`}
                    >
                      {formatCurrency(todaySettlement.settlement.difference)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay conciliación creada para hoy</p>
              <p className="text-sm">
                Pedidos entregados hoy: {todaySettlement?.delivered_orders?.length || 0}
              </p>
              <p className="text-sm">
                Efectivo esperado: {formatCurrency(todaySettlement?.expected_cash || 0)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historical Settlements */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Conciliaciones</CardTitle>
          <CardDescription>Últimas 20 conciliaciones</CardDescription>
        </CardHeader>
        <CardContent>
          {settlements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay conciliaciones registradas</p>
            </div>
          ) : (
            <div className="space-y-4">
              {settlements.map((settlement) => (
                <div
                  key={settlement.id}
                  className="flex items-center justify-between p-4 border rounded-lg dark:border-gray-800 hover:bg-accent/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {format(new Date(settlement.settlement_date), 'dd MMM yyyy', { locale: es })}
                      </span>
                      {getStatusBadge(settlement.status)}
                    </div>
                    {settlement.notes && (
                      <p className="text-sm text-muted-foreground">{settlement.notes}</p>
                    )}
                  </div>
                  <div className="text-right space-y-1">
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Esperado</p>
                        <p className="font-semibold">{formatCurrency(settlement.expected_cash)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Cobrado</p>
                        <p className="font-semibold text-green-600">
                          {formatCurrency(settlement.collected_cash)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Diferencia</p>
                        <p
                          className={`font-semibold ${settlement.difference >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                        >
                          {formatCurrency(settlement.difference)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Complete Settlement Dialog */}
      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar Caja del Día</DialogTitle>
            <DialogDescription>
              Ingresa el efectivo cobrado y cierra la conciliación
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg dark:bg-gray-900">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">Efectivo esperado:</span>
                <span className="text-lg font-bold">
                  {selectedSettlement ? formatCurrency(selectedSettlement.expected_cash) : '₲0'}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="collected_cash">Efectivo cobrado *</Label>
              <Input
                id="collected_cash"
                type="number"
                value={formData.collected_cash}
                onChange={(e) => setFormData({ ...formData, collected_cash: e.target.value })}
                placeholder="0"
                required
              />
            </div>
            {formData.collected_cash && selectedSettlement && (
              <div className="p-4 bg-muted rounded-lg dark:bg-gray-900">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Diferencia:</span>
                  <span
                    className={`text-lg font-bold ${parseFloat(formData.collected_cash) - selectedSettlement.expected_cash >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                      }`}
                  >
                    {formatCurrency(
                      parseFloat(formData.collected_cash) - selectedSettlement.expected_cash
                    )}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Observaciones sobre la conciliación..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCompleteSettlement}
              disabled={!formData.collected_cash}
            >
              Cerrar Caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
