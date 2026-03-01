import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { invoicingService, Invoice } from '@/services/invoicing.service';
import { Loader2, Download, RefreshCw, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/utils/currency';

const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pendiente', variant: 'secondary' },
  sent: { label: 'Enviado', variant: 'outline' },
  approved: { label: 'Aprobado', variant: 'default' },
  rejected: { label: 'Rechazado', variant: 'destructive' },
  cancelled: { label: 'Cancelado', variant: 'outline' },
  demo: { label: 'Demo', variant: 'secondary' },
};

interface Props {
  onViewInvoice?: (invoiceId: string) => void;
}

export function InvoiceHistoryTable({ onViewInvoice }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const limit = 20;
  const isMountedRef = useRef(true);
  const { toast } = useToast();

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoicingService.getInvoices({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit,
        offset: page * limit,
      });
      if (!isMountedRef.current) return;
      setInvoices(result.invoices);
      setTotal(result.total);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [statusFilter, page, toast]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const handleDownloadXML = async (invoiceId: string, cdc?: string) => {
    try {
      const blob = await invoicingService.downloadXML(invoiceId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DTE-${cdc || invoiceId}.xml`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleRetry = async (invoiceId: string) => {
    if (retryingId) return; // Prevent double-click
    setRetryingId(invoiceId);
    try {
      await invoicingService.retryInvoice(invoiceId);
      if (!isMountedRef.current) return;
      toast({ title: 'Reintento exitoso' });
      loadInvoices();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setRetryingId(null);
    }
  };

  const totalPages = Math.ceil(total / limit);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('es-PY', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch { return dateStr; }
  };

  const truncateCDC = (cdc?: string) => {
    if (!cdc) return '-';
    return `${cdc.slice(0, 8)}...${cdc.slice(-4)}`;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="approved">Aprobados</SelectItem>
            <SelectItem value="rejected">Rechazados</SelectItem>
            <SelectItem value="pending">Pendientes</SelectItem>
            <SelectItem value="demo">Demo</SelectItem>
            <SelectItem value="cancelled">Cancelados</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {total} factura{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Fecha</th>
              <th className="text-left px-4 py-3 font-medium">CDC</th>
              <th className="text-left px-4 py-3 font-medium">Cliente</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-center px-4 py-3 font-medium">Estado</th>
              <th className="text-center px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  <Loader2 className="animate-spin mx-auto" size={20} />
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground">
                  No hay facturas
                </td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const statusInfo = STATUS_BADGES[inv.sifen_status] || STATUS_BADGES.pending;
                return (
                  <tr key={inv.id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">{formatDate(inv.created_at)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{truncateCDC(inv.cdc)}</td>
                    <td className="px-4 py-3">
                      <div>{inv.customer_name || '-'}</div>
                      {inv.customer_ruc && (
                        <div className="text-xs text-muted-foreground">RUC: {inv.customer_ruc}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(inv.total, 'PYG')}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={statusInfo.variant}>
                        {statusInfo.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {onViewInvoice && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewInvoice(inv.id)} title="Ver detalle">
                            <Eye size={14} />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownloadXML(inv.id, inv.cdc)} title="Descargar XML">
                          <Download size={14} />
                        </Button>
                        {inv.sifen_status === 'rejected' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-600" onClick={() => handleRetry(inv.id)} disabled={retryingId === inv.id} title="Reintentar envío">
                            {retryingId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
