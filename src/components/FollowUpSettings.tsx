import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/use-toast';
import { Clock, MessageCircle, Save, Zap } from 'lucide-react';

interface FollowUpConfig {
  enabled: boolean;
  followUpCount: number;
  hoursBetween: number;
  initialGreeting: string;
  agentName: string;
  salesAgentEnabled: boolean; // Disponible según plan
}

// Preset time options
const timePresets = [
  { label: '30 min', hours: 0.5 },
  { label: '2 horas', hours: 2 },
  { label: '6 horas', hours: 6 },
  { label: 'Personalizado', hours: null },
];

export function FollowUpSettings() {
  const { toast } = useToast();
  const [config, setConfig] = useLocalStorage<FollowUpConfig>('followup-config', {
    enabled: true,
    followUpCount: 3,
    hoursBetween: 24,
    initialGreeting: '',
    agentName: '',
    salesAgentEnabled: false, // Simulamos que está en un plan básico
  });

  const [isSaving, setIsSaving] = useState(false);
  
  // Track selected preset
  const [selectedPreset, setSelectedPreset] = useState<number | null>(() => {
    const preset = timePresets.find(p => p.hours === config.hoursBetween);
    return preset ? preset.hours : null;
  });

  const handlePresetChange = (hours: number | null) => {
    setSelectedPreset(hours);
    if (hours !== null) {
      setConfig({ ...config, hoursBetween: hours });
    }
  };

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setConfig(config);
      setIsSaving(false);
      toast({
        title: '✅ Configuración guardada',
        description: 'Los follow-ups se actualizarán en el próximo ciclo.',
      });
    }, 500);
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <MessageCircle className="text-primary" size={20} />
              Configuración de Follow-Ups
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Gestiona el seguimiento automático de pedidos vía WhatsApp (conectado a n8n)
            </p>
          </div>
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            <Zap size={12} className="mr-1" />
            Webhook Activo
          </Badge>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            {/* Enable/Disable */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <Label htmlFor="follow-enabled" className="font-medium">
                  Activar Follow-Ups
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Enviar mensajes automáticos de seguimiento
                </p>
              </div>
              <Switch
                id="follow-enabled"
                checked={config.enabled}
                onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
              />
            </div>

            {/* Follow-up Count */}
            <div className="space-y-3">
              <Label className="flex items-center justify-between">
                <span>Cantidad de Follow-Ups</span>
                <Badge variant="secondary">{config.followUpCount}</Badge>
              </Label>
              <Slider
                value={[config.followUpCount]}
                onValueChange={([value]) => setConfig({ ...config, followUpCount: value })}
                min={1}
                max={3}
                step={1}
                disabled={!config.enabled}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Máximo 3 intentos de contacto por pedido
              </p>
            </div>

            {/* Hours Between - Preset Options */}
            <div className="space-y-3">
              <Label className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Clock size={14} />
                  Tiempo entre mensajes
                </span>
                <Badge variant="secondary">{config.hoursBetween}h</Badge>
              </Label>
              
              {/* Preset Buttons */}
              <div className="grid grid-cols-2 gap-2">
                {timePresets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant={selectedPreset === preset.hours ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePresetChange(preset.hours)}
                    disabled={!config.enabled}
                    className="w-full text-xs"
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              
              {/* Custom Slider (shown when Personalizado is selected) */}
              {selectedPreset === null && (
                <div className="mt-3 space-y-2">
                  <Slider
                    value={[config.hoursBetween]}
                    onValueChange={([value]) => setConfig({ ...config, hoursBetween: value })}
                    min={0.5}
                    max={24}
                    step={0.5}
                    disabled={!config.enabled}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    {config.hoursBetween}h - Ajusta entre 0.5 y 24 horas
                  </p>
                </div>
              )}
              
              <p className="text-xs text-muted-foreground">
                Elige un preset rápido o configura un tiempo personalizado
              </p>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Agent Name */}
            <div className="space-y-2">
              <Label htmlFor="agent-name">Nombre del Agente</Label>
              <Input
                id="agent-name"
                placeholder="Ej: María García"
                value={config.agentName}
                onChange={(e) => setConfig({ ...config, agentName: e.target.value })}
                disabled={!config.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Nombre que aparecerá en los mensajes
              </p>
            </div>

            {/* Initial Greeting - Sales Agent Feature */}
            <div className="space-y-2">
              <Label htmlFor="greeting" className="flex items-center justify-between">
                <span>Saludo Inicial</span>
                {!config.salesAgentEnabled && (
                  <Badge variant="outline" className="text-xs">
                    Plan Growth+
                  </Badge>
                )}
              </Label>
              <Textarea
                id="greeting"
                placeholder="¡Hola! Soy {agente} de {tienda}..."
                value={config.initialGreeting}
                onChange={(e) => setConfig({ ...config, initialGreeting: e.target.value })}
                disabled={!config.enabled || !config.salesAgentEnabled}
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {config.salesAgentEnabled
                  ? 'Personaliza el mensaje inicial del agente de ventas'
                  : 'Disponible con el agente de ventas en planes Growth y Enterprise'}
              </p>
            </div>

            {/* Billing Integration */}
            <div className="p-4 border border-dashed rounded-lg bg-muted/30">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <Label className="font-medium">Facturación Marangatu</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Facturación electrónica directa desde el sistema
                  </p>
                </div>
                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                  Solo en Desarrollo
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Los cambios se aplicarán a los nuevos pedidos creados
          </p>
          <Button onClick={handleSave} disabled={isSaving || !config.enabled} className="gap-2">
            {isSaving ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save size={16} />
                Guardar Configuración
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
