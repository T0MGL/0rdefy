import { useRef, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Copy, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';

interface LabelData {
  storeName: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  neighborhood?: string;
  city?: string;
  addressReference?: string;
  carrierName?: string;
  codAmount?: number;
  paymentMethod?: string;
  financialStatus?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided';
  deliveryToken: string;
  items: Array<{
    name: string;
    quantity: number;
  }>;
}

interface LabelPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LabelData | null;
  onPrinted?: () => void;
}

export function LabelPreviewModal({ open, onOpenChange, data, onPrinted }: LabelPreviewModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const labelRef = useRef<HTMLDivElement>(null);

  const deliveryUrl = data ? `${window.location.origin}/delivery/${data.deliveryToken}` : '';

  // Determine payment status
  const isPaidByShopify = data?.financialStatus === 'paid' || data?.financialStatus === 'authorized';
  const isCODLocal = (data?.paymentMethod === 'cash' || data?.paymentMethod === 'efectivo') &&
                     data?.codAmount && data.codAmount > 0;
  const showCOD = !isPaidByShopify && isCODLocal;

  useEffect(() => {
    if (data?.deliveryToken) {
      QRCode.toDataURL(deliveryUrl, {
        width: 300,
        margin: 0,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M',
      })
        .then(setQrCodeUrl)
        .catch((err) => console.error('QR error:', err));
    }
  }, [deliveryUrl, data?.deliveryToken]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(deliveryUrl);
      setCopied(true);
      toast({
        title: 'Link copiado',
        description: 'Link de entrega copiado al portapapeles',
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

  const handlePrint = () => {
    window.print();
    if (onPrinted) {
      onPrinted();
    }
  };

  if (!data) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden print:hidden">
        <DialogHeader className="p-4 pb-2 print:hidden">
          <DialogTitle className="flex items-center justify-between">
            <span>Etiqueta de Envío</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <X size={16} />
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Actions */}
        <div className="flex gap-2 justify-end px-4 pb-2 print:hidden">
          <Button variant="outline" onClick={handleCopyLink} className="gap-2">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copiado' : 'Copiar Link'}
          </Button>
          <Button onClick={handlePrint} className="gap-2 bg-black text-white hover:bg-gray-800">
            <Printer size={16} />
            Imprimir 4x6
          </Button>
        </div>

        {/* Preview container */}
        <div className="bg-gray-100 dark:bg-gray-900 p-4 flex justify-center print:hidden">
          <div className="shadow-lg bg-white">
            {/* Preview scaled down to fit modal */}
            <div style={{ transform: 'scale(0.85)', transformOrigin: 'top center' }}>
              <LabelContent data={data} qrCodeUrl={qrCodeUrl} showCOD={showCOD} isPaidByShopify={isPaidByShopify} />
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Print-only: Full size label */}
      <div className="hidden print:block print:fixed print:inset-0 print:z-[9999]" ref={labelRef}>
        <LabelContent data={data} qrCodeUrl={qrCodeUrl} showCOD={showCOD} isPaidByShopify={isPaidByShopify} />
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          @page {
            size: 4in 6in;
            margin: 0;
          }

          html, body {
            width: 4in !important;
            height: 6in !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: white !important;
          }

          /* Hide everything */
          body > * {
            display: none !important;
            visibility: hidden !important;
          }

          /* Show only our print container */
          .print\\:block {
            display: block !important;
            visibility: visible !important;
          }

          .print\\:hidden {
            display: none !important;
          }

          /* Radix dialog portal */
          [data-radix-portal] {
            display: none !important;
          }
        }
      `}</style>
    </Dialog>
  );
}

// Separate component for the label content to reuse in preview and print
function LabelContent({
  data,
  qrCodeUrl,
  showCOD,
  isPaidByShopify
}: {
  data: LabelData;
  qrCodeUrl: string;
  showCOD: boolean;
  isPaidByShopify: boolean;
}) {
  return (
    <div
      className="thermal-label"
      style={{
        width: '4in',
        height: '6in',
        background: 'white',
        color: 'black',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        border: '3px solid black',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* HEADER - 10% */}
      <div style={{
        height: '10%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        borderBottom: '3px solid black',
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 800,
          textTransform: 'uppercase',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          maxWidth: '55%',
        }}>
          {data.storeName}
        </div>
        <div style={{
          fontSize: '20px',
          fontWeight: 900,
          letterSpacing: '-1px',
        }}>
          #{data.orderNumber}
        </div>
      </div>

      {/* ADDRESS - 35% */}
      <div style={{
        height: '35%',
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '3px solid black',
      }}>
        <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '2px' }}>
          ENTREGAR A:
        </div>
        <div style={{
          fontSize: '18px',
          fontWeight: 900,
          lineHeight: 1.1,
          textTransform: 'uppercase',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {data.customerName}
        </div>
        <div style={{
          fontSize: '13px',
          fontWeight: 600,
          lineHeight: 1.2,
          marginTop: '4px',
          flex: 1,
        }}>
          {data.customerAddress}
          {data.neighborhood && `, ${data.neighborhood}`}
        </div>
        {data.addressReference && (
          <div style={{ fontSize: '11px', fontStyle: 'italic', marginTop: '2px' }}>
            REF: {data.addressReference}
          </div>
        )}
        <div style={{
          display: 'inline-block',
          padding: '2px 6px',
          border: '2px solid black',
          fontFamily: 'monospace',
          fontSize: '13px',
          fontWeight: 700,
          marginTop: '4px',
          width: 'fit-content',
        }}>
          TEL: {data.customerPhone}
        </div>
      </div>

      {/* QR + PAYMENT - 30% */}
      <div style={{
        height: '30%',
        display: 'flex',
        borderBottom: '3px solid black',
      }}>
        {/* QR Code */}
        <div style={{
          width: '45%',
          borderRight: '3px solid black',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px',
        }}>
          {qrCodeUrl && (
            <img
              src={qrCodeUrl}
              alt="QR"
              style={{
                width: '100%',
                maxWidth: '120px',
                height: 'auto',
                imageRendering: 'pixelated',
              }}
            />
          )}
        </div>

        {/* Payment Info */}
        <div style={{
          width: '55%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '8px',
          textAlign: 'center',
          gap: '8px',
        }}>
          {showCOD ? (
            <div style={{
              width: '100%',
              background: 'black',
              color: 'white',
              padding: '10px 6px',
            }}>
              <div style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase' }}>
                COBRAR
              </div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>
                Gs. {data.codAmount?.toLocaleString()}
              </div>
            </div>
          ) : (
            <div style={{
              width: '100%',
              border: '3px solid black',
              padding: '10px 6px',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 900 }}>
                PAGADO
              </div>
              <div style={{ fontSize: '10px', fontWeight: 600 }}>
                {data.financialStatus === 'authorized' ? 'AUTORIZADO' :
                 data.financialStatus === 'paid' ? 'CONFIRMADO' : 'STANDARD'}
              </div>
            </div>
          )}
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
            {data.carrierName || 'ENVÍO PROPIO'}
          </div>
        </div>
      </div>

      {/* ITEMS - 25% */}
      <div style={{
        height: '25%',
        padding: '4px 6px',
        overflow: 'hidden',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '10px',
        }}>
          <thead>
            <tr>
              <th style={{
                width: '15%',
                textAlign: 'center',
                borderBottom: '2px solid black',
                padding: '2px',
                fontWeight: 800,
              }}>
                QTY
              </th>
              <th style={{
                width: '85%',
                textAlign: 'left',
                borderBottom: '2px solid black',
                padding: '2px',
                fontWeight: 800,
              }}>
                PRODUCTO
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.slice(0, 4).map((item, i) => (
              <tr key={i}>
                <td style={{
                  textAlign: 'center',
                  padding: '2px',
                  fontWeight: 700,
                  borderBottom: '1px solid #ddd',
                }}>
                  {item.quantity}
                </td>
                <td style={{
                  padding: '2px',
                  borderBottom: '1px solid #ddd',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '250px',
                }}>
                  {item.name}
                </td>
              </tr>
            ))}
            {data.items.length > 4 && (
              <tr>
                <td style={{ textAlign: 'center', padding: '2px', fontWeight: 700 }}>+</td>
                <td style={{ padding: '2px', fontStyle: 'italic' }}>
                  ...y {data.items.length - 4} más
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
