/**
 * Reusable transactional email primitives.
 *
 * These render through @react-email/components but expose smaller, opinionated
 * APIs that mirror the legacy template-literal helpers (heading, paragraph,
 * ctaButton, infoTable, etc). Templates compose these instead of pasting
 * inline styles.
 *
 * Visual constraints:
 *   - Dark canvas tokens come from `brand.ts`. Never hardcode hex.
 *   - Spacing scale: 4 / 8 / 14 / 18 / 24 / 32 / 40 px. Avoid arbitrary values.
 *   - Buttons render as <a> with table-wrapped padding so Outlook respects the
 *     hit area. Do NOT replace with the Button component from
 *     @react-email/components: it adds its own table wrapper that conflicts
 *     with the tight padding pattern we use in the legacy templates.
 */

import * as React from 'react';
import { Hr, Link as REmailLink, Section, Text } from '@react-email/components';
import { BRAND, FONT_STACK } from './brand';

// ---------- Headings ---------------------------------------------------------

const headingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '22px',
  fontWeight: 700,
  color: BRAND.white,
  lineHeight: 1.3,
  letterSpacing: '-0.3px',
};

const subheadingStyle: React.CSSProperties = {
  margin: '0 0 24px',
  fontSize: '14px',
  color: BRAND.textSecondary,
  lineHeight: 1.5,
};

const paragraphStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: '15px',
  color: BRAND.text,
  lineHeight: 1.6,
};

const smallTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: BRAND.textMuted,
  lineHeight: 1.5,
};

export interface HeadingProps {
  children: React.ReactNode;
}
export function Heading({ children }: HeadingProps) {
  return (
    <Text className="ord-text" style={headingStyle}>
      {children}
    </Text>
  );
}

export function SubHeading({ children }: HeadingProps) {
  return (
    <Text className="ord-text-secondary" style={subheadingStyle}>
      {children}
    </Text>
  );
}

export function Paragraph({ children }: HeadingProps) {
  return (
    <Text className="ord-text" style={paragraphStyle}>
      {children}
    </Text>
  );
}

export function SmallText({ children }: HeadingProps) {
  return (
    <Text className="ord-text-muted" style={smallTextStyle}>
      {children}
    </Text>
  );
}

// ---------- Buttons ----------------------------------------------------------

export interface CTAButtonProps {
  href: string;
  children: React.ReactNode;
  /** Use 'secondary' for low-emphasis actions (outlined, dark). */
  variant?: 'primary' | 'secondary';
}

const secondaryButtonAnchor: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: 'transparent',
  color: BRAND.text,
  fontSize: '14px',
  fontWeight: 500,
  textDecoration: 'none',
  padding: '10px 24px',
  borderRadius: '8px',
  border: `1px solid ${BRAND.cardBorder}`,
  fontFamily: FONT_STACK,
};

/**
 * CTA button. Wrapped in a table so Outlook respects the padding (it strips
 * <a> inline padding without one).
 *
 * The primary variant carries:
 *   - `bgcolor` HTML attribute on the wrapping <td> (Outlook desktop +
 *     Yahoo only honor color via this legacy attribute, not via CSS).
 *   - `!important` flags on the inline anchor color/background, so
 *     Outlook.com web does not strip the brand lime.
 *   - `ord-cta-anchor` class targeted by the [data-ogsc] / [data-ogsb]
 *     selectors in BaseLayout, so the Outlook app and Outlook.com keep
 *     the brand colors after their dark-mode transform.
 */
