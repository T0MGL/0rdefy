import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { UniversalLabel } from '@/components/printing/UniversalLabel';

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
      <div className="flex gap-2 justify-between print:hidden sticky top-0 bg-background p-4 border-b z-10 shadow-sm">
        <div>
          <h2 className="text-lg font-bold">Impresión en Lote (Termal 4x6)</h2>
          <p className="text-sm text-muted-foreground">{orders.length} etiquetas listas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="gap-2">
            <X size={16} />
            Cancelar
          </Button>
          <Button onClick={handlePrint} className="gap-2 bg-black text-white hover:bg-gray-800">
            <Printer size={16} />
            Imprimir Todo
          </Button>
        </div>
      </div>

      {/* Labels Container - Scrollable vertical list of 4x6 cards */}
      <div id="batch-print-container" className="flex flex-col gap-8 items-center bg-gray-100 p-8 print:p-0 print:gap-0 print:bg-white">
        {orders.map((order) => (
          <div
            key={order.id}
            className="batch-label-wrapper shadow-xl print:shadow-none"
            style={{ width: '4in', height: '6in' }} // Enforce dimensions on screen preview
          >
            <UniversalLabel order={order} />
          </div>
        ))}
      </div>

      <style>{`
        @media print {
            body * { visibility: hidden; }
            #batch-print-container, #batch-print-container * { visibility: visible; }
            
            #batch-print-container {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                margin: 0;
                padding: 0;
                display: block; /* Remove flex in print to rely on flow */
            }

            .batch-label-wrapper {
                page-break-after: always;
                break-after: page;
                margin-bottom: 0;
                /* UniversalLabel handles the absolute sizing, wrapper just dictates flow */
                position: relative; 
            }
            .batch-label-wrapper:last-child {
                page-break-after: auto;
            }
        }
      `}</style>
    </div>
  );
}
