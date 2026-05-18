/**
 * SifenStatusCard
 *
 * Card que vive arriba de Configuracion Fiscal y muestra el estado
 * consolidado de la integracion SIFEN: que esta listo, que falta, que
 * esta proximo a vencer. Cada item es clickable y hace scroll a la
 * seccion del editor que lo gestiona.
 *
 * Inspirado en los "setup status" de Stripe / Vercel: dot de color +
 * label corto + meta opcional (vencimiento, ambiente, etc).
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  Circle,
  XCircle,
  ShieldCheck,
} from 'lucide-react';
import type { FiscalContext } from '@/services/invoicing.service';

type ItemState = 'ok' | 'warn' | 'missing' | 'optional';

interface StatusItem {
  id: string;
  label: string;
  state: ItemState;
  meta?: string;
  scrollTarget?: string;
}

interface Props {
  ctx: FiscalContext | null;
  loading?: boolean;
}

function pickIcon(state: ItemState) {
  switch (state) {
    case 'ok':
      return CheckCircle2;
    case 'warn':
      return AlertTriangle;
    case 'missing':
      return XCircle;
    case 'optional':
    default:
      return Circle;
  }
}

function stateClasses(state: ItemState) {
  switch (state) {
    case 'ok':
      return 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/30';
    case 'warn':
      return 'text-amber-500 bg-amber-500/10 ring-amber-500/30';
    case 'missing':
      return 'text-red-500 bg-red-500/10 ring-red-500/30';
    case 'optional':
    default:
      return 'text-muted-foreground bg-muted/40 ring-border';
  }
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

function scrollToSection(target: string | undefined): void {
  if (!target) return;
  const el = document.getElementById(target);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function SifenStatusCard({ ctx, loading }: Props) {
  const items = useMemo<StatusItem[]>(() => {
    if (!ctx) return [];

    const identity = ctx.identity;
    const link = ctx.link;
    const env = identity.sifen_environment;
    const isProd = env === 'prod';

    const fiscalDataOk = Boolean(
      identity.razon_social &&
        identity.ruc &&
        identity.representante_legal_nombre &&
        identity.representante_legal_documento_numero,
    );

    const domicilioOk = Boolean(
      identity.domicilio_fiscal_direccion &&
        identity.domicilio_fiscal_departamento &&
        identity.domicilio_fiscal_distrito &&
        identity.domicilio_fiscal_ciudad,
    );

    const timbradoEndDays = daysUntil(link.timbrado_fecha_fin);
    const timbradoState: ItemState =
      !link.timbrado
        ? 'missing'
        : timbradoEndDays !== null && timbradoEndDays < 0
          ? 'missing'
          : timbradoEndDays !== null && timbradoEndDays <= 30
            ? 'warn'
            : 'ok';

    const timbradoMeta =
      timbradoState === 'missing'
        ? !link.timbrado
          ? 'No cargado'
          : `Vencio hace ${Math.abs(timbradoEndDays ?? 0)} dias`
        : timbradoState === 'warn'
          ? `Vence en ${timbradoEndDays} dias`
          : link.timbrado_fecha_fin
            ? `Vigente hasta ${new Date(link.timbrado_fecha_fin).toLocaleDateString()}`
            : link.timbrado;

    const certState: ItemState = identity.has_certificate ? 'ok' : 'missing';
    const cscState: ItemState = identity.csc_id
      ? 'ok'
      : isProd
        ? 'missing'
        : 'optional';

    const asyncEnabled = identity.sifen_async_enabled === true;
    const autoEmitEnabled = link.auto_emit_invoice_on_delivery === true;

    return [
      {
        id: 'fiscal-data',
        label: 'Datos fiscales',
        state: fiscalDataOk ? 'ok' : 'missing',
        meta: fiscalDataOk
          ? `${identity.razon_social} | RUC ${identity.ruc}-${identity.ruc_dv}`
          : 'Completa razon social y representante legal',
        scrollTarget: 'fiscal-identity-section',
      },
      {
        id: 'domicilio',
        label: 'Domicilio fiscal',
        state: domicilioOk ? 'ok' : 'warn',
        meta: domicilioOk ? identity.domicilio_fiscal_direccion ?? '' : 'Carga la direccion y los codigos geograficos',
        scrollTarget: 'fiscal-identity-section',
      },
      {
        id: 'timbrado',
        label: 'Timbrado',
        state: timbradoState,
        meta: timbradoMeta,
        scrollTarget: 'fiscal-store-section',
      },
      {
        id: 'cert',
        label: 'Certificado digital',
        state: certState,
        meta: certState === 'ok' ? '.p12 cargado y activo' : 'Sube el .p12 para emitir',
        scrollTarget: 'fiscal-certificate-section',
      },
      {
        id: 'csc',
        label: 'CSC (Codigo de Seguridad)',
        state: cscState,
        meta:
          cscState === 'ok'
            ? `idCSC ${identity.csc_id}`
            : isProd
              ? 'DNIT lo emite en Marangatu. Requerido para prod.'
              : 'Opcional en demo/test',
        scrollTarget: 'fiscal-csc-section',
      },
      {
        id: 'async',
        label: 'Modo asincrono SIFEN',
        state: asyncEnabled ? 'ok' : 'optional',
        meta: asyncEnabled
          ? 'Lote async habilitado'
          : 'Se habilita automaticamente al emitir',
      },
      {
        id: 'auto-emit',
        label: 'Emision automatica al entregar',
        state: autoEmitEnabled ? 'ok' : 'optional',
        meta: autoEmitEnabled
          ? 'Marcar entregado emitira factura'
          : 'Apagado: emites manual cuando quieras',
        scrollTarget: 'fiscal-store-section',
      },
    ];
  }, [ctx]);

  if (loading || !ctx) {
    return (
      <div className="rounded-xl border border-border bg-card/50 px-5 py-4 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-3" />
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-8 bg-muted/60 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const env = ctx.identity.sifen_environment;
  const totalOk = items.filter((i) => i.state === 'ok').length;
  const totalRequired = items.filter((i) => i.state !== 'optional').length;
  const blockers = items.filter((i) => i.state === 'missing').length;
  const warnings = items.filter((i) => i.state === 'warn').length;

  let summary: { tone: 'good' | 'warn' | 'bad'; title: string; subtitle: string };
  if (blockers > 0) {
    summary = {
      tone: 'bad',
      title: 'Configuracion incompleta',
      subtitle: `Falta resolver ${blockers} item${blockers === 1 ? '' : 's'} para emitir facturas.`,
    };
  } else if (warnings > 0) {
    summary = {
      tone: 'warn',
      title: 'Configuracion activa con avisos',
      subtitle: `${warnings} item${warnings === 1 ? '' : 's'} requiere${warnings === 1 ? '' : 'n'} tu atencion.`,
    };
  } else {
    summary = {
      tone: 'good',
      title:
        env === 'prod'
          ? 'Listo para emitir facturas en produccion'
          : env === 'test'
            ? 'Listo para emitir en ambiente de pruebas'
            : 'Listo para emitir en modo demo',
      subtitle: `${totalOk} de ${totalRequired} items configurados.`,
    };
  }

  const summaryClasses =
    summary.tone === 'good'
      ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/8 to-transparent'
      : summary.tone === 'warn'
        ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/8 to-transparent'
        : 'border-red-500/40 bg-gradient-to-br from-red-500/8 to-transparent';

  const summaryIconClasses =
    summary.tone === 'good'
      ? 'text-emerald-500'
      : summary.tone === 'warn'
        ? 'text-amber-500'
        : 'text-red-500';

  const envBadgeClasses =
    env === 'prod'
      ? 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10'
      : env === 'test'
        ? 'border-amber-500/40 text-amber-600 bg-amber-500/10'
        : 'border-muted-foreground/30 text-muted-foreground bg-muted/30';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`rounded-xl border ${summaryClasses} px-5 py-4`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`mt-0.5 ${summaryIconClasses}`}>
            <ShieldCheck className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-tight">{summary.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{summary.subtitle}</p>
          </div>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${envBadgeClasses}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${env === 'prod' ? 'bg-emerald-500 animate-pulse' : env === 'test' ? 'bg-amber-500' : 'bg-muted-foreground/60'}`} />
          {env}
        </span>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {items.map((item) => {
          const Icon = pickIcon(item.state);
          const clickable = Boolean(item.scrollTarget);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => clickable && scrollToSection(item.scrollTarget)}
                disabled={!clickable}
                className={[
                  'w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                  clickable
                    ? 'hover:bg-muted/60 focus:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-border cursor-pointer'
                    : 'cursor-default',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-full ring-1 shrink-0',
                    stateClasses(item.state),
                  ].join(' ')}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium leading-tight">{item.label}</span>
                  {item.meta && (
                    <span className="block text-[11px] text-muted-foreground mt-0.5 truncate">
                      {item.meta}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}
