import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
} from '@react-email/components';
import { APP_URL, BRAND, CURRENT_YEAR, LOGO_URL } from './brand';

interface BaseLayoutProps {
  preheader: string;
  children: React.ReactNode;
}

const main: React.CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: BRAND.bg,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  WebkitFontSmoothing: 'antialiased',
};

const wrapper: React.CSSProperties = {
  backgroundColor: BRAND.bg,
  padding: '40px 16px 20px',
};

const container: React.CSSProperties = {
  maxWidth: '560px',
  width: '100%',
  margin: '0 auto',
};

const headerCell: React.CSSProperties = {
  textAlign: 'center',
  padding: '0 0 32px',
};

const card: React.CSSProperties = {
  backgroundColor: BRAND.card,
  border: `1px solid ${BRAND.cardBorder}`,
  borderRadius: '12px',
};

const contentCell: React.CSSProperties = {
  padding: '40px 36px',
};

const footerCell: React.CSSProperties = {
  padding: '28px 0 0',
  textAlign: 'center',
};

const footerLink: React.CSSProperties = {
  color: BRAND.textMuted,
  textDecoration: 'none',
  fontSize: '12px',
  margin: '0 12px',
};

const copyright: React.CSSProperties = {
  fontSize: '11px',
  color: BRAND.textMuted,
  lineHeight: 1.5,
  padding: '12px 0 8px',
};

export function BaseLayout({ preheader, children }: BaseLayoutProps) {
  return (
    <Html lang="es">
      <Head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
      </Head>
      <Preview>{preheader}</Preview>
      <Body style={main}>
        <Section style={wrapper}>
          <Container style={container}>
            <Section style={headerCell}>
              <Link href={APP_URL}>
                <Img
                  src={LOGO_URL}
                  alt="Ordefy"
                  width={140}
                  style={{ display: 'inline-block', maxWidth: '140px', height: 'auto' }}
                />
              </Link>
            </Section>

            <Section style={card}>
              <Section style={contentCell}>{children}</Section>
            </Section>

            <Section style={footerCell}>
              <Link href={APP_URL} style={footerLink}>
                App
              </Link>
              <span style={{ color: BRAND.divider, fontSize: '12px' }}>|</span>
              <Link href="https://ordefy.io" style={footerLink}>
                Sitio web
              </Link>
              <span style={{ color: BRAND.divider, fontSize: '12px' }}>|</span>
              <Link href="mailto:soporte@ordefy.io" style={footerLink}>
                Soporte
              </Link>
              <Hr style={{ border: 'none', margin: '12px 0 0' }} />
              <div style={copyright}>&copy; {CURRENT_YEAR} Ordefy</div>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
