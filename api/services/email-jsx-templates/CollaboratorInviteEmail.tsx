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

export interface CollaboratorInviteEmailData {
  inviteeName: string;
  inviterName: string;
  storeName: string;
  role: string;
  inviteLink: string;
  expiresAt: Date;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  logistics: 'Logística',
  confirmador: 'Confirmador',
  contador: 'Contador',
  inventario: 'Inventario',
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] || role;
}

function formatExpiry(d: Date): string {
  return d.toLocaleDateString('es-PY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function CollaboratorInviteEmail(data: CollaboratorInviteEmailData) {
  const roleLabel = formatRole(data.role);
  const expiresFormatted = formatExpiry(data.expiresAt);

  return (
    <BaseLayout
      preheader={`Fuiste invitado como ${roleLabel} en "${data.storeName}". Aceptá la invitación.`}
    >
      <Heading>Te invitaron al equipo</Heading>
      <SubHeading>{`${data.inviterName} quiere que te unas a "${data.storeName}".`}</SubHeading>
      <Paragraph>
        {`Hola ${data.inviteeName}, fuiste invitado a colaborar en la tienda `}
        <strong>{data.storeName}</strong>
        {' en Ordefy.'}
      </Paragraph>
      <InfoTable
        rows={[
          { label: 'Tienda', value: data.storeName },
          { label: 'Rol', value: roleLabel },
          { label: 'Invitado por', value: data.inviterName },
        ]}
      />
      <CTAButton href={data.inviteLink}>Aceptar invitación</CTAButton>
      <Divider />
      <SmallText>
        {`Esta invitación expira el ${expiresFormatted}. Si no esperabas esta invitación, ignorá este correo.`}
      </SmallText>
    </BaseLayout>
  );
}

export function collaboratorInviteEmailSubject(
  data: CollaboratorInviteEmailData,
): string {
  return `${data.inviterName} te invitó a ${data.storeName} en Ordefy`;
}

export function collaboratorInviteEmailText(
  data: CollaboratorInviteEmailData,
): string {
  const roleLabel = formatRole(data.role);
  const expiresFormatted = formatExpiry(data.expiresAt);

  return [
    'Te invitaron al equipo',
    '',
    `Hola ${data.inviteeName},`,
    '',
    `${data.inviterName} te invitó a colaborar en "${data.storeName}" como ${roleLabel}.`,
    '',
    `Aceptá acá: ${data.inviteLink}`,
    '',
    `Expira el ${expiresFormatted}.`,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
