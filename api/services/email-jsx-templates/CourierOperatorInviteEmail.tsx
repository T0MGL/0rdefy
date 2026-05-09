import * as React from 'react';
import { BaseLayout } from './BaseLayout';
import {
  CTAButton,
  Divider,
  Heading,
  InfoTable,
  Paragraph,
  SmallText,
  SubHeading,
} from './components';
import { CURRENT_YEAR } from './brand';

export interface CourierOperatorInviteEmailData {
  inviteeName: string;
  inviterName: string;
  storeName: string;
  carrierName: string;
  inviteLink: string;
  expiresAt: Date;
}

function formatExpiry(d: Date): string {
  return d.toLocaleDateString('es-PY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function CourierOperatorInviteEmail(
  data: CourierOperatorInviteEmailData,
) {
  const expiresFormatted = formatExpiry(data.expiresAt);

  return (
    <BaseLayout
      preheader={`${data.inviterName} te invitó a operar la flota de ${data.carrierName} en ${data.storeName}.`}
    >
      <Heading>Te invitaron a operar entregas</Heading>
      <SubHeading>{`${data.storeName} quiere que operes la flota de ${data.carrierName}.`}</SubHeading>
      <Paragraph>
        {`Hola ${data.inviteeName}, ${data.inviterName} de `}
        <strong>{data.storeName}</strong>
        {' te invita a usar el portal de couriers de Ordefy para gestionar las entregas asignadas a '}
        <strong>{data.carrierName}</strong>
        {'.'}
      </Paragraph>
      <Paragraph>
        Vas a poder ver los pedidos asignados, marcarlos como entregados, no
        entregados o devueltos, reportar incidencias y consultar tu balance
        financiero en tiempo real. Todo desde el celular, sin WhatsApp.
      </Paragraph>
      <InfoTable
        rows={[
          { label: 'Tienda', value: data.storeName },
          { label: 'Courier', value: data.carrierName },
          { label: 'Rol', value: 'Operador de courier' },
          { label: 'Invitado por', value: data.inviterName },
        ]}
      />
      <CTAButton href={data.inviteLink}>Aceptar y crear cuenta</CTAButton>
      <Divider />
      <SmallText>
        {`Esta invitación expira el ${expiresFormatted}. Si no esperabas este correo, ignoralo. El link es de un solo uso.`}
      </SmallText>
    </BaseLayout>
  );
}

export function courierOperatorInviteEmailSubject(
  data: CourierOperatorInviteEmailData,
): string {
  return `Te invitaron a operar entregas para ${data.carrierName}`;
}

export function courierOperatorInviteEmailText(
  data: CourierOperatorInviteEmailData,
): string {
  const expiresFormatted = formatExpiry(data.expiresAt);

  return [
    'Te invitaron a operar entregas',
    '',
    `Hola ${data.inviteeName},`,
    '',
    `${data.inviterName} de "${data.storeName}" te invita a operar la flota de ${data.carrierName} usando el portal de couriers de Ordefy.`,
    '',
    'Vas a gestionar pedidos asignados, marcar entregas y ver tu balance financiero en tiempo real.',
    '',
    `Aceptar invitación: ${data.inviteLink}`,
    '',
    `Expira el ${expiresFormatted}.`,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
