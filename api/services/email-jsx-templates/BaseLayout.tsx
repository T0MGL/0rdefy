import * as React from 'react';
import {
  Body,
  Head,
  Html,
  Img,
  Link,
  Preview,
} from '@react-email/components';
import {
  APP_URL,
  BRAND,
  CURRENT_YEAR,
  FONT_STACK,
  LOGO_URL,
  MARKETING_URL,
  SUPPORT_EMAIL,
} from './brand';

interface BaseLayoutProps {
  preheader: string;
  children: React.ReactNode;
  /**
   * When true (default), the standard footer with App / Sitio / Soporte links
   * renders below the card. Disable only for legal-style emails where a
   * minimal footer is required.
   */
  footer?: boolean;
}

const footerLinkStyle: React.CSSProperties = {
  color: BRAND.textMuted,
  textDecoration: 'none',
  fontSize: '12px',
};

const footerSeparatorStyle: React.CSSProperties = {
  color: BRAND.divider,
  fontSize: '12px',
};

/**
 * Bulletproof dark-mode email layout. Uses raw <table> elements with both the
 * legacy `bgcolor` HTML attribute AND inline CSS background-color, because
 * Gmail Android, Outlook, and Yahoo strip CSS-only backgrounds on outer
 * containers and force the client default (white). The bgcolor attribute
 * survives across every major client.
 */
export function BaseLayout({
  preheader,
  children,
  footer = true,
}: BaseLayoutProps) {
  return (
    <Html lang="es">
      <Head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />
      </Head>
      <Preview>{preheader}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: BRAND.bg,
          fontFamily: FONT_STACK,
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* Outer 100% table. bgcolor HTML attr survives Gmail/Yahoo CSS strip. */}
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          bgcolor={BRAND.bg}
          style={{
            backgroundColor: BRAND.bg,
            margin: 0,
            padding: 0,
            borderCollapse: 'collapse',
          }}
        >
          <tbody>
            <tr>
              <td
                bgcolor={BRAND.bg}
                align="center"
                style={{
                  backgroundColor: BRAND.bg,
                  padding: '40px 16px 24px',
                }}
              >
                {/* Container 560px max */}
                <table
                  role="presentation"
                  width="560"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  bgcolor={BRAND.bg}
                  style={{
                    backgroundColor: BRAND.bg,
                    width: '100%',
                    maxWidth: '560px',
                    borderCollapse: 'collapse',
                  }}
                >
                  <tbody>
                    {/* Logo header */}
                    <tr>
                      <td
                        bgcolor={BRAND.bg}
                        align="center"
                        style={{
                          backgroundColor: BRAND.bg,
                          padding: '0 0 32px',
                        }}
                      >
                        <Link href={APP_URL}>
                          <Img
                            src={LOGO_URL}
                            alt="Ordefy"
                            width={140}
                            height={40}
                            style={{
                              display: 'inline-block',
                              maxWidth: '140px',
                              height: 'auto',
                              border: 0,
                              outline: 'none',
                              textDecoration: 'none',
                            }}
                          />
                        </Link>
                      </td>
                    </tr>

                    {/* Main card */}
                    <tr>
                      <td
                        bgcolor={BRAND.card}
                        style={{
                          backgroundColor: BRAND.card,
                          border: `1px solid ${BRAND.cardBorder}`,
                          borderRadius: '12px',
                          padding: '40px 36px',
                        }}
                      >
                        {children}
                      </td>
                    </tr>

                    {/* Footer */}
                    {footer ? (
                      <>
                        <tr>
                          <td
                            bgcolor={BRAND.bg}
                            align="center"
                            style={{
                              backgroundColor: BRAND.bg,
                              padding: '28px 0 12px',
                            }}
                          >
                            <table
                              role="presentation"
                              cellPadding={0}
                              cellSpacing={0}
                              border={0}
                            >
                              <tbody>
                                <tr>
                                  <td style={{ padding: '0 12px' }}>
                                    <Link href={APP_URL} style={footerLinkStyle}>
                                      App
                                    </Link>
                                  </td>
                                  <td style={footerSeparatorStyle}>|</td>
                                  <td style={{ padding: '0 12px' }}>
                                    <Link
                                      href={MARKETING_URL}
                                      style={footerLinkStyle}
                                    >
                                      Sitio web
                                    </Link>
                                  </td>
                                  <td style={footerSeparatorStyle}>|</td>
                                  <td style={{ padding: '0 12px' }}>
                                    <Link
                                      href={`mailto:${SUPPORT_EMAIL}`}
                                      style={footerLinkStyle}
                                    >
                                      Soporte
                                    </Link>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td
                            bgcolor={BRAND.bg}
                            align="center"
                            style={{
                              backgroundColor: BRAND.bg,
                              padding: '0 0 8px',
                              fontSize: '11px',
                              color: BRAND.textMuted,
                              lineHeight: 1.5,
                            }}
                          >
                            &copy; {CURRENT_YEAR} Ordefy. Todos los derechos
                            reservados.
                          </td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td
                          bgcolor={BRAND.bg}
                          align="center"
                          style={{
                            backgroundColor: BRAND.bg,
                            padding: '28px 0 8px',
                            fontSize: '11px',
                            color: BRAND.textMuted,
                            lineHeight: 1.5,
                          }}
                        >
                          &copy; {CURRENT_YEAR} Ordefy
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}
