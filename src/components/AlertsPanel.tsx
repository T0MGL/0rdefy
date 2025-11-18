import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

interface AlertsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAlerts?: Alert[];
}

const severityConfig = {
  critical: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    badge: 'bg-red-500',
  },
  warning: {
    icon: AlertCircle,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    badge: 'bg-yellow-500',
  },
  info: {
    icon: Info,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    badge: 'bg-blue-500',
  },
};

export function AlertsPanel({ open, onOpenChange, initialAlerts = [] }: AlertsPanelProps) {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  
  const dismissAlert = (id: string) => {
    setAlerts(alerts.filter(a => a.id !== id));
  };
  
  const handleAction = (alert: Alert) => {
    if (alert.actionUrl) {
      navigate(alert.actionUrl);
      onOpenChange(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alertas del Sistema</DialogTitle>
        </DialogHeader>
        
        {alerts.length === 0 ? (
          <div className="text-center py-8">
            <Info className="mx-auto mb-4 text-muted-foreground" size={48} />
            <p className="text-muted-foreground">No hay alertas pendientes</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const config = severityConfig[alert.severity];
              const Icon = config.icon;
              
              return (
                <div
                  key={alert.id}
                  className={`p-4 rounded-lg border ${config.bgColor} relative`}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6"
                    onClick={() => dismissAlert(alert.id)}
                  >
                    <X size={14} />
                  </Button>
                  
                  <div className="flex gap-3">
                    <Icon className={config.color} size={20} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold">{alert.title}</h4>
                        <Badge className={`${config.badge} text-white text-xs`}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {alert.description}
                      </p>
                      {alert.actionLabel && (
                        <Button
                          size="sm"
                          onClick={() => handleAction(alert)}
                          className="gap-2"
                        >
                          {alert.actionLabel}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
