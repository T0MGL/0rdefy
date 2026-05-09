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

export interface EmailVerificationEmailData {
  userName: string;
  verificationLink: string;
  expiresInMinutes: number;
}

export function EmailVerificationEmail(data: EmailVerificationEmailData) {
  return (
    <BaseLayout preheader="Confirmá tu correo para activar tu cuenta en Ordefy.">
      <Heading>Verificá tu correo electrónico</Heading>
      <SubHeading>Un paso más para activar tu cuenta.</SubHeading>
      <Paragraph>
        {`Hola ${data.userName}, confirmá tu dirección de correo haciendo clic en el botón de abajo.`}
      </Paragraph>
      <CTAButton href={data.verificationLink}>Verificar correo</CTAButton>
      <Divider />
      <SmallText>
        {`Este enlace expira en ${data.expiresInMinutes} minutos. Si no creaste una cuenta en Ordefy, ignorá este mensaje.`}
      </SmallText>
    </BaseLayout>
  );
}

export function emailVerificationEmailSubject(): string {
  return 'Verificá tu correo en Ordefy';
}

export function emailVerificationEmailText(data: EmailVerificationEmailData): string {
  return [
    'Verificá tu correo electrónico',
    '',
    `Hola ${data.userName}, confirmá tu dirección de correo:`,
    data.verificationLink,
    '',
    `Este enlace expira en ${data.expiresInMinutes} minutos.`,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
