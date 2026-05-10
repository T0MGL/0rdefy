import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MetricCard } from '@/components/MetricCard';
import { CarrierTable } from '@/components/carriers/CarrierTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ExportButton } from '@/components/ExportButton';
import { useToast } from '@/hooks/use-toast';
import { useHighlight } from '@/hooks/useHighlight';
import { usePhoneAutoPasteSimple } from '@/hooks/usePhoneAutoPaste';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { onboardingService } from '@/services/onboarding.service';
import {
  carriersService,
  Carrier,
  CarrierReplicationTarget,
  CarrierReplicationResult,
} from '@/services/carriers.service';
import { carrierOperatorsService } from '@/services/carrier-operators.service';
import { CarrierCoverageManager } from '@/components/CarrierCoverageManager';
import { Plus, Package, TrendingUp, Clock, Star, Search, Map as MapIcon, MapPin, ChevronRight, UserPlus } from 'lucide-react';
import { carriersExportColumns } from '@/utils/exportConfigs';
import { logger } from '@/utils/logger';
import apiClient from '@/services/api.client';

interface CourierPerformanceStat {
  courier_id: string;
  courier_name: string;
  total_deliveries: number;
  successful_deliveries: number;
  failed_deliveries: number;
  delivery_rate: number;
}

interface CarrierFormData {
  name: string;
  phone: string;
  email: string;
  notes: string;
  carrier_type: string;
  is_active: boolean;
  replicate_to_all_stores: boolean;
  // Optional inline courier invite (only used on create).
  invite_courier: boolean;
  courier_email: string;
  courier_name: string;
  courier_phone: string;
}

interface CarrierFormProps {
  carrier?: Carrier;
  onSubmit: (data: CarrierFormData) => void;
  onCancel: () => void;
  replicationTargets: CarrierReplicationTarget[];
}

