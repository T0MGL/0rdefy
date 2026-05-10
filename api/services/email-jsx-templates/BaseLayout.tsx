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
  LOGO_DARK_URL,
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
 * Force-dark CSS block.
 *
 * Layered tactics, validated against Litmus / Email on Acid / Customer.io
 * (2024-2025) and the Outlook app data-attribute references:
 *
 *  - `prefers-color-scheme: light` block forces our dark palette on Apple
 *    Mail / iOS Mail clients whose user is on a light system. We want dark
 *    always, so we override regardless of the OS preference.
 *  - `[data-ogsc]` / `[data-ogsb]` selectors target Outlook app (Android)
 *    and Outlook.com when their dark renderer wraps content; they re-paint
 *    the card and footer back to brand colors.
 *  - Gmail Android and Outlook desktop (classic) still apply their own
 *    algorithmic transform. There is no CSS hook that defeats them; we
 *    minimize damage with `bgcolor` legacy attrs (handled inline below)
 *    and by using midtone colors that survive inversion.
 *
 * The inline `style="..." !important` is what Outlook.com web honors; CSS
 * declarations without !important get stripped by its sanitizer.
 */
const FORCE_DARK_CSS = `
  :root { color-scheme: dark only; supported-color-schemes: dark only; }
  body, .ord-bg, .ord-card, .ord-footer-bg {
    background-color: ${BRAND.bg} !important;
    color: ${BRAND.text} !important;
  }
  .ord-card {
    background-color: ${BRAND.card} !important;
    border-color: ${BRAND.cardBorder} !important;
  }
  .ord-footer-bg { background-color: ${BRAND.bg} !important; }
  .ord-text { color: ${BRAND.text} !important; }
  .ord-text-muted { color: ${BRAND.textMuted} !important; }
  .ord-text-secondary { color: ${BRAND.textSecondary} !important; }
  .ord-primary-bg { background-color: ${BRAND.primary} !important; }
  .ord-primary-fg { color: ${BRAND.primary} !important; }
  .ord-on-primary { color: ${BRAND.bg} !important; }
  a.ord-cta-anchor {
    background-color: ${BRAND.primary} !important;
    color: ${BRAND.bg} !important;
  }

  @media (prefers-color-scheme: light) {
    body, .ord-bg, .ord-card, .ord-footer-bg {
      background-color: ${BRAND.bg} !important;
      color: ${BRAND.text} !important;
    }
    .ord-card {
      background-color: ${BRAND.card} !important;
      border-color: ${BRAND.cardBorder} !important;
    }
    .ord-text { color: ${BRAND.text} !important; }
    .ord-text-muted { color: ${BRAND.textMuted} !important; }
    .ord-text-secondary { color: ${BRAND.textSecondary} !important; }
    a.ord-cta-anchor {
      background-color: ${BRAND.primary} !important;
      color: ${BRAND.bg} !important;
    }
  }

  [data-ogsc] .ord-bg, [data-ogsb] .ord-bg,
  [data-ogsc] body, [data-ogsb] body {
    background-color: ${BRAND.bg} !important;
    color: ${BRAND.text} !important;
  }
  [data-ogsc] .ord-card, [data-ogsb] .ord-card {
    background-color: ${BRAND.card} !important;
    border-color: ${BRAND.cardBorder} !important;
  }
  [data-ogsc] .ord-text, [data-ogsb] .ord-text { color: ${BRAND.text} !important; }
  [data-ogsc] .ord-text-muted, [data-ogsb] .ord-text-muted {
    color: ${BRAND.textMuted} !important;
  }
  [data-ogsc] .ord-text-secondary, [data-ogsb] .ord-text-secondary {
    color: ${BRAND.textSecondary} !important;
  }
  [data-ogsc] a.ord-cta-anchor, [data-ogsb] a.ord-cta-anchor {
    background-color: ${BRAND.primary} !important;
    color: ${BRAND.bg} !important;
  }

  .ord-logo-dark { display: block !important; }
  .ord-logo-light { display: none !important; mso-hide: all; }
`;

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
        <meta name="color-scheme" content="dark only" />
        <meta name="supported-color-schemes" content="dark only" />
        <style>{FORCE_DARK_CSS}</style>
      </Head>
      <Preview>{preheader}</Preview>
      <Body
        className="ord-bg"
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: BRAND.bg,
          color: BRAND.text,
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
          bgcolor={BRAND.bg}
          className="ord-bg"
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
                className="ord-bg"
                style={{
                  backgroundColor: BRAND.bg,
                  padding: '40px 16px 24px',
                }}
              >
                <table
                  role="presentation"
                  width="560"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  bgcolor={BRAND.bg}
                  className="ord-bg"
                  style={{
                    backgroundColor: BRAND.bg,
                    width: '100%',
                    maxWidth: '560px',
                    borderCollapse: 'collapse',
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        bgcolor={BRAND.bg}
                        align="center"
                        className="ord-bg"
                        style={{
                          backgroundColor: BRAND.bg,
                          padding: '0 0 32px',
                        }}
                      >
                        <Link href={APP_URL}>
                          {/*
                           * <picture> swaps the asset based on the client's
                           * color-scheme preference. Apple Mail / iOS Mail /
                           * Samsung honor it. Gmail and Outlook ignore the
                           * <source> and fall back to the <img>, which is the
                           * dark-baked variant -- so the asset already has the
                           * brand bg #09090b painted in and never shows a
                           * transparent halo when an aggressive client
                           * inverts the surrounding page.
                           */}
                          <picture>
                            <source
                              srcSet={LOGO_DARK_URL}
                              media="(prefers-color-scheme: dark)"
                            />
                            <img
                              src={LOGO_DARK_URL}
                              alt="Ordefy"
                              width={140}
                              height={40}
                              className="ord-logo-dark"
                              style={{
                                display: 'inline-block',
                                maxWidth: '140px',
                                height: 'auto',
                                border: 0,
                                outline: 'none',
                                textDecoration: 'none',
                                backgroundColor: BRAND.bg,
                              }}
                            />
                          </picture>
                        </Link>
                      </td>
                    </tr>

                    <tr>
                      <td
                        bgcolor={BRAND.card}
                        className="ord-card"
                        style={{
                          backgroundColor: BRAND.card,
                          border: `1px solid ${BRAND.cardBorder}`,
                          borderRadius: '12px',
                          padding: '40px 36px',
                          color: BRAND.text,
                        }}
                      >
                        {children}
                      </td>
                    </tr>

                    {footer ? (
                      <>
                        <tr>
                          <td
                            bgcolor={BRAND.bg}
                            align="center"
                            className="ord-bg"
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
                                    <Link
                                      href={APP_URL}
                                      className="ord-text-muted"
                                      style={footerLinkStyle}
                                    >
                                      App
                                    </Link>
                                  </td>
                                  <td
                                    className="ord-text-muted"
                                    style={footerSeparatorStyle}
                                  >
                                    |
                                  </td>
                                  <td style={{ padding: '0 12px' }}>
                                    <Link
                                      href={MARKETING_URL}
                                      className="ord-text-muted"
                                      style={footerLinkStyle}
                                    >
                                      Sitio web
                                    </Link>
                                  </td>
                                  <td
                                    className="ord-text-muted"
                                    style={footerSeparatorStyle}
                                  >
                                    |
                                  </td>
                                  <td style={{ padding: '0 12px' }}>
                                    <Link
                                      href={`mailto:${SUPPORT_EMAIL}`}
                                      className="ord-text-muted"
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
                            className="ord-bg ord-text-muted"
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
                          className="ord-bg ord-text-muted"
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
