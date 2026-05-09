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
import { APP_URL, CURRENT_YEAR, SUPPORT_EMAIL } from './brand';

export interface PlanCancellationEmailData {
  userName: string;
  currentPlan: string;
  effectiveDate: string;
  reason?: string;
}

export function PlanCancellationEmail(data: PlanCancellationEmailData) {
  return (
    <BaseLayout
      preheader={`Tu plan ${data.currentPlan} fue cancelado. Permanece activo hasta ${data.effectiveDate}.`}
    >
      <Heading>Suscripción cancelada</Heading>
      <SubHeading>
        Tu plan permanece activo hasta el final del período facturado.
      </SubHeading>
      <Paragraph>
        {`Hola ${data.userName}, confirmamos la cancelación de tu plan `}
        <strong>{data.currentPlan}</strong>
        {'.'}
      </Paragraph>
      <InfoTable
        rows={[
          { label: 'Plan', value: data.currentPlan },
          { label: 'Activo hasta', value: data.effectiveDate },
        ]}
      />
      <Paragraph>
        Tu cuenta y datos se mantienen disponibles. Podés reactivar tu plan en
        cualquier momento desde la sección de facturación.
      </Paragraph>
      <CTAButton href={`${APP_URL}/billing`}>Reactivar plan</CTAButton>
      <Divider />
      <SmallText>
        {`Si tenés preguntas o comentarios, escribí a ${SUPPORT_EMAIL}. Valoramos tu feedback.`}
      </SmallText>
    </BaseLayout>
  );
}

export function planCancellationEmailSubject(): string {
  return 'Confirmación de cancelación de plan';
}

export function planCancellationEmailText(
  data: PlanCancellationEmailData,
): string {
  return [
    'Suscripción cancelada',
    '',
    `Hola ${data.userName}, tu plan ${data.currentPlan} fue cancelado.`,
    `Activo hasta: ${data.effectiveDate}`,
    '',
    `Reactivar: ${APP_URL}/billing`,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
