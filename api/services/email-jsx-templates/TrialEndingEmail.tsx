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
import { APP_URL, CURRENT_YEAR } from './brand';

export interface TrialEndingEmailData {
  userName: string;
  planName: string;
  daysRemaining: number;
  upgradeLink: string;
}

export function TrialEndingEmail(data: TrialEndingEmailData) {
  const urgency =
    data.daysRemaining <= 1 ? 'Último día' : `${data.daysRemaining} días restantes`;
  const dayWord = data.daysRemaining === 1 ? 'día' : 'días';

  return (
    <BaseLayout
      preheader={`Quedan ${data.daysRemaining} días de tu prueba del plan ${data.planName}. Activá tu suscripción.`}
    >
      <Heading>Tu prueba está por terminar</Heading>
      <SubHeading>{`${urgency} del plan ${data.planName}.`}</SubHeading>
      <Paragraph>
        {`Hola ${data.userName}, tu período de prueba gratuito finaliza en `}
        <strong>{`${data.daysRemaining} ${dayWord}`}</strong>
        {'. Para seguir usando todas las funcionalidades, activá tu suscripción.'}
      </Paragraph>
      <Paragraph>
        Al activar tu plan conservás toda tu configuración, datos de pedidos,
        productos y equipo intactos.
      </Paragraph>
      <CTAButton href={data.upgradeLink}>Activar plan</CTAButton>
      <CTAButton href={`${APP_URL}/billing`} variant="secondary">
        Comparar planes
      </CTAButton>
      <Divider />
      <SmallText>
        Si decidís no continuar, tu cuenta pasará al plan gratuito con
        funcionalidades limitadas. Tus datos se conservan.
      </SmallText>
    </BaseLayout>
  );
}

export function trialEndingEmailSubject(data: TrialEndingEmailData): string {
  const dayWord = data.daysRemaining === 1 ? 'día' : 'días';
  return `Tu prueba gratuita termina en ${data.daysRemaining} ${dayWord}`;
}

export function trialEndingEmailText(data: TrialEndingEmailData): string {
  return [
    'Tu prueba está por terminar',
    '',
    `Hola ${data.userName}, quedan ${data.daysRemaining} días de tu prueba del plan ${data.planName}.`,
    '',
    `Activar: ${data.upgradeLink}`,
    `Comparar planes: ${APP_URL}/billing`,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
