import * as React from 'react';
import {
  Body,
  Head,
  Html,
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
   * When true (default), the standard footer with App / Sitio / Soporte
   * links renders below the card. Disable only for legal-style emails
   * where a minimal footer is required.
   */
  footer?: boolean;
}

/**
 * Hybrid light + dark CSS strategy.
 *
 * Inline element styles in BaseLayout and components.tsx default to the
 * LIGHT palette: premium off-white surface, near-black headings, lime CTA.
 * That is what Gmail mobile (web + native iOS) and Yahoo render, since
 * those clients ignore @media queries and strip <picture><source>.
 *
 * The block below layers a dark palette on top via three vectors:
 *
 *   1. `prefers-color-scheme: dark` -- honored by Apple Mail iOS / macOS,
 *      Outlook on the web, Samsung Mail. Repaints the canvas, card,
 *      headings, body text and divider to the dark tokens. The CTA
 *      button stays lime in both modes (lime reads well on #09090b).
 *
 *   2. `[data-ogsc]` / `[data-ogsb]` -- Outlook.com and Outlook for Android
 *      wrap the body in a div carrying these data attributes when their
 *      dark renderer is active. Targeting them with !important repaints
 *      the surfaces back to brand instead of letting Outlook's algorithmic
 *      transform pick muted greys for us.
 *
 *   3. Gmail Android still applies its own algorithmic transform that no
 *      CSS hook defeats. The light tokens are designed to survive that
 *      transform without losing legibility (mid-tone bg, near-black
 *      headings, ample contrast).
 *
 * Anti-patterns explicitly avoided:
 *   - `color-scheme: dark only` meta. Forces dark even on clients that
 *     would otherwise render light correctly. Caused the previous
 *     iteration's white-on-white Gmail iOS rendering bug.
 *   - `prefers-color-scheme: light` block that re-paints to dark. Anti
 *     pattern; clients that opt into light should get light.
 *   - Dark-baked logo PNG. The transparent solid-lime wordmark works on
 *     both surfaces, so a single asset covers both modes.
 */
const HYBRID_CSS = `
  body, table, td {
    -webkit-text-size-adjust: 100%;
    -ms-text-size-adjust: 100%;
  }

  a.ord-cta-anchor {
    background-color: ${BRAND.primary} !important;
    color: ${BRAND.ctaText} !important;
  }

  @media (prefers-color-scheme: dark) {
    body, .ord-bg {
      background-color: ${BRAND.dark.bg} !important;
      color: ${BRAND.dark.body} !important;
    }
    .ord-card {
      background-color: ${BRAND.dark.card} !important;
      border-color: ${BRAND.dark.cardBorder} !important;
    }
    .ord-heading { color: ${BRAND.dark.heading} !important; }
    .ord-body { color: ${BRAND.dark.body} !important; }
    .ord-secondary { color: ${BRAND.dark.secondary} !important; }
    .ord-muted { color: ${BRAND.dark.muted} !important; }
    .ord-divider {
      border-color: ${BRAND.dark.divider} !important;
      background-color: ${BRAND.dark.divider} !important;
    }
    .ord-panel {
      background-color: ${BRAND.dark.panel} !important;
    }
    .ord-row-border {
      border-color: ${BRAND.dark.divider} !important;
    }
    .ord-step-text { color: ${BRAND.dark.body} !important; }
  }

  [data-ogsc] body, [data-ogsb] body,
  [data-ogsc] .ord-bg, [data-ogsb] .ord-bg {
    background-color: ${BRAND.dark.bg} !important;
    color: ${BRAND.dark.body} !important;
  }
  [data-ogsc] .ord-card, [data-ogsb] .ord-card {
    background-color: ${BRAND.dark.card} !important;
    border-color: ${BRAND.dark.cardBorder} !important;
  }
  [data-ogsc] .ord-heading, [data-ogsb] .ord-heading {
    color: ${BRAND.dark.heading} !important;
  }
  [data-ogsc] .ord-body, [data-ogsb] .ord-body {
    color: ${BRAND.dark.body} !important;
  }
  [data-ogsc] .ord-secondary, [data-ogsb] .ord-secondary {
    color: ${BRAND.dark.secondary} !important;
  }
  [data-ogsc] .ord-muted, [data-ogsb] .ord-muted {
    color: ${BRAND.dark.muted} !important;
  }
  [data-ogsc] .ord-panel, [data-ogsb] .ord-panel {
    background-color: ${BRAND.dark.panel} !important;
  }
  [data-ogsc] a.ord-cta-anchor, [data-ogsb] a.ord-cta-anchor {
    background-color: ${BRAND.primary} !important;
    color: ${BRAND.ctaText} !important;
  }
`;

