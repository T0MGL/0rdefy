/**
 * CarrierOperatorsManager
 *
 * Inline section for the "Operadores" tab on a carrier detail page.
 * Lists active courier operators bound to this carrier and pending
 * invitations, and exposes the admin actions: invite, resend, cancel,
 * revoke.
 *
 * Design notes:
 *   - The bar for visual quality is "PedidosYa / Rappi backoffice".
 *     Generous spacing, low chrome, clear typography hierarchy. No card
 *     borders fighting with the parent layout.
 *   - All async work follows the project hardening conventions
 *     (MEMORY.md Mar 1): isMountedRef + AbortController on the read
 *     path; mutations use guarded setState only after we re-check the
 *     mount ref.
 *   - Destructive actions (revoke, cancel invite) require a second
 *     confirmation via AlertDialog with explicit consequence copy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  carrierOperatorsService,
  type CarrierOperatorActive,
  type CarrierOperatorPending,
  type CarrierOperatorsList,
} from '@/services/carrier-operators.service';
import {
  Loader2,
  Mail,
  UserPlus,
  Send,
  X,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Truck,
  Phone,
  Activity,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

// --- Helpers ---------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function activityTone(daysSinceActive: number | null): {
  label: string;
  dotClass: string;
  textClass: string;
} {
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
      dotClass: 'bg-primary',
      textClass: 'text-primary dark:text-primary',
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

// --- Component -------------------------------------------------------------

interface CarrierOperatorsManagerProps {
  carrierId: string;
  carrierName: string;
}

export function CarrierOperatorsManager({
  carrierId,
  carrierName,
}: CarrierOperatorsManagerProps) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<CarrierOperatorActive[]>([]);
  const [pending, setPending] = useState<CarrierOperatorPending[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);

  // Post-invite link surface (when email failed or service is disabled).
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null);

  // Per-row pending-action flags.
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<
    string | null
  >(null);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(
    null,
  );

  // Confirmation dialog state for destructive actions.
  const [revokeTarget, setRevokeTarget] = useState<CarrierOperatorActive | null>(
    null,
  );
  const [cancelTarget, setCancelTarget] = useState<CarrierOperatorPending | null>(
    null,
  );

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (isMountedRef.current) {
      setLoading(true);
      setErrorMsg(null);
    }

    try {
      const data: CarrierOperatorsList = await carrierOperatorsService.list(
        carrierId,
        { signal: controller.signal },
      );
      if (!isMountedRef.current || controller.signal.aborted) return;
      setActive(data.active || []);
      setPending(data.pending || []);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      logger.error('Carrier operators load failed', err);
      if (!isMountedRef.current) return;
      setErrorMsg(err?.message || 'No se pudieron cargar los operadores');
    } finally {
      if (isMountedRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [carrierId]);

  useEffect(() => {
    isMountedRef.current = true;
    void load();
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, [load]);

  // --- Mutations -----------------------------------------------------------

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteFormError(null);
    setLinkToCopy(null);

    const emailNorm = inviteEmail.trim().toLowerCase();
    const nameNorm = inviteName.trim();
    const phoneNorm = invitePhone.trim();

    if (!EMAIL_REGEX.test(emailNorm)) {
      setInviteFormError('Email invalido');
      return;
    }
    if (nameNorm.length < 2) {
      setInviteFormError('Nombre demasiado corto');
      return;
    }

    setInviteSubmitting(true);
    try {
      const result = await carrierOperatorsService.invite(carrierId, {
        email: emailNorm,
        name: nameNorm,
        phone: phoneNorm.length > 0 ? phoneNorm : undefined,
      });
      if (!isMountedRef.current) return;

      if (result.already_pending) {
        toast({
          title: 'Ya hay una invitacion pendiente',
          description: `Existe una invitacion activa para ${result.invitation.email}.`,
        });
      } else if (result.email_sent) {
        toast({
          title: 'Invitacion enviada',
          description: `Email enviado a ${result.invitation.email}.`,
        });
      } else {
        // Email failed or service disabled; surface link for manual share.
        setLinkToCopy(result.link || null);
        toast({
          title: 'Invitacion creada',
          description:
            'No se pudo enviar el email. Copia el link y compartelo manualmente.',
          variant: 'destructive',
        });
      }

      // Reset form (except link, kept until explicitly closed).
      setInviteEmail('');
      setInviteName('');
      setInvitePhone('');
      if (result.email_sent || result.already_pending) {
        setInviteOpen(false);
      }
      await load();
    } catch (err: any) {
      logger.error('Invite courier operator failed', err);
      if (!isMountedRef.current) return;
      setInviteFormError(err?.message || 'No se pudo crear la invitacion');
    } finally {
      if (isMountedRef.current) setInviteSubmitting(false);
    }
  };

  const handleRevoke = async (target: CarrierOperatorActive) => {
    setRevokingUserId(target.user_id);
    try {
      await carrierOperatorsService.revoke(carrierId, target.user_id);
      if (!isMountedRef.current) return;
      toast({
        title: 'Acceso revocado',
        description: `${target.email} ya no puede operar para ${carrierName}.`,
      });
      await load();
    } catch (err: any) {
      logger.error('Revoke courier operator failed', err);
      if (!isMountedRef.current) return;
      toast({
        title: 'Error al revocar',
        description: err?.message || 'No se pudo revocar el acceso',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) {
        setRevokingUserId(null);
        setRevokeTarget(null);
      }
    }
  };

  const handleCancelInvitation = async (target: CarrierOperatorPending) => {
    setCancellingInvitationId(target.id);
    try {
      await carrierOperatorsService.cancelInvitation(carrierId, target.id);
      if (!isMountedRef.current) return;
      toast({
        title: 'Invitacion cancelada',
        description: `La invitacion para ${target.email} fue cancelada.`,
      });
      await load();
    } catch (err: any) {
      logger.error('Cancel courier invitation failed', err);
      if (!isMountedRef.current) return;
      toast({
        title: 'Error al cancelar',
        description: err?.message || 'No se pudo cancelar la invitacion',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) {
        setCancellingInvitationId(null);
        setCancelTarget(null);
      }
    }
  };

  const handleResend = async (target: CarrierOperatorPending) => {
    setResendingInvitationId(target.id);
    try {
      const result = await carrierOperatorsService.resendInvitation(
        carrierId,
        target.id,
      );
      if (!isMountedRef.current) return;
      if (result.email_sent) {
        toast({
          title: 'Email reenviado',
          description: `La invitacion volvio a ${target.email}.`,
        });
      } else {
        setLinkToCopy(result.link);
        toast({
          title: 'No se pudo enviar el email',
          description: 'Copia el link manual y compartelo via WhatsApp.',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      logger.error('Resend courier invitation failed', err);
      if (!isMountedRef.current) return;
      toast({
        title: 'Error al reenviar',
        description: err?.message || 'No se pudo reenviar la invitacion',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setResendingInvitationId(null);
    }
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: 'Link copiado al portapapeles' });
    } catch {
      toast({
        title: 'No se pudo copiar el link',
        description: 'Tu navegador bloqueo el clipboard. Copia manualmente.',
        variant: 'destructive',
      });
    }
  };

  // --- Render --------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header row: count + invite CTA */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-card-foreground">
            Operadores de {carrierName}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Couriers externos que acceden al portal de Ordefy con sus propias
            credenciales para gestionar las entregas asignadas a esta flota.
          </p>
        </div>
        <Button
          onClick={() => {
            setLinkToCopy(null);
            setInviteFormError(null);
            setInviteOpen(true);
          }}
          className="gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Invitar operador
        </Button>
      </div>

      {/* Manual link surface (when email failed) */}
      {linkToCopy && (
        <Card className="p-4 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                El email no se envio. Compartilo manualmente.
              </p>
              <div className="flex gap-2 mt-2 items-center">
                <code className="flex-1 text-xs font-mono bg-background border rounded px-2 py-1 truncate">
                  {linkToCopy}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyLink(linkToCopy)}
                  className="gap-1"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLinkToCopy(null)}
                  aria-label="Descartar link"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Error state */}
      {errorMsg && (
        <Card className="p-4 border-destructive/30 bg-destructive/5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">{errorMsg}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      {/* Loading skeleton */}
      {loading && !errorMsg && (
        <div className="flex items-center gap-3 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Cargando operadores...</span>
        </div>
      )}

      {/* Active operators */}
      {!loading && !errorMsg && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Activos
            </h3>
            <Badge variant="secondary" className="font-mono">
              {active.length}
            </Badge>
          </div>

          {active.length === 0 ? (
            <Card className="p-8 text-center">
              <Truck className="h-8 w-8 mx-auto text-muted-foreground/60 mb-3" />
              <p className="text-sm text-muted-foreground">
                Todavia no hay operadores activos en {carrierName}.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Invita al primero para que empiece a operar entregas desde el
                portal.
              </p>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Operador</th>
                    <th className="text-left font-medium px-4 py-3">Contacto</th>
                    <th className="text-left font-medium px-4 py-3">
                      Ultima actividad
                    </th>
                    <th className="text-right font-medium px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {active.map((op) => {
                    const tone = activityTone(op.days_since_active);
                    return (
                      <tr key={op.user_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-card-foreground">
                            {op.name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Invitado {safeRelative(op.invited_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="text-xs">{op.email}</span>
                          </div>
                          {op.phone && (
                            <div className="flex items-center gap-1.5 text-muted-foreground mt-1">
                              <Phone className="h-3.5 w-3.5" />
                              <span className="text-xs">{op.phone}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${tone.dotClass}`}
                              aria-hidden
                            />
                            <span className={`text-xs font-medium ${tone.textClass}`}>
                              {tone.label}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            {safeRelative(op.last_active_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRevokeTarget(op)}
                            disabled={revokingUserId === op.user_id}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {revokingUserId === op.user_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              'Revocar'
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Pending invitations */}
      {!loading && !errorMsg && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Invitaciones pendientes
            </h3>
            <Badge variant="secondary" className="font-mono">
              {pending.length}
            </Badge>
          </div>

          {pending.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Sin invitaciones pendientes.
              </p>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Email</th>
                    <th className="text-left font-medium px-4 py-3">Nombre</th>
                    <th className="text-left font-medium px-4 py-3">Expira</th>
                    <th className="text-right font-medium px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pending.map((inv) => {
                    const expirySoon = inv.days_until_expiry <= 1;
                    return (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{inv.email}</span>
                          </div>
                          {inv.invited_by && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Por {inv.invited_by}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{inv.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Clock
                              className={`h-3.5 w-3.5 ${
                                expirySoon ? 'text-amber-500' : 'text-muted-foreground'
                              }`}
                            />
                            <span
                              className={`text-xs ${
                                expirySoon
                                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {inv.days_until_expiry === 0
                                ? 'hoy'
                                : `${inv.days_until_expiry} ${
                                    inv.days_until_expiry === 1 ? 'dia' : 'dias'
                                  }`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right space-x-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleResend(inv)}
                            disabled={resendingInvitationId === inv.id}
                            className="gap-1"
                          >
                            {resendingInvitationId === inv.id ? (
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
                            onClick={() => setCancelTarget(inv)}
                            disabled={cancellingInvitationId === inv.id}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            Cancelar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitar operador a {carrierName}</DialogTitle>
            <DialogDescription>
              El operador recibira un email con un link para crear su cuenta y
              acceder al portal de couriers.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="op-name">Nombre</Label>
              <Input
                id="op-name"
                placeholder="Juan Operador"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                disabled={inviteSubmitting}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="op-email">Email</Label>
              <Input
                id="op-email"
                type="email"
                placeholder="operador@ejemplo.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviteSubmitting}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="op-phone">Teléfono (opcional)</Label>
              <Input
                id="op-phone"
                type="tel"
                placeholder="0981 234 567"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                disabled={inviteSubmitting}
                autoComplete="off"
              />
            </div>

            {inviteFormError && (
              <div className="text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {inviteFormError}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteOpen(false)}
                disabled={inviteSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={inviteSubmitting} className="gap-2">
                {inviteSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Enviar invitacion
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revocar acceso al portal</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.name} ({revokeTarget?.email}) perdera acceso al
              portal inmediatamente. La proxima vez que intente operar va a ser
              rechazado. El historial de pedidos que toco se mantiene intacto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!revokingUserId}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (revokeTarget) void handleRevoke(revokeTarget);
              }}
              disabled={!!revokingUserId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokingUserId ? (
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
              La invitacion a {cancelTarget?.email} sera invalidada. El link
              que ya enviaste deja de funcionar. Si el operador necesita acceso
              despues, vas a tener que invitarlo de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!cancellingInvitationId}>
              Volver
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (cancelTarget) void handleCancelInvitation(cancelTarget);
              }}
              disabled={!!cancellingInvitationId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancellingInvitationId ? (
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

export default CarrierOperatorsManager;
