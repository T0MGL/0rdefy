/**
 * ActiveSessions Component
 * Shows list of active picking/packing sessions that can be resumed
 */

import { Layers, Clock, Package, PackageCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PickingSession } from '@/services/warehouse.service';

interface ActiveSessionsProps {
  sessions: PickingSession[];
  onResumeSession: (session: PickingSession) => void;
}

export function ActiveSessions({ sessions, onResumeSession }: ActiveSessionsProps) {
  if (sessions.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Sesiones Activas</h2>
        </div>

        <div className="text-center py-8">
          <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">
            No hay sesiones activas
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Selecciona pedidos para crear una nueva sesión
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Sesiones Activas</h2>
        <Badge variant="secondary" className="ml-auto">
          {sessions.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {sessions.map(session => (
          <Card
            key={session.id}
            className={cn(
              'p-4 cursor-pointer transition-all',
              'hover:shadow-md hover:border-primary',
              'bg-card'
            )}
            onClick={() => onResumeSession(session)}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono font-bold text-primary">
                {session.code}
              </span>
              <Badge
                variant={session.status === 'picking' ? 'default' : 'secondary'}
                className="gap-1"
              >
                {session.status === 'picking' ? (
                  <>
                    <Package className="h-3 w-3" />
                    Recolectando
                  </>
                ) : (
                  <>
                    <PackageCheck className="h-3 w-3" />
                    Empacando
                  </>
                )}
              </Badge>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {new Date(session.created_at).toLocaleString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              {session.order_count !== undefined && (
                <div className="flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" />
                  <span>{session.order_count} pedido{session.order_count !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-primary mt-2 font-medium">
              Clic para continuar →
            </p>
          </Card>
        ))}
      </div>
    </Card>
  );
}
