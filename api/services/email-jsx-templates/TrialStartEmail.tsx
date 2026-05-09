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
import { APP_URL, CURRENT_YEAR } from './brand';

export interface TrialStartEmailData {
  userName: string;
  planName: string;
  trialDays: number;
  trialEndsAt: string;
}

export function TrialStartEmail(data: TrialStartEmailData) {
  return (
    <BaseLayout
      preheader={`Tenés ${data.trialDays} días gratis del plan ${data.planName}. Explorá todo lo que Ordefy ofrece.`}
    >
      <Heading>Tu período de prueba comenzó</Heading>
      <SubHeading>{`${data.trialDays} días gratis del plan ${data.planName}.`}</SubHeading>
      <Paragraph>
        {`Hola ${data.userName}, tu prueba gratuita del plan `}
        <strong>{data.planName}</strong>
        {` está activa. Tenés acceso completo a todas las funcionalidades durante ${data.trialDays} días.`}
      </Paragraph>
      <InfoTable
        rows={[
          { label: 'Plan', value: data.planName },
          { label: 'Duración', value: `${data.trialDays} días` },
          { label: 'Finaliza', value: data.trialEndsAt },
        ]}
      />
      <Paragraph>
        Aprovechá este período para configurar tu tienda, conectar
        integraciones y explorar todo lo que Ordefy ofrece.
      </Paragraph>
      <CTAButton href={APP_URL}>Explorar Ordefy</CTAButton>
      <Divider />
      <SmallText>
        No se realizará ningún cobro durante el período de prueba. Te
        avisaremos antes de que termine.
      </SmallText>
    </BaseLayout>
  );
}

export function trialStartEmailSubject(data: TrialStartEmailData): string {
  return `Tu prueba gratuita de ${data.trialDays} días comenzó`;
}

export function trialStartEmailText(data: TrialStartEmailData): string {
  return [
    'Tu período de prueba comenzó',
    '',
    `Hola ${data.userName}, tu prueba del plan ${data.planName} está activa por ${data.trialDays} días.`,
    `Finaliza: ${data.trialEndsAt}`,
    '',
    `Explorar: ${APP_URL}`,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
