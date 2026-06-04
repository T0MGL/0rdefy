import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { productsService } from '@/services/products.service';
import type { Product } from '@/types';
import {
  invoicingService,
  fiscalService,
  ManualInvoiceResult,
  FiscalActivity,
} from '@/services/invoicing.service';
import { Loader2, Plus, Trash2, CheckCircle2, ExternalLink, Copy, Search } from 'lucide-react';
import { formatCurrency } from '@/utils/currency';

/**
 * Catalog picker for an invoice line. Searches products server-side and, on
 * select, fills the line's description (fiscal_description || product name) and
 * unit price. Keeps the description editable for custom / non-catalog items.
 */
function ProductPicker({ onPick }: { onPick: (p: { descripcion: string; precio: number }) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await productsService.getAll({ search: query.trim() || undefined, limit: 8 });
        if (active) setResults(res.data || []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [query, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Buscar producto del catálogo"
          className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <Search size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto..."
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-56 overflow-auto">
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Buscando...</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
              onClick={() => {
                const desc = (p.fiscal_description && p.fiscal_description.trim()) || p.name;
                onPick({ descripcion: desc, precio: Number(p.price) || 0 });
                setOpen(false);
                setQuery('');
              }}
            >
              <div className="text-sm font-medium truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {p.sku ? `${p.sku} · ` : ''}{formatCurrency(Number(p.price) || 0, 'PYG')}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ================================================================
// Schema
// ================================================================

const itemSchema = z.object({
  descripcion: z.string().min(1, 'Descripción requerida'),
  cantidad: z.coerce.number().positive('Debe ser mayor a 0'),
  precioUnitario: z.coerce.number().min(0, 'Precio inválido'),
  ivaRate: z.union([z.literal(10), z.literal(5), z.literal(0)]),
});

const formSchema = z.object({
  tipoDocumento: z.union([z.literal(1), z.literal(5), z.literal(6)]),
  customerName: z.string().min(1, 'Nombre del comprador requerido'),
  customerRuc: z.string().regex(/^\d*$/, 'Solo números').optional().or(z.literal('')),
  customerRucDv: z.coerce.number().min(0).max(9).optional().or(z.literal('')),
  customerEmail: z.string().email('Email inválido').optional().or(z.literal('')),
  items: z.array(itemSchema).min(1, 'Se requiere al menos un ítem'),
});

type FormValues = z.infer<typeof formSchema>;

// ================================================================
// Helpers
// ================================================================

const TIPO_DOC_LABELS: Record<number, string> = {
  1: 'Factura Electrónica',
  5: 'Nota de Crédito',
  6: 'Nota de Débito',
};

const IVA_LABELS: Record<number, string> = {
  10: 'IVA 10%',
  5: 'IVA 5%',
  0: 'Exento',
};

function calcTotals(items: FormValues['items']) {
  let subtotal = 0;
  let iva10 = 0;
  let iva5 = 0;

  for (const item of items) {
    const line = (item.cantidad || 0) * (item.precioUnitario || 0);
    subtotal += line;
    if (item.ivaRate === 10) iva10 += Math.round(line / 11);
    else if (item.ivaRate === 5) iva5 += Math.round(line / 21);
  }

  return { subtotal, iva10, iva5, total: subtotal };
}

// ================================================================
// Success state
// ================================================================

interface SuccessViewProps {
  result: ManualInvoiceResult;
  tipoDocumento: number;
  onClose: () => void;
}

function SuccessView({ result, tipoDocumento, onClose }: SuccessViewProps) {
  const { toast } = useToast();
  const docLabel = TIPO_DOC_LABELS[tipoDocumento] || 'Documento';
  const isApproved = result.status === 'approved' || result.status === 'demo';

  const copyToClipboard = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() =>
      toast({ title: 'CDC copiado al portapapeles' })
    );
  }, [toast]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="space-y-6 py-2"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="p-3 rounded-full bg-primary/10 dark:bg-primary/30">
          <CheckCircle2 size={28} className="text-primary dark:text-primary" />
        </div>
        <div>
          <p className="font-semibold text-lg">{docLabel} emitida</p>
          <p className="text-sm text-muted-foreground">
            {result.status === 'demo' ? 'Modo demo: generada sin envío al SIFEN' : 'Aprobada por DNIT'}
          </p>
        </div>
        <Badge variant={isApproved ? 'default' : 'destructive'}>
          {result.status === 'demo' ? 'Demo' : result.status === 'approved' ? 'Aprobado' : 'Rechazado'}
        </Badge>
      </div>

      <div className="border rounded-lg divide-y">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Número</span>
          <span className="font-mono font-medium">
            {String(result.document_number).padStart(7, '0')}
          </span>
        </div>

        {result.cdc && (
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">CDC</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                onClick={() => copyToClipboard(result.cdc!)}
              >
                <Copy size={12} />
                Copiar
              </button>
            </div>
            <p className="font-mono text-xs break-all">{result.cdc}</p>
          </div>
        )}
      </div>

      {result.kude_url && (
        <a
          href={result.kude_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full border rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <ExternalLink size={14} />
          Ver KUDE en portal DNIT
        </a>
      )}

      <Button className="w-full" onClick={onClose}>
        Cerrar
      </Button>
    </motion.div>
  );
}

// ================================================================
// Main Modal
// ================================================================

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ManualInvoiceModal({ open, onOpenChange, onSuccess }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ data: ManualInvoiceResult; tipoDocumento: number } | null>(null);
  const [activities, setActivities] = useState<FiscalActivity[]>([]);
  const [selectedActivityCode, setSelectedActivityCode] = useState<string>('');
  const { toast } = useToast();

  // Load activities for the current store's fiscal identity. Only surfaces
  // the dropdown when there are 2+ activities; with a single (principal)
  // activity the backend picks it automatically.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fiscalService
      .getContext()
      .then((ctx) => {
        if (cancelled) return;
        const list = ctx?.activities ?? [];
        setActivities(list);
        const principal = list.find((a) => a.is_principal);
        setSelectedActivityCode(principal?.codigo ?? list[0]?.codigo ?? '');
      })
      .catch(() => {
        // Non-fatal: falls back to principal activity on the backend.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipoDocumento: 1,
      customerName: '',
      customerRuc: '',
      customerRucDv: '' as unknown as number,
      customerEmail: '',
      items: [{ descripcion: '', cantidad: 1, precioUnitario: 0, ivaRate: 10 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = form.watch('items');
  const totals = calcTotals(watchedItems);

  const handleClose = () => {
    if (submitting) return;
    onOpenChange(false);
    form.reset();
    setResult(null);
  };

  const handleSuccess = () => {
    handleClose();
    onSuccess();
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await invoicingService.generateManualInvoice({
        tipoDocumento: values.tipoDocumento,
        customerName: values.customerName,
        customerRuc: values.customerRuc || undefined,
        customerRucDv: values.customerRucDv !== '' && values.customerRucDv !== undefined
          ? Number(values.customerRucDv)
          : undefined,
        customerEmail: values.customerEmail || undefined,
        items: values.items.map((item) => ({
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          ivaRate: item.ivaRate,
        })),
        // Only send activity_code when the identity has multiple activities
        // and the operator made an explicit choice.
        ...(activities.length > 1 && selectedActivityCode
          ? { activityCode: selectedActivityCode }
          : {}),
      });
      setResult({ data: res.data, tipoDocumento: values.tipoDocumento });
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al emitir factura';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Factura</DialogTitle>
          <DialogDescription>
            Emiti una factura electronica manualmente, sin necesidad de un pedido asociado.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {result ? (
            <SuccessView
              key="success"
              result={result.data}
              tipoDocumento={result.tipoDocumento}
              onClose={handleSuccess}
            />
          ) : (
            <motion.form
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-6 pt-2"
            >
              {/* Document type */}
              <div>
                <Label>Tipo de documento</Label>
                <Controller
                  control={form.control}
                  name="tipoDocumento"
                  render={({ field }) => (
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v) as 1 | 5 | 6)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Factura Electrónica</SelectItem>
                        <SelectItem value="5">Nota de Crédito</SelectItem>
                        <SelectItem value="6">Nota de Débito</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {/* Activity picker (only when the identity has 2+ activities) */}
              {activities.length > 1 && (
                <div>
                  <Label>Actividad economica</Label>
                  <Select value={selectedActivityCode} onValueChange={setSelectedActivityCode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activities.map((a) => (
                        <SelectItem key={a.id} value={a.codigo}>
                          {a.codigo} - {a.descripcion}
                          {a.is_principal ? ' (principal)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Buyer data */}
              <div className="space-y-4">
                <p className="text-sm font-medium">Datos del comprador</p>

                <div>
                  <Label>Nombre / Razón social</Label>
                  <Input placeholder="Nombre del comprador" {...form.register('customerName')} />
                  {form.formState.errors.customerName && (
                    <p className="text-sm text-destructive mt-1">{form.formState.errors.customerName.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Label>
                      RUC <span className="text-muted-foreground font-normal text-xs">(opcional)</span>
                    </Label>
                    <Input placeholder="80012345" {...form.register('customerRuc')} />
                    {form.formState.errors.customerRuc && (
                      <p className="text-sm text-destructive mt-1">{form.formState.errors.customerRuc.message}</p>
                    )}
                  </div>
                  <div>
                    <Label>DV</Label>
                    <Input
                      placeholder="6"
                      type="number"
                      min={0}
                      max={9}
                      {...form.register('customerRucDv')}
                    />
                  </div>
                </div>

                <div>
                  <Label>
                    Email <span className="text-muted-foreground font-normal text-xs">(opcional)</span>
                  </Label>
                  <Input placeholder="comprador@email.com" type="email" {...form.register('customerEmail')} />
                  {form.formState.errors.customerEmail && (
                    <p className="text-sm text-destructive mt-1">{form.formState.errors.customerEmail.message}</p>
                  )}
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Items</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ descripcion: '', cantidad: 1, precioUnitario: 0, ivaRate: 10 })}
                  >
                    <Plus size={14} className="mr-1.5" />
                    Agregar
                  </Button>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Descripción</th>
                        <th className="text-center px-2 py-2 font-medium w-20">Cant.</th>
                        <th className="text-right px-2 py-2 font-medium w-28">Precio unit.</th>
                        <th className="text-center px-2 py-2 font-medium w-28">IVA</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, index) => (
                        <tr key={field.id} className="border-t">
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <ProductPicker
                                onPick={({ descripcion, precio }) => {
                                  form.setValue(`items.${index}.descripcion`, descripcion, { shouldValidate: true, shouldDirty: true });
                                  if (precio > 0) {
                                    form.setValue(`items.${index}.precioUnitario`, precio, { shouldDirty: true });
                                  }
                                }}
                              />
                              <Input
                                placeholder="Producto o servicio"
                                className="h-8 text-sm"
                                {...form.register(`items.${index}.descripcion`)}
                              />
                            </div>
                            {form.formState.errors.items?.[index]?.descripcion && (
                              <p className="text-xs text-destructive mt-0.5">
                                {form.formState.errors.items[index]?.descripcion?.message}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              className="h-8 text-sm text-center"
                              {...form.register(`items.${index}.cantidad`)}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              className="h-8 text-sm text-right"
                              {...form.register(`items.${index}.precioUnitario`)}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Controller
                              control={form.control}
                              name={`items.${index}.ivaRate`}
                              render={({ field: f }) => (
                                <Select
                                  value={String(f.value)}
                                  onValueChange={(v) => f.onChange(Number(v) as 10 | 5 | 0)}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="10">IVA 10%</SelectItem>
                                    <SelectItem value="5">IVA 5%</SelectItem>
                                    <SelectItem value="0">Exento</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            {fields.length > 1 && (
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                onClick={() => remove(index)}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {form.formState.errors.items?.root && (
                  <p className="text-sm text-destructive">{form.formState.errors.items.root.message}</p>
                )}
              </div>

              {/* Totals */}
              <div className="border rounded-lg px-4 py-3 space-y-1.5 bg-muted/30">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(totals.subtotal, 'PYG')}</span>
                </div>
                {totals.iva10 > 0 && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>IVA 10%</span>
                    <span>{formatCurrency(totals.iva10, 'PYG')}</span>
                  </div>
                )}
                {totals.iva5 > 0 && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>IVA 5%</span>
                    <span>{formatCurrency(totals.iva5, 'PYG')}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm font-semibold pt-1 border-t">
                  <span>Total</span>
                  <span>{formatCurrency(totals.total, 'PYG')}</span>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="mr-2 animate-spin" />
                      Emitiendo...
                    </>
                  ) : (
                    'Emitir Factura'
                  )}
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
