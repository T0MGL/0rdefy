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

export interface OrderConfirmationItem {
  name: string;
  quantity: number;
  price: string;
}

export interface OrderConfirmationEmailData {
  customerName: string;
  storeName: string;
  orderNumber: string;
  orderDate: string;
  items: OrderConfirmationItem[];
  subtotal: string;
  shipping: string;
  total: string;
  trackingUrl?: string;
  storeLogoUrl?: string;
}

export function OrderConfirmationEmail(data: OrderConfirmationEmailData) {
  return (
    <BaseLayout
      preheader={`Tu pedido #${data.orderNumber} en ${data.storeName} fue confirmado. Total: ${data.total}`}
    >
      <Heading>{`Pedido #${data.orderNumber} confirmado`}</Heading>
      <SubHeading>{`Gracias por tu compra en ${data.storeName}.`}</SubHeading>
      <Paragraph>
        {`Hola ${data.customerName}, tu pedido fue recibido y está siendo procesado.`}
      </Paragraph>
      <InfoTable
        rows={[
          { label: 'Pedido', value: `#${data.orderNumber}` },
          { label: 'Fecha', value: data.orderDate },
          { label: 'Tienda', value: data.storeName },
        ]}
      />
      <ItemsTable
        items={data.items}
        totals={[
          { label: 'Subtotal', value: data.subtotal },
          { label: 'Envío', value: data.shipping },
          { label: 'Total', value: data.total, emphasis: true },
        ]}
      />
      {data.trackingUrl ? (
        <CTAButton href={data.trackingUrl}>Rastrear pedido</CTAButton>
      ) : (
        <Paragraph>
          Te notificaremos cuando tu pedido sea despachado con el número de
          seguimiento.
        </Paragraph>
      )}
      <Divider />
      <SmallText>
        {`Este correo fue enviado por ${data.storeName} a través de Ordefy.`}
      </SmallText>
    </BaseLayout>
  );
}

export function orderConfirmationEmailSubject(
  data: OrderConfirmationEmailData,
): string {
  return `Pedido #${data.orderNumber} confirmado`;
}

export function orderConfirmationEmailText(
  data: OrderConfirmationEmailData,
): string {
  const itemsText = data.items
    .map((i) => `  ${i.name} x${i.quantity}: ${i.price}`)
    .join('\n');

  return [
    `Pedido #${data.orderNumber} confirmado`,
    '',
    `Hola ${data.customerName}, tu pedido en ${data.storeName} fue recibido.`,
    '',
    'Productos:',
    itemsText,
    '',
    `Subtotal: ${data.subtotal}`,
    `Envío: ${data.shipping}`,
    `Total: ${data.total}`,
    '',
    data.trackingUrl
      ? `Rastrear: ${data.trackingUrl}`
      : 'Te notificaremos cuando sea despachado.',
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
