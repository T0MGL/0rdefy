import * as React from 'react';
import { BaseLayout } from './BaseLayout';
import {
  CTAButton,
  Divider,
  Heading,
  InfoTable,
  ItemsTable,
  Paragraph,
  SmallText,
  SubHeading,
} from './components';
import { CURRENT_YEAR } from './brand';

export interface InvoiceEmailItem {
  name: string;
  quantity: number;
  unitPrice: string;
}

export interface InvoiceEmailData {
  customerName: string;
  storeName: string;
  documentNumber: string;
  invoiceDate: string;
  items: InvoiceEmailItem[];
  subtotal: string;
  iva10: string;
  total: string;
  kudeUrl: string | null;
  isDemo: boolean;
}

export function InvoiceEmail(data: InvoiceEmailData) {
  const formattedNumber = data.documentNumber.padStart(7, '0');

  // Items in Invoice use unitPrice; we map into the shared ItemsTable shape
  // so the totals row (IVA 10% + Total) renders consistently with the order
  // confirmation email.
  const items = data.items.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    price: i.unitPrice,
  }));

  const validationNote = data.isDemo
    ? 'Esta factura fue generada en modo demo y no tiene validez fiscal ante la DNIT.'
    : 'Esta es tu factura electrónica válida ante la DNIT. Podés consultarla en el portal oficial usando el botón de arriba.';

  return (
    <BaseLayout
      preheader={`Factura #${formattedNumber} de ${data.storeName}. Total: ${data.total}`}
    >
      <Heading>{`Factura #${formattedNumber}`}</Heading>
      <SubHeading>{`Tu comprobante electrónico de ${data.storeName}.`}</SubHeading>
      <Paragraph>
        {`Hola ${data.customerName}, adjunto encontrarás los detalles de tu factura electrónica.`}
      </Paragraph>
      <InfoTable
        rows={[
          { label: 'Número', value: `#${formattedNumber}` },
          { label: 'Fecha', value: data.invoiceDate },
          { label: 'Emisor', value: data.storeName },
        ]}
      />
      <ItemsTable
        items={items}
        priceHeader="P. Unitario"
        totals={[
          { label: 'IVA 10%', value: data.iva10 },
          { label: 'Total', value: data.total, emphasis: true },
        ]}
      />
      {data.kudeUrl ? (
        <CTAButton href={data.kudeUrl}>
          Ver factura electrónica en DNIT
        </CTAButton>
      ) : null}
      <Divider />
      <SmallText>{validationNote}</SmallText>
    </BaseLayout>
  );
}

export function invoiceEmailSubject(data: InvoiceEmailData): string {
  const formattedNumber = data.documentNumber.padStart(7, '0');
  return `Tu factura electrónica #${formattedNumber} - ${data.storeName}`;
}

export function invoiceEmailText(data: InvoiceEmailData): string {
  const formattedNumber = data.documentNumber.padStart(7, '0');
  const validationNote = data.isDemo
    ? 'Esta factura fue generada en modo demo y no tiene validez fiscal ante la DNIT.'
    : 'Esta es tu factura electrónica válida ante la DNIT. Podés consultarla en el portal oficial usando el botón de arriba.';

  const itemsText = data.items
    .map((i) => `  ${i.name} x${i.quantity}: ${i.unitPrice}`)
    .join('\n');

  return [
    `Factura electrónica #${formattedNumber}`,
    '',
    `Hola ${data.customerName},`,
    '',
    `Adjunto los detalles de tu factura electrónica de ${data.storeName}.`,
    '',
    `Fecha: ${data.invoiceDate}`,
    '',
    'Productos:',
    itemsText,
    '',
    `IVA 10%: ${data.iva10}`,
    `Total: ${data.total}`,
    '',
    data.kudeUrl ? `Ver en DNIT: ${data.kudeUrl}\n` : '',
    validationNote,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ]
    .filter(Boolean)
    .join('\n');
}
