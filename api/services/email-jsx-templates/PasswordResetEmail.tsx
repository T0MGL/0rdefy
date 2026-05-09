import * as React from 'react';
import { BaseLayout } from './BaseLayout';
import {
  CTAButton,
  Divider,
  Heading,
  Paragraph,
  SmallText,
  SubHeading,
} from './components';
import { CURRENT_YEAR } from './brand';

export interface PasswordResetEmailData {
  userName: string;
  resetLink: string;
  expiresInMinutes: number;
}

export function PasswordResetEmail(data: PasswordResetEmailData) {
  return (
    <BaseLayout preheader="Solicitud de cambio de contraseña para tu cuenta Ordefy.">
      <Heading>Restablecer contraseña</Heading>
      <SubHeading>
        Recibimos una solicitud para cambiar tu contraseña.
      </SubHeading>
      <Paragraph>
        {`Hola ${data.userName}, hacé clic en el botón para crear una nueva contraseña. Si no solicitaste este cambio, podés ignorar este correo.`}
      </Paragraph>
      <CTAButton href={data.resetLink}>Restablecer contraseña</CTAButton>
      <Divider />
      <SmallText>
        {`Este enlace expira en ${data.expiresInMinutes} minutos. Por seguridad, no compartas este enlace con nadie.`}
      </SmallText>
    </BaseLayout>
  );
}

export function passwordResetEmailSubject(): string {
  return 'Restablecer contraseña en Ordefy';
}

export function passwordResetEmailText(data: PasswordResetEmailData): string {
  return [
    'Restablecer contraseña',
    '',
    `Hola ${data.userName}, hacé clic para crear una nueva contraseña:`,
    data.resetLink,
    '',
    `Expira en ${data.expiresInMinutes} minutos.`,
    'Si no solicitaste esto, ignorá este correo.',
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
