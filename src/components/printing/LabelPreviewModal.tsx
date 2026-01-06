import { useRef, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Copy, Check } from 'lucide-react';
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
  // Show COD if: has COD amount AND (financial status is NOT paid/authorized OR paymentMethod indicates cash)
  const isPaidByShopify = data?.financialStatus === 'paid' || data?.financialStatus === 'authorized';
  const hasCODAmount = data?.codAmount && data.codAmount > 0;
  const isCashPayment = data?.paymentMethod === 'cash' ||
    data?.paymentMethod === 'efectivo' ||
    data?.paymentMethod === 'cash_on_delivery';

  // Show COD if there's an amount to collect and it's not already paid by Shopify
  const showCOD = hasCODAmount && (!isPaidByShopify || isCashPayment);

  // DEBUG: Log payment data
  useEffect(() => {
    if (data) {
      console.log('🎫 [LABEL] Label data received:', {
        financialStatus: data.financialStatus,
        paymentMethod: data.paymentMethod,
        codAmount: data.codAmount,
        isPaidByShopify,
        hasCODAmount,
        isCashPayment,
        showCOD,
      });
    }
  }, [data, isPaidByShopify, hasCODAmount, isCashPayment, showCOD]);

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
    console.log('🖨️ [LABEL] Print button clicked');

    // Get the label content HTML
    const labelContainer = document.getElementById('thermal-label-print-container');
    if (!labelContainer) {
      console.error('🖨️ [LABEL] Label container not found');
      return;
    }

    console.log('🖨️ [LABEL] Label container HTML length:', labelContainer.innerHTML.length);

    // Create hidden iframe for isolated printing
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '4in';
    iframe.style.height = '6in';

    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) {
      console.error('🖨️ [LABEL] No iframe document available');
      document.body.removeChild(iframe);
      return;
    }

    // Write complete HTML to iframe
    iframeDoc.open();
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Etiqueta de Envío</title>
          <style>
            @page {
              size: 4in 6in;
              margin: 0;
            }

            *, *::before, *::after {
              box-sizing: border-box !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }

            html, body {
              width: 4in !important;
              height: 6in !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
              background: white !important;
            }

            body {
              font-family: system-ui, -apple-system, sans-serif;
            }
          </style>
        </head>
        <body>
          ${labelContainer.innerHTML}
        </body>
      </html>
    `);
    iframeDoc.close();

    console.log('🖨️ [LABEL] HTML written to iframe, waiting for images to load...');

    // Wait for images and content to load, then print
    setTimeout(() => {
      console.log('🖨️ [LABEL] Opening print dialog...');
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        console.log('🖨️ [LABEL] Print dialog opened successfully');
      } catch (error) {
        console.error('🖨️ [LABEL] Print error:', error);
      }

      // Clean up after print dialog closes
      setTimeout(() => {
        console.log('🖨️ [LABEL] Cleaning up iframe');
        try {
          document.body.removeChild(iframe);
        } catch (e) {
          console.error('🖨️ [LABEL] Cleanup error:', e);
        }
        if (onPrinted) {
          onPrinted();
        }
      }, 1000);
    }, 100);
  };

  if (!data) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 pb-3">
            <DialogTitle>Etiqueta de Envío</DialogTitle>
          </DialogHeader>

          {/* Actions */}
          <div className="flex gap-2 justify-end px-4 pb-3">
            <Button variant="outline" onClick={handleCopyLink} className="gap-2" type="button">
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copiado' : 'Copiar Link'}
            </Button>
            <Button
              type="button"
              onClick={handlePrint}
              className="gap-2"
            >
              <Printer size={16} />
              Imprimir 4x6
            </Button>
          </div>

          {/* Preview container - Clean white background */}
          <div className="bg-white dark:bg-gray-950 p-4 flex justify-center">
            <div className="bg-white" style={{ outline: 'none', border: 'none' }}>
              {/* Preview scaled down to fit modal */}
              <div style={{ transform: 'scale(0.75)', transformOrigin: 'top center' }}>
                <LabelContent data={data} qrCodeUrl={qrCodeUrl} showCOD={showCOD} isPaidByShopify={isPaidByShopify} />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hidden container for iframe printing (never visible, only used to clone HTML) */}
      <div
        id="thermal-label-print-container"
        style={{ display: 'none' }}
        ref={labelRef}
      >
        <LabelContent data={data} qrCodeUrl={qrCodeUrl} showCOD={showCOD} isPaidByShopify={isPaidByShopify} isPrint={true} />
      </div>
    </>
  );
}

// Separate component for the label content to reuse in preview and print
function LabelContent({
  data,
  qrCodeUrl,
  showCOD,
  isPaidByShopify,
  isPrint = false
}: {
  data: LabelData;
  qrCodeUrl: string;
  showCOD: boolean;
  isPaidByShopify: boolean;
  isPrint?: boolean;
}) {
  // Balanced margin - enough space to show header, minimal bottom waste
  const marginTop = isPrint ? '0.7in' : '0';      // Increased from 0.4in to center vertically
  const sidePadding = isPrint ? '0.08in' : '0';

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
        alignItems: 'center',
        paddingLeft: sidePadding,
        paddingRight: sidePadding,
        paddingTop: marginTop,
        boxSizing: 'border-box',
        overflow: 'visible',  // Allow content to show
      }}
    >
      {/* Inner container with border - MAXIMIZED HEIGHT */}
      <div style={{
        width: '100%',
        height: '5.5in',  // 6in - 0.4in top - 0.1in bottom = 5.5in
        border: '3px solid black',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      >
        {/* HEADER - 9% */}
        <div style={{
          height: '9%', // Slightly increased from 8%
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '3px 8px',
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
            fontSize: '18px',
            fontWeight: 900,
            letterSpacing: '-1px',
          }}>
            {data.orderNumber}
          </div>
        </div>

        {/* ADDRESS - 33% */}
        <div style={{
          height: '33%', // Slightly increased from 32%
          padding: '5px 8px',
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '3px solid black',
        }}>
          <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '1px' }}>
            ENTREGAR A:
          </div>
          <div style={{
            fontSize: '17px',
            fontWeight: 900,
            lineHeight: 1.05,
            textTransform: 'uppercase',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {data.customerName}
          </div>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            lineHeight: 1.15,
            marginTop: '3px',
            flex: 1,
          }}>
            {data.customerAddress}
            {data.neighborhood && `, ${data.neighborhood}`}
          </div>
          {data.addressReference && (
            <div style={{ fontSize: '10px', fontStyle: 'italic', marginTop: '1px' }}>
              REF: {data.addressReference}
            </div>
          )}
          <div style={{
            display: 'inline-block',
            padding: '2px 5px',
            border: '2px solid black',
            fontFamily: 'monospace',
            fontSize: '12px',
            fontWeight: 700,
            marginTop: '3px',
            width: 'fit-content',
          }}>
            TEL: {data.customerPhone}
          </div>
        </div>

        {/* QR + PAYMENT - 31% */}
        <div style={{
          height: '31%', // Adjusted from 33% to balance total height
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
                padding: '12px 8px',
              }}>
                <div style={{ fontSize: '16px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '4px' }}>
                  COBRAR
                </div>
                <div style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '0.5px' }}>
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

        {/* ITEMS - 27% más espacio */}
        <div style={{
          height: '27%',
          padding: '3px 6px',
          overflow: 'hidden',
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '9px',
          }}>
            <thead>
              <tr>
                <th style={{
                  width: '15%',
                  textAlign: 'center',
                  borderBottom: '2px solid black',
                  padding: '1px',
                  fontWeight: 800,
                }}>
                  QTY
                </th>
                <th style={{
                  width: '85%',
                  textAlign: 'left',
                  borderBottom: '2px solid black',
                  padding: '1px',
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
                    padding: '1px',
                    fontWeight: 700,
                    borderBottom: '1px solid #ddd',
                  }}>
                    {item.quantity}
                  </td>
                  <td style={{
                    padding: '1px 2px',
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
                  <td style={{ textAlign: 'center', padding: '1px', fontWeight: 700 }}>+</td>
                  <td style={{ padding: '1px 2px', fontStyle: 'italic' }}>
                    ...y {data.items.length - 4} más
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
