import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Copy, Download, ExternalLink, QrCode } from 'lucide-react';

interface QRCodeDisplayProps {
  qrCodeUrl?: string;
  deliveryLink?: string;
  orderNumber?: string;
}

export function QRCodeDisplay({ qrCodeUrl, deliveryLink, orderNumber }: QRCodeDisplayProps) {
  const { toast } = useToast();
  const [imageError, setImageError] = useState(false);

  const copyLink = () => {
    if (deliveryLink) {
      navigator.clipboard.writeText(deliveryLink);
      toast({
        title: 'Link copiado',
        description: 'El link de entrega ha sido copiado al portapapeles',
      });
    }
  };

  const downloadQR = () => {
    if (qrCodeUrl) {
      // Create a temporary link element
      const link = document.createElement('a');
      link.href = qrCodeUrl;
      link.download = `qr-pedido-${orderNumber || 'sin-numero'}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: 'QR descargado',
        description: 'El código QR ha sido descargado',
      });
    }
  };

  const openLink = () => {
    if (deliveryLink) {
      window.open(deliveryLink, '_blank');
    }
  };

  const printQR = () => {
    if (qrCodeUrl) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>QR Code - Pedido ${orderNumber || ''}</title>
              <style>
                body {
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  font-family: Arial, sans-serif;
                }
                .container {
                  text-align: center;
                  padding: 20px;
                }
                h1 {
                  font-size: 24px;
                  margin-bottom: 10px;
                }
                h2 {
                  font-size: 18px;
                  color: #666;
                  margin-bottom: 20px;
                }
                img {
                  max-width: 400px;
                  height: auto;
                  margin: 20px 0;
                }
                .link {
                  font-size: 14px;
                  color: #666;
                  word-break: break-all;
                  margin-top: 20px;
                }
                @media print {
                  @page {
                    size: auto;
                    margin: 20mm;
                  }
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Código QR para Entrega</h1>
                ${orderNumber ? `<h2>Pedido #${orderNumber}</h2>` : ''}
                <img src="${qrCodeUrl}" alt="QR Code" />
                ${deliveryLink ? `<div class="link">${deliveryLink}</div>` : ''}
                <p style="margin-top: 30px; font-size: 12px; color: #999;">
                  Escanea este código para confirmar la entrega
                </p>
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 250);
      }
    }
  };

  if (!qrCodeUrl && !deliveryLink) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Código QR de Entrega
          </CardTitle>
          <CardDescription>
            El código QR se generará al confirmar el pedido
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5" />
          Código QR de Entrega
        </CardTitle>
        <CardDescription>
          Comparte este código con el repartidor para confirmar la entrega
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* QR Code Image */}
        {qrCodeUrl && !imageError && (
          <div className="flex justify-center p-4 bg-white rounded-lg border-2 border-dashed">
            <img
              src={qrCodeUrl}
              alt="QR Code para entrega"
              className="w-64 h-64"
              onError={() => setImageError(true)}
            />
          </div>
        )}

        {imageError && (
          <div className="flex justify-center items-center p-8 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              No se pudo cargar el código QR
            </p>
          </div>
        )}

        {/* Delivery Link */}
        {deliveryLink && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Link de entrega:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={deliveryLink}
                readOnly
                className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={copyLink}
                title="Copiar link"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={openLink}
                title="Abrir en nueva pestaña"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {qrCodeUrl && (
            <>
              <Button variant="outline" onClick={downloadQR} className="flex-1">
                <Download className="mr-2 h-4 w-4" />
                Descargar QR
              </Button>
              <Button variant="outline" onClick={printQR} className="flex-1">
                <QrCode className="mr-2 h-4 w-4" />
                Imprimir QR
              </Button>
            </>
          )}
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <p className="font-medium">Instrucciones:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Comparte el QR con el repartidor (WhatsApp, impreso, etc.)</li>
            <li>El repartidor escanea el QR al llegar a la dirección</li>
            <li>Confirma la entrega o reporta un problema</li>
            <li>El QR se desactiva automáticamente después del uso</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