export function CTAButton({
  href,
  children,
  variant = 'primary',
}: CTAButtonProps) {
  const margin = variant === 'primary' ? '28px 0' : '12px 0';

  if (variant === 'primary') {
    return (
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        width="100%"
        style={{ margin, borderCollapse: 'collapse' }}
      >
        <tbody>
          <tr>
            <td align="center">
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                border={0}
                style={{ borderCollapse: 'separate' }}
              >
                <tbody>
                  <tr>
                    <td
                      bgcolor={BRAND.primary}
                      align="center"
                      className="ord-primary-bg"
                      style={{
                        backgroundColor: BRAND.primary,
                        borderRadius: '8px',
                      }}
                    >
                      <a
                        href={href}
                        className="ord-cta-anchor"
                        style={{
                          display: 'inline-block',
                          backgroundColor: BRAND.primary,
                          color: BRAND.bg,
                          fontSize: '15px',
                          fontWeight: 700,
                          textDecoration: 'none',
                          padding: '14px 32px',
                          borderRadius: '8px',
                          letterSpacing: '-0.2px',
                          fontFamily: FONT_STACK,
                        }}
                      >
                        {children}
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={{ margin, borderCollapse: 'collapse' }}
    >
      <tbody>
        <tr>
          <td align="center">
            <a
              href={href}
              className="ord-text"
              style={secondaryButtonAnchor}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ---------- Inline link ------------------------------------------------------

export interface InlineLinkProps {
  href: string;
  children: React.ReactNode;
}
export function InlineLink({ href, children }: InlineLinkProps) {
  return (
    <REmailLink
      href={href}
      className="ord-primary-fg"
      style={{
        color: BRAND.primary,
        textDecoration: 'none',
        fontWeight: 500,
      }}
    >
      {children}
    </REmailLink>
  );
}

// ---------- Divider ----------------------------------------------------------

export function Divider() {
  return <Hr style={{ borderColor: BRAND.divider, margin: '24px 0' }} />;
}

// ---------- Info table -------------------------------------------------------

export interface InfoRow {
  label: string;
  value: React.ReactNode;
}

export interface InfoTableProps {
  rows: InfoRow[];
}

/**
 * Two-column key/value list. The label column is fixed-width (120px) so values
 * align across rows; this is the same layout the legacy template literals
 * produced. Background is `footerBg` to give the panel a subtle, darker tone
 * separate from the surrounding card.
 */
export function InfoTable({ rows }: InfoTableProps) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      bgcolor={BRAND.footerBg}
      className="ord-footer-bg"
      style={{
        margin: '20px 0',
        backgroundColor: BRAND.footerBg,
        borderRadius: '8px',
        borderCollapse: 'separate',
      }}
    >
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td
              className="ord-text-muted"
              style={{
                padding: i === 0 ? '14px 16px 6px' : '6px 16px 6px',
                fontSize: '13px',
                color: BRAND.textMuted,
                whiteSpace: 'nowrap',
                verticalAlign: 'top',
                width: '120px',
              }}
            >
              {r.label}
            </td>
            <td
              className="ord-text"
              style={{
                padding:
                  i === 0
                    ? '14px 16px 6px 0'
                    : i === rows.length - 1
                      ? '6px 16px 14px 0'
                      : '6px 16px 6px 0',
                fontSize: '14px',
                color: BRAND.text,
                fontWeight: 500,
              }}
            >
              {r.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Steps list -------------------------------------------------------

export interface StepsListProps {
  steps: string[];
}

/**
 * Numbered onboarding-style step list. Used for the welcome email.
 */
export function StepsList({ steps }: StepsListProps) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ margin: '20px 0', borderCollapse: 'collapse' }}
    >
      <tbody>
        {steps.map((step, i) => (
          <tr key={i}>
            <td
              style={{
                width: '32px',
                verticalAlign: 'top',
                padding: '6px 0',
              }}
            >
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                border={0}
                style={{ borderCollapse: 'separate' }}
              >
                <tbody>
                  <tr>
                    <td
                      bgcolor={BRAND.primary}
                      align="center"
                      width={24}
                      height={24}
                      className="ord-primary-bg ord-on-primary"
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: BRAND.primary,
                        color: BRAND.bg,
                        fontSize: '12px',
                        fontWeight: 700,
                        textAlign: 'center',
                        lineHeight: '24px',
                      }}
                    >
                      {i + 1}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
            <td
              className="ord-text"
              style={{
                padding: '6px 0 6px 12px',
                fontSize: '14px',
                color: BRAND.text,
                lineHeight: 1.5,
              }}
            >
              {step}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Itemized line table (orders / invoices) -------------------------

export interface LineItem {
  name: string;
  quantity: number;
  price: string;
}

export interface ItemsTableProps {
  items: LineItem[];
  totals: Array<{ label: string; value: string; emphasis?: boolean }>;
  /**
   * Header text for the price column. Defaults to "Precio" but invoices use
   * "P. Unitario" so we let templates override.
   */
  priceHeader?: string;
}

export function ItemsTable({
  items,
  totals,
  priceHeader = 'Precio',
}: ItemsTableProps) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={{ margin: '20px 0', borderCollapse: 'collapse' }}
    >
      <thead>
        <tr>
          <th
            align="left"
            style={{
              padding: '8px 0',
              fontSize: '11px',
              color: BRAND.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              borderBottom: `1px solid ${BRAND.divider}`,
              fontWeight: 500,
            }}
          >
            Producto
          </th>
          <th
            align="center"
            style={{
              padding: '8px',
              fontSize: '11px',
              color: BRAND.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              borderBottom: `1px solid ${BRAND.divider}`,
              fontWeight: 500,
            }}
          >
            Cant.
          </th>
          <th
            align="right"
            style={{
              padding: '8px 0',
              fontSize: '11px',
              color: BRAND.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              borderBottom: `1px solid ${BRAND.divider}`,
              fontWeight: 500,
            }}
          >
            {priceHeader}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i}>
            <td
              style={{
                padding: '10px 0',
                fontSize: '14px',
                color: BRAND.text,
                borderBottom: `1px solid ${BRAND.divider}`,
              }}
            >
              {item.name}
            </td>
            <td
              align="center"
              style={{
                padding: '10px 8px',
                fontSize: '14px',
                color: BRAND.textSecondary,
                borderBottom: `1px solid ${BRAND.divider}`,
              }}
            >
              {item.quantity}
            </td>
            <td
              align="right"
              style={{
                padding: '10px 0',
                fontSize: '14px',
                color: BRAND.text,
                fontWeight: 500,
                borderBottom: `1px solid ${BRAND.divider}`,
              }}
            >
              {item.price}
            </td>
          </tr>
        ))}
        {totals.map((row, i) => (
          <tr key={`t-${i}`}>
            <td
              colSpan={2}
              align="right"
              style={{
                padding: row.emphasis ? '12px 0 0' : '8px 0',
                fontSize: row.emphasis ? '15px' : '13px',
                color: row.emphasis ? BRAND.white : BRAND.textSecondary,
                fontWeight: row.emphasis ? 700 : 400,
              }}
            >
              {row.label}
            </td>
            <td
              align="right"
              style={{
                padding: row.emphasis ? '12px 0 0' : '8px 0',
                fontSize: row.emphasis ? '16px' : '14px',
                color: row.emphasis ? BRAND.primary : BRAND.text,
                fontWeight: row.emphasis ? 700 : 400,
              }}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Container --------------------------------------------------------

/**
 * Convenience: a Section with no extra padding. Wraps free-form template
 * content for consistent paragraph spacing.
 */
export function Block({ children }: { children: React.ReactNode }) {
  return <Section style={{ margin: 0 }}>{children}</Section>;
}
