import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, Copy, Check, HelpCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { UniversalLabel } from '@/components/printing/UniversalLabel';
import { PrintSetupGuide } from '@/components/PrintSetupGuide';

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
  paymentMethod?: string;
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
  paymentMethod,
  products,
  onClose,
  onPrinted,
}: OrderShippingLabelProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Map props to UniversalLabel data structure
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
    payment_method: paymentMethod,
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

  return (
    <>
      {/* Actions - Only visible on screen, not in print */}
      <div className="flex gap-2 justify-between mb-4 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHelp(true)}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <HelpCircle size={16} />
          Ayuda de Impresión
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCopyLink} className="gap-2">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copiado' : 'Link'}
          </Button>
          <Button onClick={handlePrint} className="gap-2 bg-black text-white hover:bg-gray-800">
            <Printer size={16} />
            Imprimir (4x6)
          </Button>
        </div>
      </div>

      {/* Print Setup Guide Dialog */}
      <PrintSetupGuide open={showHelp} onOpenChange={setShowHelp} />

      {/* Preview Container - Scaled to fit screen but maintains ratio */}
      <div className="bg-gray-100 p-4 rounded-md flex justify-center print:hidden">
        <div className="overflow-hidden shadow-lg">
          {/*
                Display at actual size: 384px x 576px (4in x 6in at 96 DPI)
                This ensures what you see is what you print
             */}
          <UniversalLabel order={orderData} />
        </div>
      </div>

      {/* Print-only container - No wrappers, direct label */}
      <div className="hidden print:block">
        <UniversalLabel order={orderData} />
      </div>
    </>
  );
}
