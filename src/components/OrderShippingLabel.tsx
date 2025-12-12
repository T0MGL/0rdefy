import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ShippingLabelTemplate } from './ShippingLabelTemplate';

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
  const [copied, setCopied] = useState(false);

  // Construct the order object expected by the template
  const orderData = {
    id: orderId,
    order_number: orderId.slice(0, 8).toUpperCase(), // Simplified display ID
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_address: customerAddress,
    address_reference: addressReference,
    neighborhood: neighborhood,
    delivery_notes: deliveryNotes,
    carrier_name: courierName,
    cod_amount: codAmount,
    delivery_link_token: deliveryToken,
    items: products.map(p => ({
      product_name: p.name,
      quantity_needed: p.quantity
    }))
  };

  const deliveryUrl = `${window.location.origin}/delivery/${deliveryToken}`;

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
    <div className="flex flex-col gap-4">
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

      {/* Preview Container - Mimic Print View but Scaled Down if needed */}
      <div className="border border-gray-200 rounded-md overflow-hidden bg-gray-50 flex items-center justify-center p-4 print:p-0 print:border-none print:bg-white print:block">
        {/* 
            We use a wrapper to control the preview size on screen.
            In print, the component's own print styles take over.
         */}
        <div className="w-[600px] h-[400px] bg-white shadow-sm print:shadow-none print:w-full print:h-full">
          <ShippingLabelTemplate order={orderData} />
        </div>
      </div>
    </div>
  );
}
