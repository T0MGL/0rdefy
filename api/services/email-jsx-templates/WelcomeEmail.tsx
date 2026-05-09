import * as React from 'react';
import { BaseLayout } from './BaseLayout';
import {
  CTAButton,
  Divider,
  Heading,
  Paragraph,
  SmallText,
  StepsList,
  SubHeading,
} from './components';
import { APP_URL, CURRENT_YEAR, SUPPORT_EMAIL } from './brand';

export interface WelcomeEmailData {
  userName: string;
  storeName: string;
}

export function WelcomeEmail(data: WelcomeEmailData) {
  return (
    <BaseLayout
      preheader={`Tu tienda "${data.storeName}" está lista. Empezá a gestionar pedidos hoy.`}
    >
      <Heading>{`Te damos la bienvenida a Ordefy, ${data.userName}`}</Heading>
      <SubHeading>{`Tu tienda "${data.storeName}" está lista para operar.`}</SubHeading>
      <Paragraph>
        Ordefy es la plataforma que centraliza pedidos, inventario, envíos y
        facturación para que puedas escalar tu e-commerce sin perder el
        control.
      </Paragraph>
      <StepsList
        steps={[
          'Configurá tu primera transportadora para habilitar envíos',
          'Agregá productos manualmente o conectá tu tienda Shopify',
          'Creá tu primer pedido y generá una guía de envío',
        ]}
      />
      <CTAButton href={APP_URL}>Ir a mi tienda</CTAButton>
      <Divider />
      <SmallText>
        {`Si necesitás ayuda en cualquier momento, respondé a este correo o escribí a ${SUPPORT_EMAIL}.`}
      </SmallText>
    </BaseLayout>
  );
}

export function welcomeEmailSubject(data: WelcomeEmailData): string {
  return `Te damos la bienvenida a Ordefy, ${data.userName}`;
}

export function welcomeEmailText(data: WelcomeEmailData): string {
  return [
    `Te damos la bienvenida a Ordefy, ${data.userName}`,
    '',
    `Tu tienda "${data.storeName}" está lista para operar.`,
    '',
    'Ordefy centraliza pedidos, inventario, envíos y facturación para escalar tu e-commerce.',
    '',
    'Primeros pasos:',
    '1. Configurá tu primera transportadora',
    '2. Agregá productos o conectá Shopify',
    '3. Creá tu primer pedido',
    '',
    `Ir a tu tienda: ${APP_URL}`,
    '',
    `Soporte: ${SUPPORT_EMAIL}`,
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ].join('\n');
}
