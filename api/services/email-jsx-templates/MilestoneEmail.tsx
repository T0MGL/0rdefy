import * as React from 'react';
import { Button, Hr, Link, Section, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';
import { APP_URL, BRAND } from './brand';

export interface MilestoneStat {
  label: string;
  value: string;
}

export interface MilestoneEmailData {
  firstName: string;
  milestoneValue: number;
  firstOrderDate: string;
  firstOrderTime: string;
  firstOrderAmount: string;
  productCount: number;
  carrierCount: number;
  deliveryRate: number;
  bestDay: string;
  bestDayCount: number;
  marginAccumulated: string;
  shareUrl: string;
  currency: string;
}

const greetingStyle: React.CSSProperties = {
  margin: '0 0 28px',
  fontSize: '22px',
  fontWeight: 700,
  color: BRAND.white,
  lineHeight: 1.3,
};

const labelStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: '13px',
  color: BRAND.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
};

const paragraph: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.65,
};

const bulletLine: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.65,
};

const closingLine: React.CSSProperties = {
  margin: '0',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.65,
};

const signature: React.CSSProperties = {
  margin: '0',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.65,
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: BRAND.primary,
  color: BRAND.bg,
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '14px 32px',
  borderRadius: '8px',
  letterSpacing: '-0.2px',
};

const subtleLink: React.CSSProperties = {
  color: BRAND.textSecondary,
  textDecoration: 'none',
  fontSize: '13px',
};

export function MilestoneEmail(data: MilestoneEmailData) {
  return (
    <BaseLayout
      preheader={`${data.milestoneValue} órdenes, ${data.firstName}. Algunos números crudos del camino.`}
    >
      <Text style={greetingStyle}>
        {data.milestoneValue} órdenes, {data.firstName}.
      </Text>

      <Text style={paragraph}>Esto pasó:</Text>
      <Text style={bulletLine}>
        Tu primera orden entró el {data.firstOrderDate} a las {data.firstOrderTime}.
      </Text>
      <Text style={bulletLine}>Era una compra de {data.firstOrderAmount}.</Text>
      <Text style={{ ...bulletLine, marginBottom: '24px' }}>
        Hoy llegaste a la número {data.milestoneValue}.
      </Text>

      <Text style={paragraph}>En el medio:</Text>
      <Text style={bulletLine}>- {data.productCount} productos diferentes vendidos</Text>
      <Text style={bulletLine}>- {data.carrierCount} carriers usados</Text>
      <Text style={bulletLine}>- {data.deliveryRate}% delivery rate</Text>
      <Text style={bulletLine}>
        - Tu mejor día fue el {data.bestDay} ({data.bestDayCount} órdenes en 24h)
      </Text>
      <Text style={{ ...bulletLine, marginBottom: '24px' }}>
        - Tu margen acumulado: {data.marginAccumulated}
      </Text>

      <Text style={paragraph}>Esto no son solo números.</Text>
      <Text style={paragraph}>
        Es que el sistema funcionó {data.milestoneValue} {data.milestoneValue === 1 ? 'vez' : 'veces'} sin que toques nada.
      </Text>
      <Text style={{ ...closingLine, marginBottom: '24px' }}>
        Y que vos lo estás haciendo bien.
      </Text>

      <Text style={paragraph}>Felicidades.</Text>

      <Text style={{ ...signature, marginBottom: '4px' }}>Gastón</Text>
      <Text style={{ ...signature, color: BRAND.textSecondary, fontSize: '13px' }}>
        Fundador de Ordefy
      </Text>

      <Hr style={{ borderColor: BRAND.divider, margin: '32px 0 24px' }} />

      <Section style={{ textAlign: 'center' }}>
        <Text style={{ ...labelStyle, marginBottom: '12px' }}>
          Compartilo si te dan ganas
        </Text>
        <Button href={data.shareUrl} style={buttonStyle}>
          Compartí este logro
        </Button>
        <Text style={{ margin: '14px 0 0', fontSize: '12px', color: BRAND.textMuted }}>
          <Link href={data.shareUrl} style={subtleLink}>
            Ver mi resumen completo
          </Link>
        </Text>
      </Section>
    </BaseLayout>
  );
}

export function milestoneEmailText(data: MilestoneEmailData): string {
  return [
    `${data.milestoneValue} órdenes, ${data.firstName}.`,
    '',
    'Esto pasó:',
    `Tu primera orden entró el ${data.firstOrderDate} a las ${data.firstOrderTime}.`,
    `Era una compra de ${data.firstOrderAmount}.`,
    `Hoy llegaste a la número ${data.milestoneValue}.`,
    '',
    'En el medio:',
    `- ${data.productCount} productos diferentes vendidos`,
    `- ${data.carrierCount} carriers usados`,
    `- ${data.deliveryRate}% delivery rate`,
    `- Tu mejor día fue el ${data.bestDay} (${data.bestDayCount} órdenes en 24h)`,
    `- Tu margen acumulado: ${data.marginAccumulated}`,
    '',
    'Esto no son solo números.',
    `Es que el sistema funcionó ${data.milestoneValue} ${data.milestoneValue === 1 ? 'vez' : 'veces'} sin que toques nada.`,
    'Y que vos lo estás haciendo bien.',
    '',
    'Felicidades.',
    'Gastón',
    'Fundador de Ordefy',
    '',
    `Compartilo: ${data.shareUrl}`,
    `App: ${APP_URL}`,
  ].join('\n');
}

export function milestoneEmailSubject(data: Pick<MilestoneEmailData, 'firstName' | 'milestoneValue'>): string {
  return `${data.milestoneValue} órdenes, ${data.firstName}.`;
}
