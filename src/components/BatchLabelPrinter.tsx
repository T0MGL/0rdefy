import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { ShippingLabelTemplate } from './ShippingLabelTemplate';

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

  const handlePrint = () => {
    window.print();
    onPrinted();
  };

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

      {/* Labels Container - Scrollable preview on screen */}
      <div id="batch-print-container" className="flex flex-col gap-8 print:gap-0 bg-gray-100 p-4 print:p-0 print:bg-white overflow-auto max-h-[80vh] print:max-h-none print:overflow-visible">
        {orders.map((order, index) => (
          <div
            key={order.id}
            className="batch-label-wrapper w-[600px] h-[400px] bg-white shadow-md mx-auto print:shadow-none print:w-full print:h-full print:mx-0 print:break-after-page"
            style={{ pageBreakAfter: 'always' }}
          >
            <ShippingLabelTemplate order={order} />
          </div>
        ))}
      </div>

      {/* Print-specific styles cleanup */}
      <style>{`
        @media print {
            /* Hide everything except the batch container */
            body * {
                visibility: hidden;
            }

            #batch-print-container,
            #batch-print-container * {
                visibility: visible;
            }
            
            #batch-print-container {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                margin: 0;
                padding: 0;
            }

            /* Ensure each label starts on a new page */
            .batch-label-wrapper {
                page-break-after: always;
                break-after: page;
                width: 100% !important;
                height: 100% !important;
                /* Force full page sizing for each label */
                min-height: 100vh; 
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
             /* Remove margin/gap in print */
            .batch-label-wrapper:last-child {
                page-break-after: auto;
                break-after: auto;
            }
        }
      `}</style>
    </div>
  );
}
