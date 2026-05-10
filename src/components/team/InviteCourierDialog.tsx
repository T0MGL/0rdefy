/**
 * InviteCourierDialog
 *
 * Cross-carrier invite flow used from Settings → Equipo. Lets the
 * admin pick the target carrier from the store's roster, then runs
 * the same invitation backend as CarrierOperatorsManager (Phase 2
 * endpoint POST /api/carriers/:carrierId/operators/invite).
 *
 * Design notes:
 *   - Mirrors the per-carrier dialog so the experience feels
 *     consistent regardless of where the admin starts.
 *   - When only one carrier exists, the select is disabled and
 *     pre-selected to keep the form one-step.
 *   - On email failure, the API returns a manual link. We surface
 *     it inline so the admin can copy and send it via WhatsApp.
 *   - Async hardening (MEMORY.md Mar 1): isMountedRef guards every
 *     setState after an await.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import {
  carrierOperatorsService,
  type CarrierOperatorInviteResult,
} from '@/services/carrier-operators.service';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  X,
} from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteCourierDialogCarrier {
  id: string;
  name: string;
  is_active: boolean;
}

interface InviteCourierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carriers: InviteCourierDialogCarrier[];
  /** Carrier id to pre-select. If omitted and a single carrier exists, it is auto-picked. */
  defaultCarrierId?: string;
  /** Fired after a successful invite (sent OR pending). The parent should refetch. */
  onInvited?: (result: CarrierOperatorInviteResult) => void;
}

export function InviteCourierDialog({
  open,
  onOpenChange,
  carriers,
  defaultCarrierId,
  onInvited,
}: InviteCourierDialogProps) {
  const { toast } = useToast();

  const activeCarriers = carriers.filter((c) => c.is_active);
  const onlyOneCarrier = activeCarriers.length === 1;

  const [carrierId, setCarrierId] = useState<string>('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset / preselect on open transitions.
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setName('');
    setPhone('');
    setFormError(null);
    setLinkToCopy(null);
    if (defaultCarrierId) {
      setCarrierId(defaultCarrierId);
    } else if (onlyOneCarrier) {
      setCarrierId(activeCarriers[0].id);
    } else {
      setCarrierId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultCarrierId, onlyOneCarrier]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setLinkToCopy(null);

    const emailNorm = email.trim().toLowerCase();
    const nameNorm = name.trim();
    const phoneNorm = phone.trim();

    if (!carrierId) {
      setFormError('Elegi una transportadora');
      return;
    }
    if (!EMAIL_REGEX.test(emailNorm)) {
      setFormError('Email invalido');
      return;
    }
    if (nameNorm.length < 2) {
      setFormError('El nombre debe tener al menos 2 caracteres');
      return;
    }

    setSubmitting(true);
    try {
      const result = await carrierOperatorsService.invite(carrierId, {
        email: emailNorm,
        name: nameNorm,
        phone: phoneNorm.length > 0 ? phoneNorm : undefined,
      });

      if (!isMountedRef.current) return;

      onInvited?.(result);

      if (result.already_pending) {
        toast({
          title: 'Ya hay una invitacion pendiente',
          description: `Existe una invitacion activa para ${result.invitation.email}.`,
        });
        onOpenChange(false);
      } else if (result.email_sent) {
        toast({
          title: 'Invitacion enviada',
          description: `Email enviado a ${result.invitation.email}.`,
        });
        onOpenChange(false);
      } else {
        // Email service down or disabled: keep dialog open and show link.
        setLinkToCopy(result.link || null);
        toast({
          title: 'Invitacion creada',
          description:
            'No se pudo enviar el email. Copia el link y compartelo manualmente.',
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      logger.error('Invite courier (cross-carrier) failed', err);
      if (!isMountedRef.current) return;

      const status = (err as { status?: number })?.status;
      let message =
        (err as { message?: string })?.message ||
        'No se pudo crear la invitacion';
      if (status === 409) {
        message = 'Ya existe una invitacion o un operador con ese email para esta transportadora.';
      } else if (status === 404) {
        message = 'La transportadora seleccionada ya no existe.';
      } else if (status && status >= 500) {
        message = 'Error del servidor. Intentalo de nuevo en unos segundos.';
      }
      setFormError(message);
    } finally {
      if (isMountedRef.current) setSubmitting(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar repartidor</DialogTitle>
          <DialogDescription>
            El repartidor recibe un email con un link para crear su cuenta y
            entrar al portal con sus credenciales.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-carrier">Transportadora</Label>
            <Select
              value={carrierId}
              onValueChange={setCarrierId}
              disabled={submitting || onlyOneCarrier || activeCarriers.length === 0}
            >
              <SelectTrigger id="invite-carrier">
                <SelectValue
                  placeholder={
                    activeCarriers.length === 0
                      ? 'No hay transportadoras activas'
                      : 'Elegi una transportadora'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {activeCarriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeCarriers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Crea una transportadora primero desde la pagina Repartidores.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-name">Nombre</Label>
            <Input
              id="invite-name"
              placeholder="Juan Operador"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="repartidor@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-phone">Teléfono (opcional)</Label>
            <Input
              id="invite-phone"
              type="tel"
              placeholder="0981 234 567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
              autoComplete="off"
            />
          </div>

          {formError && (
            <div className="text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {linkToCopy && (
            <div className="rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  El email no se envio. Copia este link y mandaselo por WhatsApp.
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-xs font-mono bg-background border rounded px-2 py-1 truncate">
                  {linkToCopy}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyLink(linkToCopy)}
                  className="gap-1"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setLinkToCopy(null)}
                  aria-label="Descartar link"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cerrar
            </Button>
            <Button
              type="submit"
              disabled={submitting || activeCarriers.length === 0}
              className="gap-2"
            >
              {submitting ? (
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
  );
}

export default InviteCourierDialog;
