import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import QRCode from 'qrcode';

interface OrderForBatchPrint {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  address_reference?: string;
  neighborhood?: string;
  delivery_notes?: string;
  carrier_name?: string;
  cod_amount?: number;
  delivery_link_token: string;
  items: Array<{
    product_name: string;
    quantity_needed: number;
  }>;
}

interface BatchLabelPrinterProps {
  orders: OrderForBatchPrint[];
  onClose: () => void;
  onPrinted: () => void;
}

export function BatchLabelPrinter({ orders, onClose, onPrinted }: BatchLabelPrinterProps) {
  const [qrCodes, setQrCodes] = useState<Map<string, { tracking: string; maps: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [hasAutoprinted, setHasAutoprinted] = useState(false);

  useEffect(() => {
    const generateAllQRCodes = async () => {
      const codes = new Map<string, { tracking: string; maps: string }>();

      for (const order of orders) {
        try {
          const deliveryUrl = `${window.location.origin}/delivery/${order.delivery_link_token}`;

          // Generate tracking QR
          const trackingQr = await QRCode.toDataURL(deliveryUrl, {
            width: 200,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' },
          });

          codes.set(order.id, { tracking: trackingQr, maps: '' });
        } catch (error) {
          console.error(`Error generating QR codes for order ${order.id}:`, error);
        }
      }

      setQrCodes(codes);
      setLoading(false);
    };

    generateAllQRCodes();
  }, [orders]);

  // Auto-print when all QR codes are generated
  useEffect(() => {
    if (!loading && !hasAutoprinted && qrCodes.size === orders.length) {
      // Wait a bit for DOM to fully render
      const timer = setTimeout(() => {
        window.print();
        setHasAutoprinted(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loading, hasAutoprinted, qrCodes.size, orders.length]);

  const handlePrint = () => {
    window.print();
    onPrinted();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Generando etiquetas...</p>
          <p className="text-sm text-muted-foreground mt-2">
            {qrCodes.size} de {orders.length} etiquetas listas
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Actions - Only visible on screen, not in print */}
      <div className="flex gap-2 justify-between print:hidden sticky top-0 bg-background p-4 border-b z-10">
        <div>
          <h2 className="text-lg font-bold">Impresión en Lote</h2>
          <p className="text-sm text-muted-foreground">{orders.length} etiquetas para imprimir</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="gap-2">
            <X size={16} />
            Cancelar
          </Button>
          <Button onClick={handlePrint} className="gap-2">
            <Printer size={16} />
            Imprimir Todas ({orders.length})
          </Button>
        </div>
      </div>

      {/* Labels Container */}
      <div id="batch-print-container" className="space-y-0">
        {orders.map((order, index) => {
          const codes = qrCodes.get(order.id);
          if (!codes) return null;

          return (
            <div
              key={order.id}
              className="batch-label bg-white text-black p-3 border-2 border-dashed border-gray-300 mb-4 print:mb-0"
              style={{
                width: '6in',
                minHeight: '4in',
                fontSize: '9pt',
                pageBreakAfter: index < orders.length - 1 ? 'always' : 'auto',
              }}
            >
              <div className="flex gap-3 h-full">
                {/* Left Column: QR Code */}
                <div className="flex flex-col items-center justify-center" style={{ width: '35%' }}>
                  {codes.tracking ? (
                    <img
                      src={codes.tracking}
                      alt="QR Code"
                      className="w-32 h-32 border-2 border-black"
                    />
                  ) : (
                    <div className="w-32 h-32 border-2 border-black bg-gray-100 flex items-center justify-center">
                      <p className="text-xs text-gray-500">Generando QR...</p>
                    </div>
                  )}
                  <p className="text-[7pt] font-bold mt-1 text-center">ESCANEAR PARA GESTIONAR ENTREGA</p>
                </div>

                {/* Right Column: Info */}
                <div className="flex-1 flex flex-col justify-between" style={{ width: '65%' }}>
                  {/* Header */}
                  <div className="mb-2 pb-1 border-b-2 border-black">
                    <h1 className="text-sm font-bold">ETIQUETA DE ENTREGA</h1>
                    <p className="text-[8pt] font-mono">#{order.order_number}</p>
                  </div>

                  {/* Customer Info */}
                  <div className="mb-2 pb-1 border-b border-gray-300">
                    <p className="text-[8pt] font-bold mb-0.5">CLIENTE:</p>
                    <p className="text-[8pt] font-semibold">{order.customer_name}</p>
                    <p className="text-[7pt]">Tel: {order.customer_phone}</p>
                    {order.customer_address && (
                      <p className="text-[7pt] mt-0.5 leading-tight">{order.customer_address}</p>
                    )}
                    {order.neighborhood && (
                      <p className="text-[7pt] leading-tight">Barrio: {order.neighborhood}</p>
                    )}
                    {order.address_reference && (
                      <p className="text-[7pt] leading-tight">Ref: {order.address_reference}</p>
                    )}
                    {order.delivery_notes && (
                      <p className="text-[6pt] leading-tight italic text-gray-600">
                        Nota: {order.delivery_notes}
                      </p>
                    )}
                  </div>

                  {/* Courier Info */}
                  {order.carrier_name && (
                    <div className="mb-2 pb-1 border-b border-gray-300">
                      <p className="text-[8pt] font-bold mb-0.5">REPARTIDOR:</p>
                      <p className="text-[8pt] font-semibold">{order.carrier_name}</p>
                      {order.cod_amount && order.cod_amount > 0 && (
                        <p className="text-[8pt] font-bold text-red-700 mt-0.5">
                          💰 COBRAR: Gs. {order.cod_amount.toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Products */}
                  <div className="mb-2 pb-1 border-b border-gray-300">
                    <p className="text-[8pt] font-bold mb-0.5">PRODUCTOS:</p>
                    <ul className="space-y-0.5">
                      {order.items && order.items.length > 0 ? (
                        order.items.map((item, idx) => (
                          <li key={idx} className="text-[7pt]">
                            • {item.product_name || 'Producto'} <strong>(x{item.quantity_needed || 1})</strong>
                          </li>
                        ))
                      ) : (
                        <li className="text-[7pt] text-gray-500">Sin productos</li>
                      )}
                    </ul>
                  </div>

                  {/* Instructions for Customer */}
                  <div className="bg-blue-50 border border-blue-300 rounded p-1.5">
                    <p className="text-[7pt] font-bold text-blue-900 mb-0.5">📦 CLIENTE:</p>
                    <p className="text-[6pt] text-blue-800 leading-tight">
                      Después de recibir tu pedido, <strong>escanea el QR</strong> para calificar tu experiencia.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Print-specific styles */}
      <style>{`
        @media print {
          /* Hide everything except the labels */
          body * {
            visibility: hidden;
          }

          #batch-print-container,
          #batch-print-container * {
            visibility: visible;
          }

          /* Reset body/html for printing */
          html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: visible;
          }

          /* Label container */
          .batch-label {
            position: relative;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            max-width: 100%;
            max-height: 100%;
            padding: 0.15in;
            margin: 0;
            page-break-inside: avoid;
            overflow: visible !important;
            border: none !important;
            box-sizing: border-box;
            display: flex;
            flex-direction: row;
            gap: 0.15in;
          }

          /* QR Code container */
          .batch-label > div:first-child {
            width: 35%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }

          /* QR Code image */
          .batch-label img {
            max-width: 1.8in !important;
            max-height: 1.8in !important;
            width: 1.8in !important;
            height: 1.8in !important;
            object-fit: contain;
            page-break-inside: avoid;
            border: 2px solid black;
          }

          /* Info container */
          .batch-label > div:last-child {
            width: 65%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }

          /* Adjust font sizes for print */
          .batch-label h1 {
            font-size: 10pt !important;
          }

          .batch-label p {
            margin: 0;
            padding: 0;
          }

          /* Page setup - 6x4 inches landscape */
          @page {
            size: 6in 4in landscape;
            margin: 0.1in;
          }
        }
      `}</style>
    </div>
  );
}
