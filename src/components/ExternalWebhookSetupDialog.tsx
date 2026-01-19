import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Webhook, Copy, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { externalWebhookService } from '@/services/external-webhook.service';
import { logger } from '@/utils/logger';

interface ExternalWebhookSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ExternalWebhookSetupDialog({ open, onOpenChange, onSuccess }: ExternalWebhookSetupDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState('Webhook Externo');
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [result, setResult] = useState<{
    webhookUrl: string;
    apiKey: string;
  } | null>(null);
  const [copied, setCopied] = useState<'url' | 'key' | null>(null);

  const handleSetup = async () => {
    setIsLoading(true);

    try {
      const response = await externalWebhookService.setup({
        name: name || 'Webhook Externo',
        autoConfirm,
      });

      if (!response.success) {
        throw new Error((response as any).error || 'Error al configurar webhook');
      }

      const successResponse = response as any;
      setResult({
        webhookUrl: successResponse.webhook_url,
        apiKey: successResponse.api_key,
      });

      toast({
        title: 'Webhook configurado',
        description: 'Tu webhook externo ha sido configurado exitosamente. Copia la URL y el API Key.',
      });

    } catch (error: any) {
      logger.error('[ExternalWebhookSetup] Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo configurar el webhook',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'url' | 'key') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
      toast({
        title: 'Copiado',
        description: type === 'url' ? 'URL copiada al portapapeles' : 'API Key copiada al portapapeles',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'No se pudo copiar al portapapeles',
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    if (result) {
      onSuccess?.();
    }
    setResult(null);
    setName('Webhook Externo');
    setAutoConfirm(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Webhook className="h-6 w-6 text-primary" />
            </div>
            <div>
              <DialogTitle>Configurar Webhook Externo</DialogTitle>
              <DialogDescription>
                Recibe pedidos desde landing pages y sistemas externos
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!result ? (
          <div className="space-y-6 py-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Al configurar un webhook externo, obtendrás una URL y un API Key que podrás usar
                para enviar pedidos desde tu landing page o cualquier sistema externo.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre (opcional)</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Webhook Externo"
                />
                <p className="text-xs text-muted-foreground">
                  Un nombre para identificar este webhook en tu dashboard
                </p>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="autoConfirm">Auto-confirmar pedidos</Label>
                  <p className="text-xs text-muted-foreground">
                    Los pedidos llegarán como "Confirmados" en lugar de "Pendientes"
                  </p>
                </div>
                <Switch
                  id="autoConfirm"
                  checked={autoConfirm}
                  onCheckedChange={setAutoConfirm}
                />
              </div>
            </div>

            <Button
              onClick={handleSetup}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Configurando...
                </>
              ) : (
                <>
                  <Webhook className="mr-2 h-4 w-4" />
                  Generar Webhook
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                Tu webhook ha sido configurado exitosamente. Guarda estos datos de forma segura,
                el API Key solo se muestra una vez.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              {/* Webhook URL */}
              <div className="space-y-2">
                <Label>URL del Webhook</Label>
                <div className="flex gap-2">
                  <Input
                    value={result.webhookUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(result.webhookUrl, 'url')}
                  >
                    {copied === 'url' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Usa esta URL para enviar pedidos via POST
                </p>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    value={result.apiKey}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(result.apiKey, 'key')}
                  >
                    {copied === 'key' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Incluye esta clave en el header <code className="px-1 py-0.5 rounded bg-muted">X-API-Key</code>
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button onClick={handleClose} className="flex-1">
                Entendido
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ExternalWebhookSetupDialog;
