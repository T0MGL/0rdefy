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
  onPrinted?: () => void; // Callback when label is printed
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
  onPrinted,
}: OrderShippingLabelProps) {
  const { toast } = useToast();
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const deliveryUrl = `${window.location.origin}/delivery/${deliveryToken}`;

  useEffect(() => {
    // Generate QR code
    QRCode.toDataURL(deliveryUrl, {
      width: 200,
      margin: 1,
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
    // Call the onPrinted callback after printing
    if (onPrinted) {
      onPrinted();
    }
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

      {/* Printable Label - 6x4 inch HORIZONTAL format (15.24cm x 10.16cm) */}
      <div
        id="print-label"
        ref={printRef}
        className="bg-white text-black p-3 rounded-lg border-2 border-dashed border-gray-300"
        style={{
          width: '6in', // 6 inches (15.24cm) - HORIZONTAL
          minHeight: '4in', // 4 inches (10.16cm) - HORIZONTAL
          fontSize: '9pt',
        }}
      >
        <div className="flex gap-3 h-full">
          {/* Left Column: QR Code */}
          <div className="flex flex-col items-center justify-center" style={{ width: '35%' }}>
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt="QR Code" className="w-32 h-32 border-2 border-black" />
            ) : (
              <div className="w-32 h-32 border-2 border-black bg-gray-100 flex items-center justify-center">
                <p className="text-xs text-gray-500">Generando QR...</p>
              </div>
            )}
            <p className="text-[7pt] font-bold mt-1 text-center">ESCANEAR AL ENTREGAR</p>
          </div>

          {/* Right Column: Info */}
          <div className="flex-1 flex flex-col justify-between" style={{ width: '65%' }}>
            {/* Header */}
            <div className="mb-2 pb-1 border-b-2 border-black">
              <h1 className="text-sm font-bold">ETIQUETA DE ENTREGA</h1>
              <p className="text-[8pt] font-mono">#{orderId.slice(0, 8).toUpperCase()}</p>
            </div>

            {/* Customer Info */}
            <div className="mb-2 pb-1 border-b border-gray-300">
              <p className="text-[8pt] font-bold mb-0.5">CLIENTE:</p>
              <p className="text-[8pt] font-semibold">{customerName}</p>
              <p className="text-[7pt]">Tel: {customerPhone}</p>
              {customerAddress && (
                <p className="text-[7pt] mt-0.5 leading-tight">{customerAddress}</p>
              )}
            </div>

            {/* Courier Info */}
            {courierName && (
              <div className="mb-2 pb-1 border-b border-gray-300">
                <p className="text-[8pt] font-bold mb-0.5">REPARTIDOR:</p>
                <p className="text-[8pt] font-semibold">{courierName}</p>
              </div>
            )}

            {/* Products */}
            <div className="mb-2 pb-1 border-b border-gray-300">
              <p className="text-[8pt] font-bold mb-0.5">PRODUCTOS:</p>
              <ul className="space-y-0.5">
                {products && products.length > 0 ? (
                  products.map((product, index) => (
                    <li key={index} className="text-[7pt]">
                      • {product.name || 'Producto'} <strong>(x{product.quantity || 1})</strong>
                    </li>
                  ))
                ) : (
                  <li className="text-[7pt] text-gray-500">Sin productos</li>
                )}
              </ul>
            </div>

            {/* Instructions for Customer */}
            <div className="bg-blue-50 border border-blue-300 rounded p-1.5 mb-2">
              <p className="text-[7pt] font-bold text-blue-900 mb-0.5">📦 CLIENTE:</p>
              <p className="text-[6pt] text-blue-800 leading-tight">
                Después de recibir tu pedido, <strong>escanea el QR</strong> para calificar tu experiencia.
              </p>
            </div>

            {/* Link to Delivery Page */}
            <div className="text-center bg-gray-100 border border-gray-300 rounded p-1">
              <p className="text-[6pt] text-gray-600 font-bold mb-0.5">LINK DE ENTREGA:</p>
              <p className="text-[6pt] text-gray-800 font-mono break-all leading-tight">
                {deliveryUrl}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }

          #print-label,
          #print-label * {
            visibility: visible;
          }

          #print-label {
            position: absolute;
            left: 0;
            top: 0;
            width: 6in;
            min-height: 4in;
            padding: 0.2in;
            page-break-after: avoid;
            overflow: visible !important;
            border: none !important;
          }

          #print-label img {
            max-width: 2in !important;
            max-height: 2in !important;
            width: 2in !important;
            height: 2in !important;
            object-fit: contain;
            page-break-inside: avoid;
          }

          @page {
            size: 6in 4in landscape;
            margin: 0.1in;
          }
        }
      `}</style>
    </div>
  );
}