const EMAIL_REGEX_FORM = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CarrierForm({ carrier, onSubmit, onCancel, replicationTargets }: CarrierFormProps) {
  const isEditing = Boolean(carrier);
  const canReplicate = !isEditing && replicationTargets.length > 0;
  const canInviteCourier = !isEditing;

  const [formData, setFormData] = useState<CarrierFormData>({
    name: carrier?.name || '',
    phone: carrier?.phone || '',
    email: carrier?.email || '',
    notes: carrier?.notes || '',
    carrier_type: carrier?.carrier_type || 'internal',
    is_active: carrier?.is_active ?? true,
    replicate_to_all_stores: false,
    invite_courier: false,
    courier_email: '',
    courier_name: '',
    courier_phone: '',
  });

  const [courierInviteError, setCourierInviteError] = useState<string | null>(null);
  // When true, the courier identity diverges from the carrier identity and the
  // explicit name/email/phone fields are shown. Default false: 90% of single-
  // operator carriers reuse the carrier's own contact info.
  const [courierIsOtherPerson, setCourierIsOtherPerson] = useState(false);

  // Auto-format phone on paste
  const handlePhonePaste = usePhoneAutoPasteSimple((fullPhone) => {
    setFormData({ ...formData, phone: fullPhone });
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCourierInviteError(null);

    // When the courier identity is collapsed (default), use the carrier's
    // own name/email/phone for the invite. When expanded ("Es otra persona"),
    // use the explicit courier fields. This keeps a single source of truth
    // regardless of whether the admin edited the carrier fields after enabling
    // the invite.
    const courierName = (courierIsOtherPerson ? formData.courier_name : formData.name).trim();
    const courierEmail = (courierIsOtherPerson ? formData.courier_email : formData.email).trim().toLowerCase();
    const courierPhone = (courierIsOtherPerson ? formData.courier_phone : formData.phone).trim();

    if (formData.invite_courier) {
      if (!EMAIL_REGEX_FORM.test(courierEmail)) {
        setCourierInviteError(
          courierIsOtherPerson
            ? 'El email del repartidor no es valido'
            : 'El email del carrier no es valido. Cargalo arriba o elegi "Es otra persona".'
        );
        return;
      }
      if (courierName.length < 2) {
        setCourierInviteError(
          courierIsOtherPerson
            ? 'El nombre del repartidor debe tener al menos 2 caracteres'
            : 'El nombre del carrier debe tener al menos 2 caracteres'
        );
        return;
      }
    }

    onSubmit({
      ...formData,
      courier_email: courierEmail,
      courier_name: courierName,
      courier_phone: courierPhone,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Nombre del Repartidor *</label>
        <Input
          placeholder="Ej: Juan Pérez"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="carrier_type">Tipo de Repartidor *</Label>
        <Select
          value={formData.carrier_type}
          onValueChange={(value) => setFormData({ ...formData, carrier_type: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="internal">Interno (Rendición Diaria)</SelectItem>
            <SelectItem value="external">Externo (Liquidación Semanal)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Interno: cobra efectivo y rinde diario. Externo: cobra y liquida semanalmente.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Teléfono *</label>
          <Input
            type="tel"
            placeholder="+595981234567"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            onPaste={handlePhonePaste}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <Input
            type="email"
            placeholder="repartidor@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Notas</label>
        <Input
          placeholder="Ej: Conoce bien la zona norte"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
          className="rounded border-gray-300"
        />
        <label htmlFor="is_active" className="text-sm font-medium">
          Repartidor activo
        </label>
      </div>

      {canReplicate && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="replicate_to_all_stores"
              checked={formData.replicate_to_all_stores}
              onChange={(e) =>
                setFormData({ ...formData, replicate_to_all_stores: e.target.checked })
              }
              className="mt-0.5 rounded border-gray-300"
            />
            <div className="space-y-1">
              <label htmlFor="replicate_to_all_stores" className="text-sm font-medium leading-tight">
                Usar esta transportadora en todas mis tiendas
              </label>
              <p className="text-xs text-muted-foreground leading-snug">
                Se creara una copia en {replicationTargets.length}{' '}
                {replicationTargets.length === 1 ? 'tienda adicional' : 'tiendas adicionales'} con
                sus mismas zonas y coberturas. Si ya existe una transportadora con este nombre en
                alguna tienda, se omite sin crear duplicados.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Optional courier invite. Visible only when creating a new carrier so
          the admin can onboard the first operator in the same step. The
          invite is fired AFTER the carrier is successfully created; if it
          fails, the carrier is kept and the user gets a non-blocking warning. */}
      {canInviteCourier && (
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="invite_courier"
              checked={formData.invite_courier}
              onChange={(e) => {
                const checked = e.target.checked;
                setCourierInviteError(null);
                // When enabling the invite, default the courier identity to the
                // carrier's own contact info. 90% of the time the carrier IS
                // the operator (one-person business). The admin can still
                // expand "Es otra persona" if the operator is someone else.
                setFormData((prev) => ({
                  ...prev,
                  invite_courier: checked,
                  courier_name: checked && !prev.courier_name ? prev.name : prev.courier_name,
                  courier_email: checked && !prev.courier_email ? prev.email : prev.courier_email,
                  courier_phone: checked && !prev.courier_phone ? prev.phone : prev.courier_phone,
                }));
                if (!checked) {
                  setCourierIsOtherPerson(false);
                }
              }}
              className="mt-0.5 rounded border-gray-300"
            />
            <div className="space-y-1">
              <label
                htmlFor="invite_courier"
                className="text-sm font-medium leading-tight flex items-center gap-1.5"
              >
                <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                Invitar primer repartidor
              </label>
              <p className="text-xs text-muted-foreground leading-snug">
                Le mandamos un email con el link para crear cuenta y entrar al portal.
              </p>
            </div>
          </div>

          {formData.invite_courier && (
            <div className="rounded-md border bg-muted/20 p-3 space-y-3">
              {!courierIsOtherPerson ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm leading-snug">
                    <p className="text-card-foreground">
                      Vamos a invitar a{' '}
                      <span className="font-medium">{formData.courier_name || formData.name || 'este repartidor'}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formData.courier_email || formData.email || 'sin email'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline shrink-0"
                    onClick={() => setCourierIsOtherPerson(true)}
                  >
                    Cambiar datos del dueno de la cuenta
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="courier_name">Nombre del repartidor *</Label>
                    <Input
                      id="courier_name"
                      placeholder="Ej: Juan Operador"
                      value={formData.courier_name}
                      onChange={(e) =>
                        setFormData({ ...formData, courier_name: e.target.value })
                      }
                      autoComplete="off"
                      required={formData.invite_courier}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="courier_email">Email del repartidor *</Label>
                    <Input
                      id="courier_email"
                      type="email"
                      placeholder="repartidor@ejemplo.com"
                      value={formData.courier_email}
                      onChange={(e) =>
                        setFormData({ ...formData, courier_email: e.target.value })
                      }
                      autoComplete="off"
                      required={formData.invite_courier}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="courier_phone">Teléfono (opcional)</Label>
                    <Input
                      id="courier_phone"
                      type="tel"
                      placeholder="0981 234 567"
                      value={formData.courier_phone}
                      onChange={(e) =>
                        setFormData({ ...formData, courier_phone: e.target.value })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-card-foreground"
                    onClick={() => {
                      setCourierIsOtherPerson(false);
                      // Snap back to carrier identity so the collapsed view is consistent.
                      setFormData((prev) => ({
                        ...prev,
                        courier_name: prev.name,
                        courier_email: prev.email,
                        courier_phone: prev.phone,
                      }));
                    }}
                  >
                    Volver a usar los datos del carrier
                  </button>
                </>
              )}

              {courierInviteError && (
                <p className="text-xs text-destructive">{courierInviteError}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90">
          {carrier ? 'Actualizar' : 'Crear'}
        </Button>
      </div>
    </form>
  );
}

export default function Carriers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { isHighlighted } = useHighlight();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [performanceFilter, setPerformanceFilter] = useState<'all' | 'poor-performance'>('all');
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [dbCarriers, setDbCarriers] = useState<Carrier[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState<Carrier | null>(null);
  const [performanceStats, setPerformanceStats] = useState<CourierPerformanceStat[] | null>(null);
  const [replicationTargets, setReplicationTargets] = useState<CarrierReplicationTarget[]>([]);
  const [coverageMapOpen, setCoverageMapOpen] = useState(false);
  const [coverageEditorCarrier, setCoverageEditorCarrier] = useState<Carrier | null>(null);
  const [coverageByCarrier, setCoverageByCarrier] = useState<Map<string, { name: string; cities: Array<{ id: string; city: string; rate: number }> }>>(new Map());
  const [coverageLoading, setCoverageLoading] = useState(false);

  // Refs for memory leak prevention
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const replicationTargetsAbortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      replicationTargetsAbortRef.current?.abort();
    };
  }, []);

  const loadReplicationTargets = useCallback(async () => {
    replicationTargetsAbortRef.current?.abort();
    const controller = new AbortController();
    replicationTargetsAbortRef.current = controller;

    try {
      const targets = await carriersService.getReplicationTargets(controller.signal);
      if (!isMountedRef.current || controller.signal.aborted) return;
      setReplicationTargets(targets);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // Non-fatal: the feature is hidden if we cannot enumerate targets.
      logger.error('Error loading replication targets:', error);
      if (isMountedRef.current) {
        setReplicationTargets([]);
      }
    }
  }, []);

  const loadCarriers = useCallback(async () => {
    const data = await carriersService.getAll();
    if (!isMountedRef.current) return;
    setDbCarriers(data);
    setCarriers(data);
  }, []);

  const loadPerformanceStats = useCallback(async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await apiClient.get('/couriers/performance/all', {
        signal: controller.signal,
      });
      if (!isMountedRef.current || controller.signal.aborted) return;
      setPerformanceStats(response.data.data || []);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const axiosErr = error as { code?: string };
      if (axiosErr.code === 'ERR_CANCELED') return;
      logger.error('Error loading performance stats:', error);
    }
  }, []);

  useEffect(() => {
    loadCarriers();
    loadPerformanceStats();
    loadReplicationTargets();
  }, [loadCarriers, loadPerformanceStats, loadReplicationTargets]);

  // Process URL query parameters for filtering and navigation from notifications
  useEffect(() => {
    const filter = searchParams.get('filter');
    const highlightId = searchParams.get('highlight');

    // Apply filter from URL
    if (filter) {
      switch (filter) {
        case 'poor-performance':
          setPerformanceFilter('poor-performance');
          break;
        default:
          setPerformanceFilter('all');
          break;
      }

      // Clean up URL after applying filter (keep highlight if present)
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('filter');
      if (newParams.toString() !== searchParams.toString()) {
        setSearchParams(newParams, { replace: true });
      }
    }

    // Validate highlighted carrier exists after data loads
    if (highlightId && dbCarriers.length > 0) {
      const carrierExists = dbCarriers.some(c => c.id === highlightId);
      if (!carrierExists) {
        // Carrier not found - show toast and clean URL
        toast({
          title: 'Transportadora no encontrada',
          description: 'La transportadora a la que intentas acceder ya no existe o fue eliminada.',
          variant: 'destructive',
        });
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('highlight');
        setSearchParams(newParams, { replace: true });
      }
    }

    // Open edit dialog when arriving from CarrierDetail with ?edit=<id>
    const editId = searchParams.get('edit');
    if (editId && dbCarriers.length > 0) {
      const carrierToEdit = dbCarriers.find(c => c.id === editId);
      if (carrierToEdit) {
        setSelectedCarrier(carrierToEdit);
        setDialogOpen(true);
      }
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('edit');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams, dbCarriers, toast]);

  const handleCreate = () => {
    setSelectedCarrier(null);
    setDialogOpen(true);
  };

  const handleEdit = (carrier: Carrier) => {
    setSelectedCarrier(carrier);
    setDialogOpen(true);
  };

  const handleManageZones = (carrier: Carrier) => {
    setCoverageEditorCarrier(carrier);
  };

  const handleCoverageSaved = useCallback(() => {
    // Invalidate cached coverage map so it reflects new rates if reopened.
    setCoverageByCarrier(new Map());
  }, []);

  const handleOpenCoverageMap = useCallback(async () => {
    setCoverageMapOpen(true);
    if (coverageByCarrier.size > 0) return;
    setCoverageLoading(true);
    try {
      const map = new Map<string, { name: string; cities: Array<{ id: string; city: string; rate: number }> }>();
      await Promise.all(
        carriers.map(async (carrier) => {
          const response = await apiClient.get(`/carriers/${carrier.id}/coverage`);
          const rows = (response.data?.data ?? response.data ?? []) as Array<{ id: string; city: string; rate: number }>;
          map.set(carrier.id, {
            name: carrier.name || carrier.carrier_name || carrier.id,
            cities: (rows || []).filter((r) => r.rate != null && Number(r.rate) > 0),
          });
        }),
      );
      setCoverageByCarrier(map);
    } catch (error) {
      logger.error('Error loading coverage map:', error);
    } finally {
      setCoverageLoading(false);
    }
  }, [carriers, coverageByCarrier]);

  const describeReplicationResult = useCallback(
    (result: CarrierReplicationResult): { title: string; description: string; variant?: 'destructive' } => {
      const replicated = result.replicated.length;
      const alreadyExists = result.skipped.filter((s) => s.reason === 'already_exists').length;
      const permissionDenied = result.skipped.filter(
        (s) => s.reason === 'permission_denied' || s.reason === 'not_a_member',
      ).length;
      const failed = result.failed.length;

      const parts: string[] = [];
      if (replicated > 0) {
        parts.push(`${replicated} ${replicated === 1 ? 'tienda adicional' : 'tiendas adicionales'}`);
      }
      if (alreadyExists > 0) {
        parts.push(`${alreadyExists} omitida${alreadyExists === 1 ? '' : 's'} (ya existia)`);
      }
      if (permissionDenied > 0) {
        parts.push(`${permissionDenied} sin permisos`);
      }
      if (failed > 0) {
        parts.push(`${failed} fallo${failed === 1 ? '' : 's'}`);
      }

      if (replicated === 0 && failed === 0 && alreadyExists === 0 && permissionDenied === 0) {
        return {
          title: 'Repartidor creado',
          description: 'No habia tiendas adicionales elegibles para replicar.',
        };
      }

      if (replicated === 0 && failed > 0) {
        return {
          title: 'Replicacion fallida',
          description: `No se pudo replicar el repartidor a otras tiendas. ${parts.join(', ')}.`,
          variant: 'destructive',
        };
      }

      return {
        title: 'Repartidor creado y replicado',
        description: `Creado en la tienda actual y replicado a ${parts.join(', ')}.`,
      };
    },
    [],
  );

  const handleSubmit = async (data: CarrierFormData) => {
    const {
      replicate_to_all_stores: replicateToAllStores,
      invite_courier: inviteCourier,
      courier_email: courierEmail,
      courier_name: courierName,
      courier_phone: courierPhone,
      ...payload
    } = data;

    try {
      if (selectedCarrier) {
        await carriersService.update(selectedCarrier.id, payload);
        toast({
          title: 'Repartidor actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        const createdCarrier = await carriersService.create(payload);

        // Mark first action completed (hides the onboarding tip)
        onboardingService.markFirstActionCompleted('carriers');

        // Replication runs first since it lives in the same conceptual flow.
        if (replicateToAllStores && replicationTargets.length > 0 && createdCarrier?.id) {
          try {
            const replicationResult = await carriersService.replicateToStores(createdCarrier.id);
            const summary = describeReplicationResult(replicationResult);
            toast({
              title: summary.title,
              description: summary.description,
              variant: summary.variant,
            });
          } catch (replicationError: unknown) {
            // Source carrier was created successfully; report the replication
            // problem separately so the user can retry from the list.
            logger.error('Carrier replication failed:', replicationError);
            toast({
              title: 'Repartidor creado, pero la replicacion fallo',
              description:
                replicationError instanceof Error
                  ? replicationError.message
                  : 'No se pudo replicar a las otras tiendas. El repartidor fue creado en esta tienda.',
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Repartidor creado',
            description: 'El repartidor ha sido registrado exitosamente.',
          });
        }

        // Inline courier invite. We do NOT roll back the carrier on failure
        // (no transactional cross-request boundary exists). Instead, we keep
        // the carrier and surface a non-blocking warning so the admin can
        // retry from Settings -> Equipo -> Repartidores or the carrier page.
        if (inviteCourier && createdCarrier?.id) {
          try {
            const inviteResult = await carrierOperatorsService.invite(
              createdCarrier.id,
              {
                email: courierEmail,
                name: courierName,
                phone: courierPhone.length > 0 ? courierPhone : undefined,
              },
            );

            if (inviteResult.already_pending) {
              toast({
                title: 'Ya existia una invitacion pendiente',
                description: `Mantuvimos la invitacion existente para ${inviteResult.invitation.email}.`,
              });
            } else if (inviteResult.email_sent) {
              toast({
                title: 'Invitacion enviada',
                description: `Email enviado a ${inviteResult.invitation.email}. El link expira en 7 dias.`,
              });
            } else {
              // Email service down: surface link so admin can copy it.
              toast({
                title: 'Carrier creado, pero el email no se envio',
                description: inviteResult.link
                  ? `Copia este link y mandaselo manualmente: ${inviteResult.link}`
                  : 'No se pudo enviar el email del repartidor. Reintenta desde la pagina del carrier.',
                variant: 'destructive',
              });
            }
          } catch (inviteError: unknown) {
            logger.error('Courier invite from carrier-create failed:', inviteError);
            const message =
              inviteError instanceof Error
                ? inviteError.message
                : 'No se pudo crear la invitacion';
            toast({
              title: 'Carrier creado, pero la invitacion fallo',
              description: `${message}. Podes invitar al repartidor despues desde Settings -> Equipo o desde la pagina del carrier.`,
              variant: 'destructive',
            });
          }
        }
      }

      await Promise.all([loadCarriers(), loadPerformanceStats()]);
      setDialogOpen(false);
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Ocurrio un error al guardar el repartidor.',
        variant: 'destructive',
      });
    }
  };

  // Merge carriers with their performance stats
  const carriersWithStats = useMemo(() => carriers.map(carrier => {
    const stats = performanceStats?.find((s) => s.courier_id === carrier.id);
    return {
      ...carrier,
      total_deliveries: stats?.total_deliveries || 0,
      successful_deliveries: stats?.successful_deliveries || 0,
      failed_deliveries: stats?.failed_deliveries || 0,
      delivery_rate: stats?.delivery_rate || 0,
    };
  }), [carriers, performanceStats]);

  const filteredCarriers = useMemo(() => carriersWithStats.filter((carrier) => {
    const matchesSearch = (carrier.name || carrier.carrier_name || '')
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && carrier.is_active) ||
      (statusFilter === 'inactive' && !carrier.is_active);
    // Apply performance filter from URL notifications
    const matchesPerformance =
      performanceFilter === 'all' ||
      (performanceFilter === 'poor-performance' && (carrier.delivery_rate || 0) < 80);
    return matchesSearch && matchesStatus && matchesPerformance;
  }), [carriersWithStats, searchTerm, statusFilter, performanceFilter]);

  // Calculate global metrics
  const { totalDeliveries, avgDeliveryRate, avgRating } = useMemo(() => {
    const total = carriersWithStats.reduce((sum, c) => sum + (c.total_deliveries || 0), 0);

    const withDeliveries = carriersWithStats.filter(c => (c.total_deliveries || 0) > 0);
    const avgRate = withDeliveries.length > 0
      ? withDeliveries.reduce((sum, c) => sum + (c.delivery_rate || 0), 0) / withDeliveries.length
      : 0;

    const withRatings = carriersWithStats.filter(c => c.average_rating > 0);
    const avgRat = withRatings.length > 0
      ? withRatings.reduce((sum, c) => sum + (c.average_rating || 0), 0) / withRatings.length
      : 0;

    return { totalDeliveries: total, avgDeliveryRate: avgRate, avgRating: avgRat };
  }, [carriersWithStats]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([loadCarriers(), loadPerformanceStats()]);
  }, [loadCarriers, loadPerformanceStats]);

  return (
    <div className="space-y-6">
      <FirstTimeWelcomeBanner
        moduleId="carriers"
        title="¡Bienvenido a Repartidores!"
        description="Gestiona tus couriers y motoristas. Asigna pedidos y analiza su rendimiento de entregas."
        tips={['Agrega repartidores', 'Asigna zonas de entrega', 'Ve métricas de rendimiento']}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">Repartidores</h2>
          <p className="text-muted-foreground text-sm">
            Gestiona tus repartidores y analiza su rendimiento en las entregas
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={carriersWithStats}
            filename="repartidores"
            columns={carriersExportColumns}
            title="Repartidores - Ordefy"
            variant="outline"
          />
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleOpenCoverageMap}
          >
            <MapIcon size={16} />
            Cobertura
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => navigate('/courier-performance')}
          >
            Ver Rendimiento
          </Button>
          <Button
            onClick={handleCreate}
            className="gap-2 cursor-pointer hover:scale-105 hover:bg-primary/90 active:scale-95 transition-all duration-200 z-50 relative"
          >
            <Plus size={18} />
            Agregar Repartidor
          </Button>
        </div>
      </div>

      {/* Global Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total de Envíos"
          value={totalDeliveries.toString()}
          icon={<Package className="text-primary" size={20} />}
        />
        <MetricCard
          title="Tasa de Entrega Promedio"
          value={`${avgDeliveryRate.toFixed(1)}%`}
          icon={<TrendingUp className="text-primary" size={20} />}
        />
        <MetricCard
          title="Repartidores Activos"
          value={carriersWithStats.filter(c => c.is_active).length.toString()}
          icon={<Clock className="text-blue-600" size={20} />}
        />
        <MetricCard
          title="Rating Promedio"
          value={avgRating > 0 ? `${avgRating.toFixed(1)} ⭐` : 'Sin ratings'}
          icon={<Star className="text-yellow-500 fill-yellow-500" size={20} />}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Buscar repartidor por nombre..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-card"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px] bg-card">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="inactive">Inactivo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Performance Filter Indicator */}
      {performanceFilter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtrando por:</span>
          <Badge
            variant="secondary"
            className="cursor-pointer hover:bg-destructive/20"
            onClick={() => setPerformanceFilter('all')}
          >
            Bajo rendimiento (&lt;80%)
            <span className="ml-1">×</span>
          </Badge>
          <span className="text-sm text-muted-foreground">
            ({filteredCarriers.length} de {carriersWithStats.length} transportadoras)
          </span>
        </div>
      )}

      {/* Carriers Table */}
      <CarrierTable
        carriers={filteredCarriers}
        onEdit={handleEdit}
        onManageZones={handleManageZones}
        onRefresh={handleRefresh}
        isHighlighted={isHighlighted}
      />

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedCarrier ? 'Editar Repartidor' : 'Nuevo Repartidor'}
            </DialogTitle>
          </DialogHeader>
          <CarrierForm
            carrier={selectedCarrier || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
            replicationTargets={replicationTargets}
          />
        </DialogContent>
      </Dialog>

      {/* Coverage Map Dialog */}
      <Dialog open={coverageMapOpen} onOpenChange={setCoverageMapOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapIcon size={18} />
              Mapa de cobertura
            </DialogTitle>
          </DialogHeader>

          {coverageLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Cargando zonas...
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {carriers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No hay repartidores registrados.
                </p>
              ) : (
                carriers.map((carrier) => {
                  const entry = coverageByCarrier.get(carrier.id);
                  const cities = entry?.cities ?? [];
                  const name = carrier.name || carrier.carrier_name || carrier.id;
                  return (
                    <div
                      key={carrier.id}
                      className="rounded-lg border bg-card p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{name}</span>
                          {!carrier.is_active && (
                            <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setCoverageMapOpen(false);
                            navigate(`/carriers/${carrier.id}`);
                          }}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Editar cobertura
                          <ChevronRight size={12} />
                        </button>
                      </div>

                      {cities.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Sin cobertura configurada</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {cities.slice(0, 24).map((row) => (
                            <Badge
                              key={row.id}
                              variant="outline"
                              className="text-xs font-normal gap-1"
                            >
                              <MapPin size={10} className="text-muted-foreground" />
                              {row.city}
                            </Badge>
                          ))}
                          {cities.length > 24 && (
                            <Badge variant="secondary" className="text-xs font-normal">
                              +{cities.length - 24} ciudades
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Per-carrier coverage editor: opens from the pin icon in the actions column. */}
      {coverageEditorCarrier && (
        <CarrierCoverageManager
          open={Boolean(coverageEditorCarrier)}
          onOpenChange={(open) => {
            if (!open) setCoverageEditorCarrier(null);
          }}
          carrierId={coverageEditorCarrier.id}
          carrierName={coverageEditorCarrier.name || 'Repartidor'}
          onSaved={handleCoverageSaved}
        />
      )}
    </div>
  );
}
