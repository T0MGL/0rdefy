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

      {/* Printable Label - 4x6 inch format (10.16cm x 15.24cm) */}
      <div
        id="print-label"
        ref={printRef}
        className="bg-white text-black p-4 rounded-lg border-2 border-dashed border-gray-300"
        style={{
          width: '4in', // 4 inches (10.16cm)
          minHeight: '6in', // 6 inches (15.24cm)
          fontSize: '10pt',
        }}
      >
        {/* Header - Compact */}
        <div className="text-center mb-3 pb-2 border-b-2 border-black">
          <h1 className="text-lg font-bold">ETIQUETA DE ENTREGA</h1>
          <p className="text-xs font-mono">#{orderId.slice(0, 8).toUpperCase()}</p>
        </div>

        {/* QR Code - Centered */}
        <div className="flex flex-col items-center mb-3">
          {qrCodeUrl ? (
            <img src={qrCodeUrl} alt="QR Code" className="w-40 h-40 border-2 border-black" />
          ) : (
            <div className="w-40 h-40 border-2 border-black bg-gray-100 flex items-center justify-center">
              <p className="text-xs text-gray-500">Generando QR...</p>
            </div>
          )}
          <p className="text-[8pt] font-bold mt-1 text-center">ESCANEAR AL ENTREGAR</p>
        </div>

        {/* Customer Info - Compact */}
        <div className="mb-2 pb-2 border-b border-gray-300">
          <p className="text-[9pt] font-bold mb-1">CLIENTE:</p>
          <p className="text-[9pt] font-semibold">{customerName}</p>
          <p className="text-[8pt]">Tel: {customerPhone}</p>
          {customerAddress && (
            <p className="text-[8pt] mt-1 leading-tight">{customerAddress}</p>
          )}
        </div>

        {/* Courier Info */}
        {courierName && (
          <div className="mb-2 pb-2 border-b border-gray-300">
            <p className="text-[9pt] font-bold mb-1">REPARTIDOR:</p>
            <p className="text-[9pt] font-semibold">{courierName}</p>
          </div>
        )}

        {/* Products - Compact */}
        <div className="mb-2 pb-2 border-b border-gray-300">
          <p className="text-[9pt] font-bold mb-1">PRODUCTOS:</p>
          <ul className="space-y-0.5">
            {products && products.length > 0 ? (
              products.map((product, index) => (
                <li key={index} className="text-[8pt]">
                  • {product.name || 'Producto'} <strong>(x{product.quantity || 1})</strong>
                </li>
              ))
            ) : (
              <li className="text-[8pt] text-gray-500">Sin productos</li>
            )}
          </ul>
        </div>

        {/* Instructions for Courier - Compact */}
        <div className="mb-2 pb-2 border-b border-gray-300">
          <p className="text-[8pt] font-bold mb-1">INSTRUCCIONES REPARTIDOR:</p>
          <ol className="text-[7pt] space-y-0.5 list-decimal list-inside leading-tight">
            <li>Escanea el QR al entregar</li>
            <li>Confirma entrega en la app</li>
            <li>Reporta fallas si ocurren</li>
            <li>Foto opcional como evidencia</li>
          </ol>
        </div>

        {/* Instructions for Customer - NEW */}
        <div className="bg-blue-50 border-2 border-blue-300 rounded p-2 mb-2">
          <p className="text-[8pt] font-bold text-blue-900 mb-1">📦 MENSAJE PARA EL CLIENTE:</p>
          <p className="text-[7pt] text-blue-800 leading-tight">
            Después de recibir tu pedido, <strong>escanea este QR</strong> o visita el link para{' '}
            <strong>calificar tu experiencia</strong> y dejarnos tu opinión. ¡Tu feedback nos ayuda a mejorar!
          </p>
        </div>

        {/* Footer - Token */}
        <div className="text-center">
          <p className="text-[7pt] text-gray-600 font-mono break-all">
            Token: {deliveryToken}
          </p>
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
            width: 4in;
            min-height: 6in;
            padding: 0.25in;
            page-break-after: avoid;
            overflow: visible !important;
            border: none !important;
          }

          #print-label img {
            max-width: 2.5in !important;
            max-height: 2.5in !important;
            width: 2.5in !important;
            height: 2.5in !important;
            object-fit: contain;
            page-break-inside: avoid;
          }

          @page {
            size: 4in 6in;
            margin: 0.1in;
          }
        }
      `}</style>
    </div>
  );
}
