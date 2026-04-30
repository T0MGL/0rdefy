import { useState, useCallback, useMemo } from 'react';
import {
  Package,
  Check,
  Printer,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import type {
  OrderForPacking,
  PackingListResponse,
} from '@/services/warehouse.service';
import { getProductVariantKey } from '@/services/warehouse.service';

// ============================================================================
// TYPES
// ============================================================================

interface OrderInGroup {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  quantityNeeded: number;
  quantityPacked: number;
  orderIsComplete: boolean;
  isPrinted: boolean;
  hasToken: boolean;
  order: OrderForPacking;
}

interface ProductGroup {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  productImage: string;
  totalNeeded: number;
  totalPacked: number;
  orders: OrderInGroup[];
}

export interface PackingByProductProps {
  packingData: PackingListResponse;
  currentOrderIndex: number;
  onPackItem: (orderId: string, productId: string, variantId?: string | null) => Promise<void>;
  onPackAllItems: (orderId: string) => Promise<void>;
  onAutoPackSession?: () => Promise<void>;
  onPrintLabel: (order: OrderForPacking) => Promise<void>;
  onNextOrder: () => void;
  onPreviousOrder: () => void;
  onGoToOrder: (index: number) => void;
  onCompleteSession: () => Promise<void>;
  onCancelSession?: () => Promise<void>;
  onReportProblem?: (orderId: string, reason: string) => Promise<void>;
  loading?: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

function buildProductGroups(orders: OrderForPacking[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();

  for (const order of orders) {
    for (const item of order.items) {
      const key = getProductVariantKey(item.product_id, item.variant_id);

      if (!map.has(key)) {
        map.set(key, {
          key,
          productId: item.product_id,
          variantId: item.variant_id ?? null,
          productName: item.product_name,
          productImage: item.product_image,
          totalNeeded: 0,
          totalPacked: 0,
          orders: [],
        });
      }

      const group = map.get(key)!;
      group.totalNeeded += item.quantity_needed;
      group.totalPacked += item.quantity_packed;
      group.orders.push({
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        quantityNeeded: item.quantity_needed,
        quantityPacked: item.quantity_packed,
        orderIsComplete: order.is_complete,
        isPrinted: order.printed ?? false,
        hasToken: !!order.delivery_link_token,
        order,
      });
    }
  }

  // Sort: incomplete groups first, then by name
  return [...map.values()].sort((a, b) => {
    const aComplete = a.totalPacked >= a.totalNeeded;
    const bComplete = b.totalPacked >= b.totalNeeded;
    if (aComplete !== bComplete) return aComplete ? 1 : -1;
    return a.productName.localeCompare(b.productName);
  });
}

// ============================================================================
// PRODUCT IMAGE
// ============================================================================

function ProductImage({ src, name, size = 'md' }: { src: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const sizeClass = size === 'lg' ? 'w-16 h-16' : size === 'sm' ? 'w-10 h-10' : 'w-14 h-14';
  const iconSize = size === 'lg' ? 'h-8 w-8' : size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';

  if (broken || !src) {
    return (
      <div className={`${sizeClass} bg-muted rounded-lg flex items-center justify-center shrink-0`}>
        <Package className={`${iconSize} text-muted-foreground`} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className={`${sizeClass} object-cover rounded-lg shrink-0`}
      onError={() => setBroken(true)}
    />
  );
}

// ============================================================================
// ORDER ROW WITHIN PRODUCT GROUP
// ============================================================================

interface OrderRowProps {
  entry: OrderInGroup;
  productId: string;
  variantId: string | null;
  packingKey: string | null;
  onPack: (orderId: string, productId: string, variantId: string | null) => Promise<void>;
  onPrint: (order: OrderForPacking) => Promise<void>;
  printingId: string | null;
}

function OrderRow({ entry, productId, variantId, packingKey, onPack, onPrint, printingId }: OrderRowProps) {
  const itemKey = `${entry.orderId}:${productId}:${variantId ?? ''}`;
  const isPacking = packingKey === itemKey;
  const remaining = entry.quantityNeeded - entry.quantityPacked;
  const itemDone = remaining <= 0;
  const isPrinting = printingId === entry.orderId;

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors',
      itemDone ? 'bg-primary/5' : 'bg-muted/30 hover:bg-muted/50',
    )}>
      {/* Status dot */}
      <div className={cn(
        'w-2 h-2 rounded-full shrink-0',
        itemDone ? 'bg-primary' : 'bg-muted-foreground/40',
      )} />

      {/* Order info */}
      <div className="flex-1 min-w-0">
        <span className={cn('font-semibold text-sm', itemDone && 'text-muted-foreground')}>
          #{entry.orderNumber}
        </span>
        <span className="text-muted-foreground text-sm ml-2 truncate">
          {entry.customerName}
        </span>
      </div>

      {/* Qty badge */}
      <Badge variant="outline" className={cn(
        'shrink-0 font-mono text-xs',
        itemDone ? 'border-primary/30 text-primary' : 'text-muted-foreground',
      )}>
        {entry.quantityPacked}/{entry.quantityNeeded}u
      </Badge>

      {/* Action */}
      {itemDone ? (
        entry.orderIsComplete ? (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0 h-7 px-2"
            disabled={isPrinting || !entry.hasToken}
            onClick={() => onPrint(entry.order)}
          >
            {isPrinting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Printer className="h-3.5 w-3.5" />
            )}
            {entry.isPrinted ? 'Reimpr.' : 'Imprimir'}
          </Button>
        ) : (
          <Badge className="bg-primary/10 text-primary border-primary/30 shrink-0 h-7">
            <Check className="h-3 w-3 mr-1" />
            Listo
          </Badge>
        )
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10 shrink-0 h-7 px-2"
          disabled={isPacking !== false && packingKey !== null}
          onClick={() => onPack(entry.orderId, productId, variantId)}
        >
          {isPacking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          +1
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// PRODUCT GROUP CARD
// ============================================================================

interface ProductGroupCardProps {
  group: ProductGroup;
  packingKey: string | null;
  printingId: string | null;
  groupPackingKey: string | null;
  onPackOne: (orderId: string, productId: string, variantId: string | null) => Promise<void>;
  onPackAllInGroup: (group: ProductGroup) => Promise<void>;
  onPrintGroupLabels: (group: ProductGroup) => Promise<void>;
  onPrintOne: (order: OrderForPacking) => Promise<void>;
}

function ProductGroupCard({
  group,
  packingKey,
  printingId,
  groupPackingKey,
  onPackOne,
  onPackAllInGroup,
  onPrintGroupLabels,
  onPrintOne,
}: ProductGroupCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  const groupDone = group.totalPacked >= group.totalNeeded;
  const isPackingGroup = groupPackingKey === group.key;
  const pendingOrders = group.orders.filter(o => o.quantityPacked < o.quantityNeeded);
  const printableOrders = group.orders.filter(o => o.orderIsComplete && o.hasToken && !o.isPrinted);
  const progressPct = group.totalNeeded > 0 ? (group.totalPacked / group.totalNeeded) * 100 : 0;

  return (
    <Card className={cn(
      'overflow-hidden transition-all',
      groupDone ? 'border-primary/40' : 'border-border',
    )}>
      {/* Product header */}
      <div
        className={cn(
          'p-4 flex items-center gap-4 cursor-pointer select-none',
          groupDone ? 'bg-primary/5' : 'bg-muted/20',
        )}
        onClick={() => setCollapsed(c => !c)}
      >
        <ProductImage src={group.productImage} name={group.productName} size="lg" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-semibold text-base leading-tight truncate">{group.productName}</h3>
            {groupDone && (
              <Badge className="bg-primary/10 text-primary border-primary/30 shrink-0">
                <Check className="h-3 w-3 mr-1" />
                Listo
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            {group.totalPacked} / {group.totalNeeded} unidades &middot; {group.orders.length} pedidos
          </p>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        <div className="shrink-0 text-muted-foreground">
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </div>
      </div>

      {/* Orders list */}
      {!collapsed && (
        <>
          <div className="px-2 py-2 space-y-1">
            {group.orders.map(entry => (
              <OrderRow
                key={`${entry.orderId}:${group.key}`}
                entry={entry}
                productId={group.productId}
                variantId={group.variantId}
                packingKey={packingKey}
                onPack={onPackOne}
                onPrint={onPrintOne}
                printingId={printingId}
              />
            ))}
          </div>

          {/* Group actions */}
          {(pendingOrders.length > 0 || printableOrders.length > 0) && (
            <div className="px-4 py-3 border-t bg-muted/10 flex flex-wrap items-center gap-2">
              {printableOrders.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 h-8"
                  onClick={() => onPrintGroupLabels(group)}
                  disabled={isPackingGroup || packingKey !== null}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir etiquetas ({printableOrders.length})
                </Button>
              )}

              {pendingOrders.length > 0 && (
                <Button
                  size="sm"
                  className="gap-2 h-8 bg-primary hover:bg-primary/90"
                  onClick={() => onPackAllInGroup(group)}
                  disabled={isPackingGroup || packingKey !== null}
                >
                  {isPackingGroup ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Empacar todos ({pendingOrders.reduce((s, o) => s + (o.quantityNeeded - o.quantityPacked), 0)} u)
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PackingByProduct({
  packingData,
  onPackItem,
  onAutoPackSession,
  onPrintLabel,
  onCompleteSession,
  onCancelSession,
  loading,
}: PackingByProductProps) {
  const { toast } = useToast();
  const { orders } = packingData;

  // Per-item packing key: "orderId:productId:variantId"
  const [packingKey, setPackingKey] = useState<string | null>(null);
  // Per-group packing key: productGroup.key
  const [groupPackingKey, setGroupPackingKey] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [autoPackingSession, setAutoPackingSession] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const productGroups = useMemo(() => buildProductGroups(orders), [orders]);

  const progress = useMemo(() => {
    const completedOrders = orders.filter(o => o.is_complete).length;
    const totalItems = orders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity_needed, 0),
      0,
    );
    const packedItems = orders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity_packed, 0),
      0,
    );
    return {
      ordersComplete: completedOrders,
      ordersTotal: orders.length,
      itemsComplete: packedItems,
      itemsTotal: totalItems,
      percentage: totalItems > 0 ? (packedItems / totalItems) * 100 : 0,
    };
  }, [orders]);

  const allOrdersComplete = progress.ordersComplete === progress.ordersTotal && progress.ordersTotal > 0;

  const handlePackOne = useCallback(async (
    orderId: string,
    productId: string,
    variantId: string | null,
  ) => {
    const key = `${orderId}:${productId}:${variantId ?? ''}`;
    setPackingKey(key);
    try {
      await onPackItem(orderId, productId, variantId);
    } catch (error) {
      logger.error('Error packing item:', error);
      toast({ title: 'Error al empacar', variant: 'destructive' });
    } finally {
      setPackingKey(null);
    }
  }, [onPackItem, toast]);

  const handlePackAllInGroup = useCallback(async (group: ProductGroup) => {
    setGroupPackingKey(group.key);
    try {
      for (const entry of group.orders) {
        const remaining = entry.quantityNeeded - entry.quantityPacked;
        for (let i = 0; i < remaining; i++) {
          await onPackItem(entry.orderId, group.productId, group.variantId);
        }
      }
      toast({
        title: `${group.productName} empacado`,
        description: `Todas las unidades asignadas`,
        duration: 2000,
      });
    } catch (error) {
      logger.error('Error packing group:', error);
      toast({ title: 'Error al empacar grupo', variant: 'destructive' });
    } finally {
      setGroupPackingKey(null);
    }
  }, [onPackItem, toast]);

  const handlePrintGroupLabels = useCallback(async (group: ProductGroup) => {
    const printable = group.orders.filter(o => o.orderIsComplete && o.hasToken && !o.isPrinted);
    for (const entry of printable) {
      setPrintingId(entry.orderId);
      try {
        await onPrintLabel(entry.order);
      } catch (error) {
        logger.error('Error printing label:', error);
      }
    }
    setPrintingId(null);
  }, [onPrintLabel]);

  const handlePrintOne = useCallback(async (order: OrderForPacking) => {
    setPrintingId(order.id);
    try {
      await onPrintLabel(order);
    } catch (error) {
      logger.error('Error printing label:', error);
      toast({ title: 'Error de impresión', variant: 'destructive' });
    } finally {
      setPrintingId(null);
    }
  }, [onPrintLabel, toast]);

  const handleAutoPackSession = useCallback(async () => {
    if (!onAutoPackSession) return;
    setAutoPackingSession(true);
    try {
      await onAutoPackSession();
    } finally {
      setAutoPackingSession(false);
    }
  }, [onAutoPackSession]);

  return (
    <div className="h-full flex flex-col">
      {/* Progress Header */}
      <div className="bg-card border-b p-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Empaque por Producto</h2>
            <p className="text-sm text-muted-foreground">
              {progress.ordersComplete} de {progress.ordersTotal} pedidos completados
            </p>
          </div>

          <div className="flex items-center gap-3">
            {!allOrdersComplete && onAutoPackSession && (
              <Button
                onClick={handleAutoPackSession}
                disabled={autoPackingSession || loading}
                size="lg"
                className="gap-2 bg-primary hover:bg-primary/90"
              >
                {autoPackingSession ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Empacando...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Empacar Todos ({progress.ordersTotal - progress.ordersComplete})
                  </>
                )}
              </Button>
            )}

            {allOrdersComplete && (
              <Button
                onClick={onCompleteSession}
                disabled={loading}
                size="lg"
                className="gap-2 bg-primary"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Finalizar Sesión
              </Button>
            )}
          </div>
        </div>

        <Progress value={progress.percentage} className="h-2" />
      </div>

      {/* Product groups */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {productGroups.map(group => (
            <ProductGroupCard
              key={group.key}
              group={group}
              packingKey={packingKey}
              printingId={printingId}
              groupPackingKey={groupPackingKey}
              onPackOne={handlePackOne}
              onPackAllInGroup={handlePackAllInGroup}
              onPrintGroupLabels={handlePrintGroupLabels}
              onPrintOne={handlePrintOne}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      {onCancelSession && (
        <div className="bg-card border-t p-4 shrink-0 flex items-center justify-between">
          <Button
            onClick={() => setCancelDialog(true)}
            variant="ghost"
            className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <XCircle className="h-4 w-4" />
            Cancelar Sesión
          </Button>

          <p className="text-sm text-muted-foreground">
            {progress.itemsComplete} / {progress.itemsTotal} unidades empacadas
          </p>
        </div>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Cancelar Sesión de Empaque
            </DialogTitle>
            <DialogDescription>
              Esta acción cancelará la sesión actual y restaurará todos los pedidos al estado "Confirmado".
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              <strong>Pedidos afectados:</strong> {orders.length} pedidos serán restaurados
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(false)} disabled={cancelling}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={cancelling}
              onClick={async () => {
                if (!onCancelSession) return;
                setCancelling(true);
                try {
                  await onCancelSession();
                  setCancelDialog(false);
                } catch (error) {
                  logger.error('Error cancelling session:', error);
                } finally {
                  setCancelling(false);
                }
              }}
            >
              {cancelling ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Cancelando...</>
              ) : (
                'Sí, Cancelar Sesión'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