const footerLinkStyle: React.CSSProperties = {
  color: BRAND.light.muted,
  textDecoration: 'none',
  fontSize: '12px',
};

const footerSeparatorStyle: React.CSSProperties = {
  color: BRAND.light.divider,
  fontSize: '12px',
};

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
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{HYBRID_CSS}</style>
      </Head>
      <Preview>{preheader}</Preview>
      <Body
        className="ord-bg ord-body"
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: BRAND.light.bg,
          color: BRAND.light.body,
          fontFamily: FONT_STACK,
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          bgcolor={BRAND.light.bg}
          className="ord-bg"
          style={{
            backgroundColor: BRAND.light.bg,
            margin: 0,
            padding: 0,
            borderCollapse: 'collapse',
          }}
        >
          <tbody>
            <tr>
              <td
                bgcolor={BRAND.light.bg}
                align="center"
                className="ord-bg"
                style={{
                  backgroundColor: BRAND.light.bg,
                  padding: '40px 16px 24px',
                }}
              >
                <table
                  role="presentation"
                  width="560"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  className="ord-bg"
                  style={{
                    width: '100%',
                    maxWidth: '560px',
                    borderCollapse: 'collapse',
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        align="center"
                        className="ord-bg"
                        style={{
                          padding: '0 0 32px',
                        }}
                      >
                        <Link href={APP_URL}>
                          <img
                            src={LOGO_URL}
                            alt="Ordefy"
                            width={140}
                            height={49}
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

                    <tr>
                      <td
                        bgcolor={BRAND.light.card}
                        className="ord-card"
                        style={{
                          backgroundColor: BRAND.light.card,
                          border: `1px solid ${BRAND.light.cardBorder}`,
                          borderRadius: '12px',
                          padding: '40px 36px',
                          color: BRAND.light.body,
                        }}
                      >
                        {children}
                      </td>
                    </tr>

                    {footer ? (
                      <>
                        <tr>
                          <td
                            align="center"
                            className="ord-bg"
                            style={{
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
                                    <Link
                                      href={APP_URL}
                                      className="ord-muted"
                                      style={footerLinkStyle}
                                    >
                                      App
                                    </Link>
                                  </td>
                                  <td
                                    className="ord-muted"
                                    style={footerSeparatorStyle}
                                  >
                                    |
                                  </td>
                                  <td style={{ padding: '0 12px' }}>
                                    <Link
                                      href={MARKETING_URL}
                                      className="ord-muted"
                                      style={footerLinkStyle}
                                    >
                                      Sitio web
                                    </Link>
                                  </td>
                                  <td
                                    className="ord-muted"
                                    style={footerSeparatorStyle}
                                  >
                                    |
                                  </td>
                                  <td style={{ padding: '0 12px' }}>
                                    <Link
                                      href={`mailto:${SUPPORT_EMAIL}`}
                                      className="ord-muted"
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
                            align="center"
                            className="ord-bg ord-muted"
                            style={{
                              padding: '0 0 8px',
                              fontSize: '11px',
                              color: BRAND.light.muted,
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
                          align="center"
                          className="ord-bg ord-muted"
                          style={{
                            padding: '28px 0 8px',
                            fontSize: '11px',
                            color: BRAND.light.muted,
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
