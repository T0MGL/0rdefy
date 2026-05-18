/**
 * SifenFlowAnimation
 *
 * Mini stepper que explica visualmente que pasa cuando se emite una
 * factura electronica en ORDEFY. Inspirado en los flows de Stripe
 * setup: linea horizontal con dots conectados, un highlight que recorre
 * los pasos en loop, tooltips con detalle al hover.
 *
 * Pensado para mostrar debajo del switch "Emitir factura al marcar
 * entrega" en Configuracion Fiscal, asi el owner entiende exactamente
 * que va a pasar cuando lo prenda.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PackageCheck,
  FileSignature,
  Send,
  CheckCircle2,
  Mail,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Step {
  id: string;
  icon: typeof PackageCheck;
  label: string;
  description: string;
}

const STEPS: Step[] = [
  {
    id: 'delivered',
    icon: PackageCheck,
    label: 'Pedido entregado',
    description:
      'Marcas el pedido como entregado desde el dashboard o el courier. Si el pedido tiene RUC del cliente y la emision automatica esta prendida, ORDEFY arranca el proceso.',
  },
  {
    id: 'signed',
    icon: FileSignature,
    label: 'Factura firmada',
    description:
      'ORDEFY genera el XML del DE (Documento Electronico) con los datos del pedido, lo firma con tu certificado digital, e inyecta el QR oficial de SIFEN.',
  },
  {
    id: 'sent',
    icon: Send,
    label: 'Enviada a SIFEN',
    description:
      'El XML firmado se envia al WS asincrono de la SET. SIFEN responde en segundos con un numero de protocolo y empieza a procesar el documento.',
  },
  {
    id: 'approved',
    icon: CheckCircle2,
    label: 'Aprobada',
    description:
      'ORDEFY consulta el resultado periodicamente. Cuando SIFEN aprueba el DE (usualmente 1 a 3 minutos), queda con valor legal y CDC oficial.',
  },
  {
    id: 'emailed',
    icon: Mail,
    label: 'Email al cliente',
    description:
      'Tu cliente recibe automaticamente la factura por email: KUDE PDF como adjunto + link al QR oficial en e-Kuatia para verificarla en cualquier momento.',
  },
];

const STEP_DURATION_MS = 1600;
const PAUSE_AFTER_LOOP_MS = 800;

export function SifenFlowAnimation() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(
      () => {
        setActiveIdx((prev) => {
          if (prev >= STEPS.length - 1) return 0;
          return prev + 1;
        });
      },
      activeIdx >= STEPS.length - 1 ? STEP_DURATION_MS + PAUSE_AFTER_LOOP_MS : STEP_DURATION_MS,
    );
    return () => clearTimeout(t);
  }, [activeIdx]);

  return (
    <div className="rounded-lg border border-border bg-gradient-to-br from-muted/20 via-background to-muted/10 px-5 py-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <p className="text-sm font-medium">Que pasa al marcar entregado</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Proceso automatico, normalmente termina en 1 a 3 minutos.
          </p>
        </div>
      </div>

      <TooltipProvider delayDuration={150}>
        <div className="relative pt-2 pb-1">
          {/* Connector line (background) */}
          <div
            className="absolute top-[26px] h-[2px] bg-border"
            style={{ left: '8%', right: '8%' }}
          />
          {/* Connector line (active progress) */}
          <motion.div
            className="absolute top-[26px] h-[2px] bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500/60"
            style={{ left: '8%' }}
            animate={{
              width: `${(activeIdx / (STEPS.length - 1)) * 84}%`,
            }}
            transition={{ duration: 0.7, ease: 'easeInOut' }}
          />

          <div className="relative grid grid-cols-5 gap-2">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = idx === activeIdx;
              const isPast = idx < activeIdx;
              const isHovered = hoveredIdx === idx;

              return (
                <Tooltip key={step.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      onFocus={() => setHoveredIdx(idx)}
                      onBlur={() => setHoveredIdx(null)}
                      className="flex flex-col items-center gap-2 group focus:outline-none"
                      aria-label={`${step.label}: ${step.description}`}
                    >
                      <div className="relative">
                        {/* Pulse halo for active step */}
                        <AnimatePresence>
                          {isActive && (
                            <motion.span
                              key="pulse"
                              initial={{ scale: 0.8, opacity: 0.5 }}
                              animate={{ scale: 1.6, opacity: 0 }}
                              exit={{ opacity: 0 }}
                              transition={{
                                duration: 1.2,
                                ease: 'easeOut',
                                repeat: Infinity,
                              }}
                              className="absolute inset-0 rounded-full bg-emerald-500/30"
                            />
                          )}
                        </AnimatePresence>
                        <motion.div
                          className={[
                            'relative flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 transition-colors',
                            isActive
                              ? 'border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                              : isPast
                                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600'
                                : 'border-border bg-card text-muted-foreground',
                            isHovered && !isActive ? 'border-foreground/40 text-foreground' : '',
                          ].join(' ')}
                          animate={{ scale: isActive ? 1.05 : 1 }}
                          transition={{ duration: 0.3 }}
                        >
                          <Icon className="h-5 w-5" strokeWidth={2.2} />
                        </motion.div>
                      </div>

                      <span
                        className={[
                          'text-[11px] leading-tight text-center transition-colors max-w-[80px]',
                          isActive
                            ? 'text-foreground font-medium'
                            : isPast
                              ? 'text-foreground/80'
                              : 'text-muted-foreground',
                        ].join(' ')}
                      >
                        {step.label}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-xs leading-relaxed">{step.description}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </TooltipProvider>

      <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Si SIFEN rechaza, queda visible en tu campana de alertas y podes reintentar.
        </span>
        <a
          href="https://ekuatia.set.gov.py"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors underline-offset-4 hover:underline"
        >
          e-Kuatia
        </a>
      </div>
    </div>
  );
}
