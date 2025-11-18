import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';

interface OrderShippingLabelProps {
  orderId: string;
  deliveryToken: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  courierName?: string;
  products: Array<{
    name: string;
    quantity: number;
  }>;
  onClose?: () => void;
}

export function OrderShippingLabel({
  orderId,
  deliveryToken,
  customerName,
  customerPhone,
  customerAddress,
  courierName,
  products,
  onClose,
}: OrderShippingLabelProps) {
  const { toast } = useToast();
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const deliveryUrl = `${window.location.origin}/delivery/${deliveryToken}`;

  useEffect(() => {
    // Generate QR code
    QRCode.toDataURL(deliveryUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        setQrCodeUrl(url);
      })
      .catch((err) => {
        console.error('Error generating QR code:', err);
      });
  }, [deliveryUrl]);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(deliveryUrl);
      setCopied(true);
      toast({
        title: 'Link copiado',
        description: 'El link de entrega ha sido copiado al portapapeles',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'No se pudo copiar el link',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Actions - Only visible on screen, not in print */}
      <div className="flex gap-2 justify-end print:hidden">
        <Button variant="outline" onClick={handleCopyLink} className="gap-2">
          {copied ? (
            <>
              <Check size={16} />
              Copiado
            </>
          ) : (
            <>
              <Copy size={16} />
              Copiar Link
            </>
          )}
        </Button>
        <Button onClick={handlePrint} className="gap-2">
          <Printer size={16} />
          Imprimir Etiqueta
        </Button>
      </div>

      {/* Printable Label */}
      <div
        id="print-label"
        ref={printRef}
        className="bg-white text-black p-8 rounded-lg border-2 border-dashed border-gray-300"
        style={{
          width: '210mm', // A5 width
          minHeight: '148mm', // A5 height
        }}
      >
        {/* Header */}
        <div className="text-center mb-6 pb-4 border-b-2 border-gray-300">
          <h1 className="text-3xl font-bold mb-2">ETIQUETA DE ENTREGA</h1>
          <p className="text-lg text-gray-600">Pedido #{orderId.slice(0, 8).toUpperCase()}</p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Left Column - QR Code */}
          <div className="flex flex-col items-center justify-center space-y-4">
            {qrCodeUrl ? (
              <>
                <img src={qrCodeUrl} alt="QR Code" className="w-64 h-64 border-4 border-black" />
                <div className="text-center">
                  <p className="text-sm font-semibold mb-1">ESCANEAR PARA CONFIRMAR ENTREGA</p>
                  <p className="text-xs text-gray-600 font-mono break-all px-4">
                    Token: {deliveryToken}
                  </p>
                </div>
              </>
            ) : (
              <div className="w-64 h-64 border-4 border-black bg-gray-100 flex items-center justify-center">
                <p className="text-gray-500">Generando QR...</p>
              </div>
            )}
          </div>

          {/* Right Column - Order Information */}
          <div className="space-y-4">
            {/* Customer Info */}
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-gray-600 uppercase border-b border-gray-300 pb-1">
                CLIENTE
              </h3>
              <p className="text-lg font-semibold">{customerName}</p>
              <p className="text-sm">
                <span className="font-semibold">Tel:</span> {customerPhone}
              </p>
              {customerAddress && (
                <p className="text-sm">
                  <span className="font-semibold">Dirección:</span>
                  <br />
                  {customerAddress}
                </p>
              )}
            </div>

            {/* Courier Info */}
            {courierName && (
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-gray-600 uppercase border-b border-gray-300 pb-1">
                  REPARTIDOR
                </h3>
                <p className="text-lg font-semibold">{courierName}</p>
              </div>
            )}

            {/* Products */}
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-gray-600 uppercase border-b border-gray-300 pb-1">
                PRODUCTOS
              </h3>
              <ul className="space-y-1">
                {products && products.length > 0 ? (
                  products.map((product, index) => (
                    <li key={index} className="text-sm">
                      • {product.name || product.title || 'Producto'}{' '}
                      <span className="font-semibold">(x{product.quantity || 1})</span>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-gray-500">Sin productos</li>
                )}
              </ul>
            </div>
          </div>
        </div>

        {/* Footer Instructions */}
        <div className="mt-6 pt-4 border-t-2 border-gray-300 space-y-2">
          <h3 className="text-sm font-bold text-gray-600 uppercase">INSTRUCCIONES PARA EL REPARTIDOR</h3>
          <ol className="text-xs space-y-1 list-decimal list-inside">
            <li>Escanea el código QR con tu celular al momento de entregar el pedido</li>
            <li>Confirma la entrega en la página que se abre</li>
            <li>Si hay algún problema, reporta la falla con el motivo correspondiente</li>
            <li>Puedes tomar una foto como comprobante de entrega (opcional)</li>
          </ol>
          <p className="text-xs text-gray-600 mt-3">
            <span className="font-semibold">Link alternativo:</span>{' '}
            <span className="font-mono break-all">{deliveryUrl}</span>
          </p>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }

          ${printRef.current ? `
            #print-label,
            #print-label * {
              visibility: visible;
            }

            #print-label {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              max-width: 210mm;
              min-height: 148mm;
              page-break-after: avoid;
              overflow: visible !important;
            }

            #print-label img {
              max-width: 180px !important;
              max-height: 180px !important;
              width: 180px !important;
              height: 180px !important;
              object-fit: contain;
              page-break-inside: avoid;
            }

            #print-label .grid {
              page-break-inside: avoid;
            }
          ` : ''}

          @page {
            size: A5 landscape;
            margin: 10mm;
          }
        }
      `}</style>
    </div>
  );
}
