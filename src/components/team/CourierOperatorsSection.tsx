/**
 * CourierOperatorsSection
 *
 * Cross-carrier view of every courier operator in the store, surfaced
 * inside Settings → Equipo so admins can discover the flow without
 * having to click into a specific carrier.
 *
 * Data:
 *   - GET /api/couriers (carriersService.getAll) for the carrier roster.
 *   - For every carrier, GET /api/carriers/:id/operators in parallel
 *     via React Query useQueries. The Phase 2 endpoint already returns
 *     active + pending in one shot.
 *   - We bound the parallel fan-out at PARALLEL_LIMIT to avoid melting
 *     the API when a store has many carriers.
 *
 * Mutations live in two places:
 *   - Invite: handled by <InviteCourierDialog />.
 *   - Revoke / Resend / Cancel: inline mutations here, scoped per row.
 *
 * Visual bar: "PedidosYa / Rappi backoffice". Low chrome, clear
 * hierarchy, generous spacing, no cards fighting the parent layout.
 */

import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  useQuery,
  useQueries,
  useQueryClient,
  useMutation,
} from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { carriersService, type Carrier } from '@/services/carriers.service';
import {
  carrierOperatorsService,
  type CarrierOperatorActive,
  type CarrierOperatorPending,
  type CarrierOperatorsList,
} from '@/services/carrier-operators.service';
import { InviteCourierDialog } from './InviteCourierDialog';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Clock,
  Loader2,
  Mail,
  Phone,
  Send,
  Truck,
  UserPlus,
  Users,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

// --- Helpers ----------------------------------------------------------------

const PARALLEL_LIMIT = 50;

function safeRelative(iso: string | null | undefined): string {
  if (!iso) return 'sin actividad';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'sin actividad';
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
  } catch {
    return 'sin actividad';
  }
}

