import * as React from 'react';
import { Button, Hr, Img, Link, Section, Text } from '@react-email/components';
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
  /** Total days from first order to this milestone (used for chart caption) */
  daysElapsed?: number;
  /** Public URL of the hero PNG (Supabase storage). Optional. */
  heroImageUrl?: string;
  /** Public URL of the chart PNG (Supabase storage). Optional. */
  chartImageUrl?: string;
}

const greetingStyle: React.CSSProperties = {
  margin: '4px 0 28px',
  fontSize: '26px',
  fontWeight: 700,
  color: BRAND.white,
  lineHeight: 1.25,
  letterSpacing: '-0.3px',
};

const introLine: React.CSSProperties = {
  margin: '0 0 18px',
  fontSize: '11px',
  color: BRAND.textMuted,
  lineHeight: 1.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '1.6px',
};

const factLine: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.65,
};

const factLineLast: React.CSSProperties = {
  margin: '0',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.65,
  fontWeight: 600,
};

const paragraph: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.7,
};

const sectionLabel: React.CSSProperties = {
  margin: '0 0 18px',
  fontSize: '11px',
  color: BRAND.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '1.6px',
  fontWeight: 700,
};

const closingBlock: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: '16px',
  color: BRAND.text,
  lineHeight: 1.7,
};

const closingFinal: React.CSSProperties = {
  margin: '0 0 28px',
  fontSize: '16px',
  color: BRAND.white,
  lineHeight: 1.7,
  fontWeight: 600,
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: BRAND.primary,
  color: BRAND.bg,
  fontSize: '15px',
  fontWeight: 700,
  textDecoration: 'none',
  padding: '16px 36px',
  borderRadius: '10px',
  letterSpacing: '-0.2px',
};

const subtleLink: React.CSSProperties = {
  color: BRAND.textSecondary,
  textDecoration: 'underline',
  fontSize: '13px',
};

const heroWrap: React.CSSProperties = {
  margin: '0 0 30px',
  borderRadius: '12px',
  overflow: 'hidden',
  border: `1px solid ${BRAND.cardBorder}`,
  lineHeight: 0,
};

const chartWrap: React.CSSProperties = {
  margin: '24px 0 6px',
  borderRadius: '10px',
  overflow: 'hidden',
  backgroundColor: BRAND.bg,
  border: `1px solid ${BRAND.cardBorder}`,
  lineHeight: 0,
};

const chartCaption: React.CSSProperties = {
  margin: '0 0 28px',
  fontSize: '12px',
  color: BRAND.textMuted,
  textAlign: 'center',
  fontStyle: 'italic',
  letterSpacing: '0.2px',
};

/* Stats grid: rendered as nested table for max email-client compatibility.
 * react-email components abstract this into <Section><Row><Column>, but
 * rendering raw <table> here gives us tighter control on Outlook/Gmail.
 */
