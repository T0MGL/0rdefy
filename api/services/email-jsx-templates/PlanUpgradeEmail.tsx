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
import { APP_URL, BRAND, CURRENT_YEAR } from './brand';

export interface PlanUpgradeEmailData {
  userName: string;
  previousPlan: string;
  newPlan: string;
  amount: string;
  billingCycle: string;
  nextBillingDate: string;
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: BRAND.primary,
  color: BRAND.ctaText,
  fontSize: '11px',
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginLeft: '8px',
};

export function PlanUpgradeEmail(data: PlanUpgradeEmailData) {
  return (
    <BaseLayout
      preheader={`Tu plan fue actualizado a ${data.newPlan}. Accedé a todas las nuevas funcionalidades.`}
    >
      <Heading>Plan actualizado</Heading>
      <SubHeading>{`Cambiaste a ${data.newPlan}. Ya tenés acceso a todas las nuevas funcionalidades.`}</SubHeading>
      <Paragraph>
        {`Hola ${data.userName}, tu suscripción fue actualizada exitosamente.`}
      </Paragraph>
      <InfoTable
        rows={[
          { label: 'Plan anterior', value: data.previousPlan },
          {
            label: 'Nuevo plan',
            value: (
              <>
                {data.newPlan}
                <span style={badgeStyle}>{data.newPlan}</span>
              </>
            ),
          },
          { label: 'Monto', value: data.amount },
          { label: 'Ciclo', value: data.billingCycle },
          { label: 'Próximo cobro', value: data.nextBillingDate },
        ]}
      />
      <CTAButton href={APP_URL}>Ir a mi tienda</CTAButton>
      <Divider />
      <SmallText>
        Podés gestionar tu suscripción en cualquier momento desde
        Configuración &gt; Facturación.
      </SmallText>
    </BaseLayout>
  );
}

export function planUpgradeEmailSubject(data: PlanUpgradeEmailData): string {
  return `Plan actualizado a ${data.newPlan}`;
}

export function planUpgradeEmailText(data: PlanUpgradeEmailData): string {
  return [
    'Plan actualizado',
    '',
    `Hola ${data.userName}, tu plan fue actualizado de ${data.previousPlan} a ${data.newPlan}.`,
    `Monto: ${data.amount} (${data.billingCycle})`,
    `Próximo cobro: ${data.nextBillingDate}`,
    '',
    APP_URL,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