function activityTone(daysSinceActive: number | null) {
  if (daysSinceActive === null) {
    return {
      label: 'sin conexion',
      dotClass: 'bg-muted-foreground/40',
      textClass: 'text-muted-foreground',
    };
  }
  if (daysSinceActive <= 1) {
    return {
      label: 'activo',
      dotClass: 'bg-emerald-500',
      textClass: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  if (daysSinceActive <= 7) {
    return {
      label: 'reciente',
      dotClass: 'bg-amber-500',
      textClass: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    label: 'inactivo',
    dotClass: 'bg-muted-foreground/40',
    textClass: 'text-muted-foreground',
  };
}

// --- Main component ---------------------------------------------------------

export function CourierOperatorsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [defaultCarrierId, setDefaultCarrierId] = useState<string | undefined>(
    undefined,
  );

  // Confirmation targets for destructive ops, scoped to a carrier.
  const [revokeTarget, setRevokeTarget] = useState<{
    carrierId: string;
    carrierName: string;
    op: CarrierOperatorActive;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    carrierId: string;
    carrierName: string;
    inv: CarrierOperatorPending;
  } | null>(null);

  // 1) Carrier roster.
  const carriersQuery = useQuery<Carrier[]>({
    queryKey: ['carriers', 'all'],
    queryFn: () => carriersService.getAll(),
    staleTime: 30_000,
  });

  const carriers = carriersQuery.data ?? [];
  const carriersForFanOut = useMemo(
    () => carriers.slice(0, PARALLEL_LIMIT),
    [carriers],
  );

  // 2) Operators per carrier, in parallel.
  const operatorsQueries = useQueries({
    queries: carriersForFanOut.map((c) => ({
      queryKey: ['carrier-operators', c.id],
      queryFn: () => carrierOperatorsService.list(c.id),
      staleTime: 30_000,
      // Failures on a single carrier should not nuke the whole section.
      retry: 1,
    })),
  });

  // Aggregate counts and per-carrier rows.
  const aggregate = useMemo(() => {
    let totalActive = 0;
    let totalPending = 0;
    const byCarrier: Array<{
      carrier: Carrier;
      list?: CarrierOperatorsList;
      isLoading: boolean;
      error?: unknown;
    }> = [];

    carriersForFanOut.forEach((c, i) => {
      const q = operatorsQueries[i];
      const list = q?.data;
      if (list) {
        totalActive += list.active.length;
        totalPending += list.pending.length;
      }
      byCarrier.push({
        carrier: c,
        list,
        isLoading: q?.isLoading ?? false,
        error: q?.error,
      });
    });

    return {
      totalActive,
      totalPending,
      byCarrier,
      truncated: carriers.length > PARALLEL_LIMIT,
      truncatedCount: Math.max(0, carriers.length - PARALLEL_LIMIT),
    };
  }, [carriersForFanOut, operatorsQueries, carriers.length]);

  const carriersLoading = carriersQuery.isLoading;
  const anyCarrierError = carriersQuery.isError;
  const noCarriers = !carriersLoading && carriers.length === 0;
  const noOperators =
    !carriersLoading &&
    !anyCarrierError &&
    aggregate.totalActive === 0 &&
    aggregate.totalPending === 0 &&
    operatorsQueries.every((q) => !q.isLoading);

  // --- Mutations ------------------------------------------------------------

  const invalidateCarrier = (carrierId: string) => {
    queryClient.invalidateQueries({ queryKey: ['carrier-operators', carrierId] });
  };

  const revokeMutation = useMutation({
    mutationFn: ({ carrierId, userId }: { carrierId: string; userId: string }) =>
      carrierOperatorsService.revoke(carrierId, userId),
    onSuccess: (_data, vars) => {
      toast({
        title: 'Acceso revocado',
        description: 'El repartidor ya no puede operar para esta transportadora.',
      });
      invalidateCarrier(vars.carrierId);
    },
    onError: (err: unknown) => {
      logger.error('Revoke (cross-carrier) failed', err);
      toast({
        title: 'Error al revocar',
        description: (err as { message?: string })?.message || 'No se pudo revocar el acceso',
        variant: 'destructive',
      });
    },
    onSettled: () => setRevokeTarget(null),
  });

  const cancelMutation = useMutation({
    mutationFn: ({
      carrierId,
      invitationId,
    }: {
      carrierId: string;
      invitationId: string;
    }) => carrierOperatorsService.cancelInvitation(carrierId, invitationId),
    onSuccess: (_data, vars) => {
      toast({
        title: 'Invitacion cancelada',
        description: 'El link enviado deja de funcionar.',
      });
      invalidateCarrier(vars.carrierId);
    },
    onError: (err: unknown) => {
      logger.error('Cancel invitation (cross-carrier) failed', err);
      toast({
        title: 'Error al cancelar',
        description:
          (err as { message?: string })?.message || 'No se pudo cancelar la invitacion',
        variant: 'destructive',
      });
    },
    onSettled: () => setCancelTarget(null),
  });

  const resendMutation = useMutation({
    mutationFn: ({
      carrierId,
      invitationId,
    }: {
      carrierId: string;
      invitationId: string;
    }) => carrierOperatorsService.resendInvitation(carrierId, invitationId),
    onSuccess: (data, vars) => {
      if (data.email_sent) {
        toast({
          title: 'Email reenviado',
          description: 'La invitacion volvio a salir.',
        });
      } else {
        toast({
          title: 'No se pudo enviar el email',
          description:
            'Vas a tener que copiar el link manual desde la pagina del carrier.',
          variant: 'destructive',
        });
      }
      invalidateCarrier(vars.carrierId);
    },
    onError: (err: unknown) => {
      logger.error('Resend invitation (cross-carrier) failed', err);
      toast({
        title: 'Error al reenviar',
        description:
          (err as { message?: string })?.message || 'No se pudo reenviar la invitacion',
        variant: 'destructive',
      });
    },
  });

  // --- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-card-foreground flex items-center gap-2">
            <Truck className="h-5 w-5 text-muted-foreground" />
            Repartidores
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Operadores logisticos de tus transportadoras. Acceden a un portal
            propio, ven solo los pedidos asignados a su flota y los marcan
            como entregados, no entregados o devueltos. No cuentan contra el
            limite de usuarios de tu plan.
          </p>
          {!carriersLoading && (
            <p className="text-xs text-muted-foreground mt-2">
              {aggregate.totalActive}{' '}
              {aggregate.totalActive === 1 ? 'activo' : 'activos'}
              {' · '}
              {aggregate.totalPending}{' '}
              {aggregate.totalPending === 1
                ? 'invitacion pendiente'
                : 'invitaciones pendientes'}
              {aggregate.truncated && (
                <>
                  {' · '}mostrando {PARALLEL_LIMIT} de {carriers.length} transportadoras
                </>
              )}
            </p>
          )}
        </div>
        <Button
          onClick={() => {
            setDefaultCarrierId(undefined);
            setInviteOpen(true);
          }}
          disabled={carriers.filter((c) => c.is_active).length === 0}
          className="gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Invitar repartidor
        </Button>
      </div>

      {/* Loading state */}
      {carriersLoading && (
        <div className="space-y-3">
          <CarrierGroupSkeleton />
          <CarrierGroupSkeleton />
          <CarrierGroupSkeleton />
        </div>
      )}

      {/* Carriers fetch error */}
      {!carriersLoading && anyCarrierError && (
        <Card className="p-4 border-destructive/30 bg-destructive/5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">
                No se pudo cargar la lista de transportadoras.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => carriersQuery.refetch()}
            >
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      {/* No carriers at all */}
      {noCarriers && (
        <Card className="p-8 text-center bg-muted/20">
          <Truck className="h-8 w-8 mx-auto text-muted-foreground/60 mb-3" />
          <p className="text-sm text-muted-foreground">
            Todavia no tenes transportadoras registradas.
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1">
            Crea una desde la pagina <strong>Repartidores</strong> para poder
            invitar operadores.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4 gap-2">
            <RouterLink to="/carriers">
              Ir a Repartidores
              <ChevronRight className="h-3.5 w-3.5" />
            </RouterLink>
          </Button>
        </Card>
      )}

      {/* No operators across all carriers */}
      {noOperators && carriers.length > 0 && (
        <Card className="p-8 text-center bg-muted/20">
          <Users className="h-8 w-8 mx-auto text-muted-foreground/60 mb-3" />
          <p className="text-sm text-muted-foreground">
            Aun no invitaste a ningun repartidor.
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-md mx-auto">
            Cada repartidor entra al portal con su propia cuenta y ve solo los
            pedidos de su flota. Podes invitar a uno o varios por transportadora.
          </p>
          <Button
            onClick={() => {
              setDefaultCarrierId(undefined);
              setInviteOpen(true);
            }}
            size="sm"
            className="mt-4 gap-2"
          >
            <UserPlus className="h-4 w-4" />
            Invitar al primero
          </Button>
        </Card>
      )}

      {/* Carrier groups */}
      {!carriersLoading && !anyCarrierError && !noOperators && carriers.length > 0 && (
        <div className="space-y-3">
          {aggregate.byCarrier.map(({ carrier, list, isLoading, error }) => (
            <CarrierGroupRow
              key={carrier.id}
              carrier={carrier}
              list={list}
              isLoading={isLoading}
              error={error}
              onInvite={() => {
                setDefaultCarrierId(carrier.id);
                setInviteOpen(true);
              }}
              onRevoke={(op) =>
                setRevokeTarget({
                  carrierId: carrier.id,
                  carrierName: carrier.name || carrier.carrier_name || 'transportadora',
                  op,
                })
              }
              onCancelInvite={(inv) =>
                setCancelTarget({
                  carrierId: carrier.id,
                  carrierName: carrier.name || carrier.carrier_name || 'transportadora',
                  inv,
                })
              }
              onResend={(inv) =>
                resendMutation.mutate({
                  carrierId: carrier.id,
                  invitationId: inv.id,
                })
              }
              resending={
                resendMutation.isPending ? resendMutation.variables?.invitationId : undefined
              }
            />
          ))}
          {aggregate.truncated && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Hay {aggregate.truncatedCount} transportadora{aggregate.truncatedCount === 1 ? '' : 's'}{' '}
              mas que no se cargaron en esta vista. Abrilas desde{' '}
              <RouterLink to="/carriers" className="underline hover:text-foreground">
                Repartidores
              </RouterLink>{' '}
              para gestionar sus operadores.
            </p>
          )}
        </div>
      )}

      {/* Invite dialog */}
      <InviteCourierDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        carriers={carriers.map((c) => ({
          id: c.id,
          name: c.name || c.carrier_name || 'Sin nombre',
          is_active: c.is_active,
        }))}
        defaultCarrierId={defaultCarrierId}
        onInvited={(result) => {
          // Find which carrier was used by walking the queries; the dialog
          // does not surface the carrierId on the result, but the caller
          // selected one of ours, so we invalidate everything is cheap and
          // correct. The Phase 2 service mutation only touches a single
          // carrier list, so a targeted invalidate is fine.
          if (defaultCarrierId) {
            invalidateCarrier(defaultCarrierId);
          } else {
            // Cross-carrier: invalidate all so the new pending row shows up.
            queryClient.invalidateQueries({ queryKey: ['carrier-operators'] });
          }
          // Avoid noisy logs in production.
          void result;
        }}
      />

      {/* Revoke confirmation */}
      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revocar acceso al portal</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.op.name} ({revokeTarget?.op.email}) pierde acceso
              inmediato al portal de {revokeTarget?.carrierName}. La proxima
              vez que intente operar va a ser rechazado. El historial de
              pedidos que toco se mantiene intacto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (revokeTarget) {
                  revokeMutation.mutate({
                    carrierId: revokeTarget.carrierId,
                    userId: revokeTarget.op.user_id,
                  });
                }
              }}
              disabled={revokeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Revocar acceso'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel invitation confirmation */}
      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar invitacion</AlertDialogTitle>
            <AlertDialogDescription>
              La invitacion a {cancelTarget?.inv.email} para{' '}
              {cancelTarget?.carrierName} sera invalidada. El link que ya
              enviaste deja de funcionar. Si el repartidor necesita acceso
              despues, vas a tener que invitarlo de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              Volver
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (cancelTarget) {
                  cancelMutation.mutate({
                    carrierId: cancelTarget.carrierId,
                    invitationId: cancelTarget.inv.id,
                  });
                }
              }}
              disabled={cancelMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Cancelar invitacion'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

interface CarrierGroupRowProps {
  carrier: Carrier;
  list?: CarrierOperatorsList;
  isLoading: boolean;
  error?: unknown;
  onInvite: () => void;
  onRevoke: (op: CarrierOperatorActive) => void;
  onCancelInvite: (inv: CarrierOperatorPending) => void;
  onResend: (inv: CarrierOperatorPending) => void;
  resending?: string;
}

function CarrierGroupRow({
  carrier,
  list,
  isLoading,
  error,
  onInvite,
  onRevoke,
  onCancelInvite,
  onResend,
  resending,
}: CarrierGroupRowProps) {
  const carrierName = carrier.name || carrier.carrier_name || 'Sin nombre';
  const active = list?.active ?? [];
  const pending = list?.pending ?? [];
  const operatorsCount = active.length + pending.length;
  const isEmpty = !isLoading && !error && operatorsCount === 0;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Group header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <RouterLink
            to={`/carriers/${carrier.id}`}
            className="font-medium text-sm hover:text-primary transition-colors truncate"
            aria-label={`Abrir transportadora ${carrierName}`}
          >
            {carrierName}
          </RouterLink>
          {!carrier.is_active && (
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              Inactiva
            </Badge>
          )}
          {!isLoading && (
            <Badge variant="outline" className="font-mono text-xs flex-shrink-0">
              {active.length} activo{active.length === 1 ? '' : 's'}
              {pending.length > 0 && ` · ${pending.length} pendiente${pending.length === 1 ? '' : 's'}`}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onInvite}
          disabled={!carrier.is_active}
          className="gap-1 flex-shrink-0"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Invitar
        </Button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">Cargando operadores...</span>
          </div>
        )}

        {!isLoading && error && (
          <p className="text-xs text-destructive">
            Error cargando operadores de esta transportadora.
          </p>
        )}

        {isEmpty && (
          <div className="flex items-center justify-between gap-3 py-1">
            <p className="text-xs text-muted-foreground">
              Sin repartidores asignados.
            </p>
            {carrier.is_active && (
              <button
                type="button"
                onClick={onInvite}
                className="text-xs text-primary hover:underline"
              >
                Invitar al primero
              </button>
            )}
          </div>
        )}

        {!isLoading && !error && (active.length > 0 || pending.length > 0) && (
          <div className="space-y-2">
            {active.map((op) => (
              <ActiveOperatorRow
                key={op.user_id}
                op={op}
                onRevoke={() => onRevoke(op)}
              />
            ))}

            {active.length > 0 && pending.length > 0 && (
              <Separator className="my-2" />
            )}

            {pending.map((inv) => (
              <PendingInvitationRow
                key={inv.id}
                inv={inv}
                onResend={() => onResend(inv)}
                onCancel={() => onCancelInvite(inv)}
                isResending={resending === inv.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActiveOperatorRow({
  op,
  onRevoke,
}: {
  op: CarrierOperatorActive;
  onRevoke: () => void;
}) {
  const tone = activityTone(op.days_since_active);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span
          className={`h-2 w-2 rounded-full flex-shrink-0 ${tone.dotClass}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{op.name}</span>
            <span className={`text-xs ${tone.textClass}`}>
              {tone.label}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 truncate">
              <Mail className="h-3 w-3 flex-shrink-0" />
              {op.email}
            </span>
            {op.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {op.phone}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              {safeRelative(op.last_active_at)}
            </span>
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRevoke}
        className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
        aria-label={`Revocar acceso a ${op.name}`}
      >
        Revocar
      </Button>
    </div>
  );
}

function PendingInvitationRow({
  inv,
  onResend,
  onCancel,
  isResending,
}: {
  inv: CarrierOperatorPending;
  onResend: () => void;
  onCancel: () => void;
  isResending: boolean;
}) {
  const expirySoon = inv.days_until_expiry <= 1;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Clock
          className={`h-3.5 w-3.5 flex-shrink-0 ${
            expirySoon
              ? 'text-amber-500'
              : 'text-muted-foreground'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{inv.name}</span>
            <Badge
              variant="outline"
              className={
                expirySoon
                  ? 'text-amber-600 dark:text-amber-400 border-amber-500/40'
                  : ''
              }
            >
              Pendiente
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 truncate">
              <Mail className="h-3 w-3 flex-shrink-0" />
              {inv.email}
            </span>
            <span
              className={
                expirySoon
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : ''
              }
            >
              Expira{' '}
              {inv.days_until_expiry === 0
                ? 'hoy'
                : `en ${inv.days_until_expiry} ${
                    inv.days_until_expiry === 1 ? 'dia' : 'dias'
                  }`}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={onResend}
          disabled={isResending}
          className="gap-1"
        >
          {isResending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Send className="h-3.5 w-3.5" />
              Reenviar
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function CarrierGroupSkeleton() {
  return (
    <div className="rounded-lg border bg-card overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b bg-muted/30">
        <div className="h-4 w-40 bg-muted rounded" />
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="h-3 w-full bg-muted/60 rounded" />
        <div className="h-3 w-3/4 bg-muted/60 rounded" />
      </div>
    </div>
  );
}

export default CourierOperatorsSection;
