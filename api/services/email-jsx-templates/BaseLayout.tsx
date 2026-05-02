import * as React from 'react';
import {
  Body,
  Head,
  Html,
  Img,
  Link,
  Preview,
} from '@react-email/components';
import { APP_URL, BRAND, CURRENT_YEAR, LOGO_URL } from './brand';

interface BaseLayoutProps {
  preheader: string;
  children: React.ReactNode;
}

/**
 * Bulletproof dark-mode email layout. Uses raw <table> elements with both the
 * legacy `bgcolor` HTML attribute AND inline CSS background-color, because
 * Gmail Android, Outlook, and Yahoo strip CSS-only backgrounds on outer
 * containers and force the client default (white). The bgcolor attribute
 * survives across every major client.
 */
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
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: BRAND.bg,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
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
                            style={{
                              display: 'inline-block',
                              maxWidth: '140px',
                              height: 'auto',
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
