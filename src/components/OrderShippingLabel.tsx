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
  addressReference?: string;
  neighborhood?: string;
  deliveryNotes?: string;
  courierName?: string;
  codAmount?: number;
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
  addressReference,
  neighborhood,
  deliveryNotes,
  courierName,
  codAmount,
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
    <div className="label-wrapper">
      {/* Actions - Only visible on screen, not in print */}
      <div className="flex gap-2 justify-end print:hidden mb-4">
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

      {/* Printable Label - 4x6 inch PORTRAIT format for thermal printers */}
      <div
        id="print-label"
        ref={printRef}
        className="shipping-label"
      >
        <div className="label-content">
          {/* Left Column: QR Code */}
          <div className="qr-section">
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt="QR Code" className="qr-code" />
            ) : (
              <div className="qr-placeholder">
                <p>Generando QR...</p>
              </div>
            )}
            <p className="qr-instruction">ESCANEAR PARA GESTIONAR ENTREGA</p>
          </div>

          {/* Right Column: Info */}
          <div className="info-section">
            {/* Header */}
            <div className="header-section">
              <h1 className="label-title">ETIQUETA DE ENTREGA</h1>
              <p className="order-id">#{orderId.slice(0, 8).toUpperCase()}</p>
            </div>

            {/* Customer Info */}
            <div className="customer-section">
              <p className="section-title">CLIENTE:</p>
              <p className="customer-name">{customerName}</p>
              <p className="customer-phone">Tel: {customerPhone}</p>
              {customerAddress && (
                <p className="customer-address">{customerAddress}</p>
              )}
              {neighborhood && (
                <p className="customer-detail">Barrio: {neighborhood}</p>
              )}
              {addressReference && (
                <p className="customer-detail">Ref: {addressReference}</p>
              )}
              {deliveryNotes && (
                <p className="delivery-notes">Nota: {deliveryNotes}</p>
              )}
            </div>

            {/* Courier Info */}
            {courierName && (
              <div className="courier-section">
                <p className="section-title">REPARTIDOR:</p>
                <p className="courier-name">{courierName}</p>
                {codAmount && codAmount > 0 && (
                  <p className="cod-amount">
                    💰 COBRAR: Gs. {codAmount.toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {/* Products */}
            <div className="products-section">
              <p className="section-title">PRODUCTOS:</p>
              <ul className="products-list">
                {products && products.length > 0 ? (
                  products.map((product, index) => (
                    <li key={index} className="product-item">
                      • {product.name || 'Producto'} <strong>(x{product.quantity || 1})</strong>
                    </li>
                  ))
                ) : (
                  <li className="product-item-empty">Sin productos</li>
                )}
              </ul>
            </div>

            {/* Instructions for Customer */}
            <div className="customer-instructions">
              <p className="instruction-title">📦 CLIENTE:</p>
              <p className="instruction-text">
                Después de recibir tu pedido, <strong>escanea el QR</strong> para calificar tu experiencia.
              </p>
            </div>

            {/* Link to Delivery Page */}
            <div className="delivery-link">
              <p className="link-title">LINK DE ENTREGA:</p>
              <p className="link-url">{deliveryUrl}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Print-optimized styles */}
      <style>{`
        /* Screen styles */
        .label-wrapper {
          width: 100%;
          max-width: 600px;
        }

        .shipping-label {
          background: white;
          color: black;
          padding: 12px;
          border-radius: 8px;
          border: 2px dashed #d1d5db;
          width: 600px;
          min-height: 400px;
          box-sizing: border-box;
        }

        .label-content {
          display: flex;
          gap: 12px;
          height: 100%;
          width: 100%;
        }

        .qr-section {
          width: 35%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }

        .qr-code {
          width: 128px;
          height: 128px;
          border: 2px solid black;
          object-fit: contain;
        }

        .qr-placeholder {
          width: 128px;
          height: 128px;
          border: 2px solid black;
          background: #f3f4f6;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .qr-placeholder p {
          font-size: 10px;
          color: #6b7280;
        }

        .qr-instruction {
          font-size: 7pt;
          font-weight: bold;
          text-align: center;
          margin: 0;
          line-height: 1.2;
        }

        .info-section {
          width: 65%;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .header-section {
          padding-bottom: 4px;
          border-bottom: 2px solid black;
          margin-bottom: 4px;
        }

        .label-title {
          font-size: 12pt;
          font-weight: bold;
          margin: 0;
          line-height: 1.2;
        }

        .order-id {
          font-size: 8pt;
          font-family: monospace;
          margin: 2px 0 0 0;
        }

        .customer-section,
        .courier-section,
        .products-section {
          padding-bottom: 4px;
          border-bottom: 1px solid #d1d5db;
          margin-bottom: 4px;
        }

        .section-title {
          font-size: 8pt;
          font-weight: bold;
          margin: 0 0 2px 0;
        }

        .customer-name,
        .courier-name {
          font-size: 8pt;
          font-weight: 600;
          margin: 0;
        }

        .customer-phone,
        .customer-address,
        .customer-detail {
          font-size: 7pt;
          margin: 2px 0 0 0;
          line-height: 1.3;
        }

        .delivery-notes {
          font-size: 6pt;
          font-style: italic;
          color: #4b5563;
          margin: 2px 0 0 0;
          line-height: 1.3;
        }

        .cod-amount {
          font-size: 8pt;
          font-weight: bold;
          color: #b91c1c;
          margin: 2px 0 0 0;
        }

        .products-list {
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .product-item {
          font-size: 7pt;
          margin: 2px 0;
        }

        .product-item-empty {
          font-size: 7pt;
          color: #6b7280;
          margin: 2px 0;
        }

        .customer-instructions {
          background: #eff6ff;
          border: 1px solid #93c5fd;
          border-radius: 4px;
          padding: 6px;
          margin-bottom: 4px;
        }

        .instruction-title {
          font-size: 7pt;
          font-weight: bold;
          color: #1e3a8a;
          margin: 0 0 2px 0;
        }

        .instruction-text {
          font-size: 6pt;
          color: #1e40af;
          margin: 0;
          line-height: 1.3;
        }

        .delivery-link {
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 4px;
          text-align: center;
        }

        .link-title {
          font-size: 6pt;
          font-weight: bold;
          color: #4b5563;
          margin: 0 0 2px 0;
        }

        .link-url {
          font-size: 6pt;
          font-family: monospace;
          color: #1f2937;
          margin: 0;
          word-break: break-all;
          line-height: 1.2;
        }

        /* Print styles - Optimized for 4x6 inch thermal labels */
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          /* Hide everything except the label */
          body * {
            visibility: hidden !important;
          }

          .shipping-label,
          .shipping-label * {
            visibility: visible !important;
          }

          /* Page setup - 4x6 inches portrait for thermal printers */
          @page {
            size: 4in 6in portrait;
            margin: 0;
          }

          html,
          body {
            width: 4in;
            height: 6in;
            margin: 0;
            padding: 0;
            overflow: hidden;
          }

          .label-wrapper {
            width: 4in;
            height: 6in;
            margin: 0;
            padding: 0;
            max-width: 4in;
          }

          .shipping-label {
            position: absolute;
            left: 0;
            top: 0;
            width: 4in;
            height: 6in;
            max-width: 4in;
            max-height: 6in;
            padding: 0.2in;
            margin: 0;
            border: none !important;
            border-radius: 0;
            box-sizing: border-box;
            page-break-after: always;
            page-break-inside: avoid;
            overflow: hidden;
            background: white;
          }

          .label-content {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: 0.1in;
          }

          .qr-section {
            width: 100%;
            height: auto;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            gap: 0.05in;
            padding: 0.05in 0;
          }

          .qr-code {
            width: 1.5in !important;
            height: 1.5in !important;
            max-width: 1.5in !important;
            max-height: 1.5in !important;
            border: 2px solid black;
            object-fit: contain;
            page-break-inside: avoid;
          }

          .qr-placeholder {
            width: 1.5in !important;
            height: 1.5in !important;
          }

          .qr-instruction {
            font-size: 7pt !important;
            font-weight: bold !important;
            text-align: center;
            line-height: 1.1;
            max-width: 1.8in;
          }

          .info-section {
            width: 100%;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 0.06in;
            overflow: hidden;
          }

          .header-section {
            padding-bottom: 0.04in;
            margin-bottom: 0.04in;
            border-bottom: 2px solid black;
          }

          .label-title {
            font-size: 11pt !important;
            font-weight: bold !important;
            margin: 0;
            line-height: 1.1;
          }

          .order-id {
            font-size: 8pt !important;
            font-family: monospace;
            margin: 0.02in 0 0 0;
          }

          .customer-section,
          .courier-section,
          .products-section {
            padding-bottom: 0.04in;
            margin-bottom: 0.04in;
            border-bottom: 1px solid #9ca3af;
          }

          .section-title {
            font-size: 8pt !important;
            font-weight: bold !important;
            margin: 0 0 0.02in 0;
          }

          .customer-name,
          .courier-name {
            font-size: 8pt !important;
            font-weight: 600 !important;
            margin: 0;
          }

          .customer-phone,
          .customer-address,
          .customer-detail {
            font-size: 7pt !important;
            margin: 0.01in 0 0 0;
            line-height: 1.2;
          }

          .delivery-notes {
            font-size: 6pt !important;
            margin: 0.01in 0 0 0;
            line-height: 1.2;
          }

          .cod-amount {
            font-size: 9pt !important;
            font-weight: bold !important;
            color: #b91c1c !important;
            margin: 0.02in 0 0 0;
          }

          .products-list {
            margin: 0;
            padding: 0;
          }

          .product-item {
            font-size: 7pt !important;
            margin: 0.01in 0;
            line-height: 1.2;
          }

          .customer-instructions {
            background: #eff6ff !important;
            border: 1px solid #60a5fa !important;
            padding: 0.05in;
            margin-bottom: 0.04in;
          }

          .instruction-title {
            font-size: 7pt !important;
            font-weight: bold !important;
            margin: 0 0 0.02in 0;
          }

          .instruction-text {
            font-size: 6pt !important;
            margin: 0;
            line-height: 1.2;
          }

          .delivery-link {
            background: #f3f4f6 !important;
            border: 1px solid #9ca3af !important;
            padding: 0.04in;
          }

          .link-title {
            font-size: 6pt !important;
            margin: 0 0 0.02in 0;
          }

          .link-url {
            font-size: 5pt !important;
            line-height: 1.1;
          }

          /* Force page break after each label for batch printing */
          .shipping-label::after {
            content: "";
            display: block;
            page-break-after: always;
          }

          /* Ensure no orphans or widows */
          p, li {
            orphans: 3;
            widows: 3;
          }
        }
      `}</style>
    </div>
  );
}