function StatsGrid({ stats }: { stats: MilestoneStat[] }) {
  // 2 rows x 2 cols (capped at 4 stats — keeps the visual rhythm tight)
  const grid = stats.slice(0, 4);
  const rows: MilestoneStat[][] = [];
  for (let i = 0; i < grid.length; i += 2) {
    rows.push(grid.slice(i, i + 2));
  }

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={{
        margin: '0 0 12px',
        borderCollapse: 'separate',
        borderSpacing: '10px',
      }}
    >
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((stat, j) => (
              <td
                key={j}
                width="50%"
                style={{
                  width: '50%',
                  backgroundColor: BRAND.bg,
                  border: `1px solid ${BRAND.cardBorder}`,
                  borderRadius: '12px',
                  padding: '22px 20px 20px',
                  verticalAlign: 'top',
                }}
              >
                <div
                  style={{
                    fontSize: '30px',
                    fontWeight: 800,
                    color: BRAND.primary,
                    lineHeight: 1.05,
                    letterSpacing: '-0.6px',
                    marginBottom: '10px',
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: BRAND.textSecondary,
                    lineHeight: 1.45,
                    letterSpacing: '0.1px',
                  }}
                >
                  {stat.label}
                </div>
              </td>
            ))}
            {row.length === 1 ? <td width="50%" style={{ width: '50%' }} /> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* Highlight card: full-width feature stat below the grid (used for margen
 * acumulado — the headline number that earns its own row). */
function FeatureStat({ value, label }: { value: string; label: string }) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={{
        margin: '12px 0 0',
        borderCollapse: 'separate',
      }}
    >
      <tbody>
        <tr>
          <td
            style={{
              backgroundColor: BRAND.bg,
              border: `1px solid ${BRAND.cardBorder}`,
              borderRadius: '12px',
              padding: '24px 24px 22px',
              verticalAlign: 'middle',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: BRAND.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '1.6px',
                fontWeight: 700,
                marginBottom: '10px',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: '34px',
                fontWeight: 800,
                color: BRAND.primary,
                lineHeight: 1.05,
                letterSpacing: '-0.8px',
              }}
            >
              {value}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function MilestoneEmail(data: MilestoneEmailData) {
  const stats: MilestoneStat[] = [
    { value: String(data.productCount), label: 'productos diferentes vendidos' },
    { value: String(data.carrierCount), label: 'carriers usados' },
    { value: `${data.deliveryRate}%`, label: 'delivery rate' },
    {
      value: String(data.bestDayCount),
      label: `órdenes en 24h · ${data.bestDay}`,
    },
  ];

  return (
    <BaseLayout
      preheader={`El sistema funcionó ${data.milestoneValue} ${data.milestoneValue === 1 ? 'vez' : 'veces'} sin que toques nada. Estos son los números.`}
    >
      {/* Hero image (URL-hosted) */}
      {data.heroImageUrl ? (
        <Section style={heroWrap}>
          <Img
            src={data.heroImageUrl}
            alt={`${data.milestoneValue} órdenes`}
            width={560}
            style={{
              display: 'block',
              width: '100%',
              maxWidth: '560px',
              height: 'auto',
            }}
          />
        </Section>
      ) : null}

      <Text style={introLine}>Esto pasó</Text>

      <Text style={factLine}>
        Tu primera orden entró el {data.firstOrderDate} a las {data.firstOrderTime}.
      </Text>
      <Text style={factLine}>
        Era una compra de {data.firstOrderAmount}.
      </Text>
      <Text style={factLineLast}>
        Hoy llegaste a la número {data.milestoneValue}.
      </Text>

      <Hr style={{ borderColor: BRAND.divider, margin: '34px 0 26px' }} />

      <Text style={sectionLabel}>En el medio</Text>

      <StatsGrid stats={stats} />

      <FeatureStat
        value={data.marginAccumulated}
        label="margen acumulado"
      />

      {/* Mini chart with timeline caption */}
      {data.chartImageUrl ? (
        <>
          <Section style={chartWrap}>
            <Img
              src={data.chartImageUrl}
              alt={`${data.milestoneValue} órdenes en el tiempo`}
              width={560}
              style={{
                display: 'block',
                width: '100%',
                maxWidth: '560px',
                height: 'auto',
              }}
            />
          </Section>
          <Text style={chartCaption}>
            {data.daysElapsed
              ? `${data.milestoneValue} órdenes en ${data.daysElapsed} días, desde el ${data.firstOrderDate}.`
              : `Desde tu primera orden el ${data.firstOrderDate}.`}
          </Text>
        </>
      ) : null}

      <Hr style={{ borderColor: BRAND.divider, margin: '20px 0 32px' }} />

      <Text style={closingBlock}>Esto no son solo números.</Text>

      <Text style={closingBlock}>
        Es que el sistema funcionó {data.milestoneValue}{' '}
        {data.milestoneValue === 1 ? 'vez' : 'veces'} sin que toques nada.
      </Text>

      <Text style={closingFinal}>Y que vos lo estás haciendo bien.</Text>

      <Text
        style={{
          margin: '0 0 26px',
          fontSize: '16px',
          color: BRAND.text,
          lineHeight: 1.5,
        }}
      >
        Felicidades.
      </Text>

      <Text
        style={{
          margin: '0 0 2px',
          fontSize: '15px',
          color: BRAND.text,
          lineHeight: 1.5,
          fontWeight: 600,
        }}
      >
        Gastón
      </Text>
      <Text
        style={{
          margin: '0',
          fontSize: '13px',
          color: BRAND.textSecondary,
          lineHeight: 1.5,
        }}
      >
        Fundador de Ordefy
      </Text>

      <Hr style={{ borderColor: BRAND.divider, margin: '38px 0 28px' }} />

      <Section style={{ textAlign: 'center' }}>
        <Text
          style={{
            margin: '0 0 16px',
            fontSize: '11px',
            color: BRAND.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '1.6px',
            fontWeight: 700,
          }}
        >
          Mostralo si te dan ganas
        </Text>
        <Button href={data.shareUrl} style={buttonStyle}>
          Compartí este logro
        </Button>
        <Text style={{ margin: '16px 0 0', fontSize: '12px', color: BRAND.textMuted }}>
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

export function milestoneEmailSubject(
  data: Pick<MilestoneEmailData, 'firstName' | 'milestoneValue'>,
): string {
  return `${data.milestoneValue} órdenes, ${data.firstName}.`;
}
