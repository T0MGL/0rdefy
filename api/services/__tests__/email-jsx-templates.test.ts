/**
 * Smoke tests for the react-email transactional template stack.
 *
 * Run:
 *   npx tsx --test api/services/__tests__/email-jsx-templates.test.ts
 *
 * What this asserts (per template):
 *   - render*Email returns { subject, html, text } without throwing.
 *   - HTML opts into the hybrid color scheme: meta `color-scheme` is
 *     "light dark" (NOT "dark only", that was the v2 anti-pattern that
 *     caused the white-on-white Gmail iOS bug).
 *   - HTML contains the dark `prefers-color-scheme: dark` media block so
 *     Apple Mail / Outlook web flip to dark when the user prefers it.
 *   - HTML contains the [data-ogsc] / [data-ogsb] Outlook overrides.
 *   - HTML carries the legacy `bgcolor` attribute on the outer table so
 *     Outlook desktop and Yahoo render the brand surface (light off-white).
 *   - HTML references the cropped wordmark URL (logo.png), NOT the
 *     legacy logo-dark.png that the previous generator emitted.
 *   - CTA carries the brand lime (#b0e636).
 *   - HTML contains a key piece of dynamic copy (rules out a regression
 *     where a template renders but ignores its data).
 *   - Plain-text fallback is non-empty and contains the same key copy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.RESEND_API_KEY ??= '';

const {
  renderWelcomeEmail,
  renderEmailVerificationEmail,
  renderPasswordResetEmail,
  renderCollaboratorInviteEmail,
  renderCourierOperatorInviteEmail,
  renderTrialStartEmail,
  renderTrialEndingEmail,
  renderPlanUpgradeEmail,
  renderPlanCancellationEmail,
  renderOrderConfirmationEmail,
  renderInvoiceEmail,
  renderGenericEmail,
} = await import('../email-jsx-templates');

const LOGO_URL = 'https://app.ordefy.io/email/logo.png';
const LIGHT_BG = '#fafafa';
const PRIMARY = '#b0e636';
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function expectBaseShell(html: string, text: string, mustContain: string) {
  assert.ok(html.length > 1000, 'HTML must be non-trivial');

  assert.ok(
    html.includes(LOGO_URL),
    'HTML must reference the cropped wordmark URL (logo.png)',
  );
  assert.ok(
    !html.includes('/email/logo-dark.png'),
    'HTML must not reference the legacy logo-dark.png placeholder asset',
  );

  assert.ok(
    html.toLowerCase().includes('bgcolor'),
    'HTML must use the legacy bgcolor attribute on outer table',
  );
  assert.ok(
    html.includes(LIGHT_BG),
    `HTML must contain the light brand bg ${LIGHT_BG}`,
  );

  assert.ok(
    html.includes('color-scheme'),
    'HTML must declare a color-scheme meta',
  );
  assert.ok(
    html.includes('"light dark"'),
    'HTML must opt into hybrid color-scheme (light dark)',
  );
  assert.ok(
    !html.includes('"dark only"'),
    'HTML must not declare dark-only color-scheme (anti-pattern)',
  );

  assert.ok(
    html.includes('prefers-color-scheme: dark'),
    'HTML must include the prefers-color-scheme: dark media query',
  );
  assert.ok(
    html.includes('data-ogsc') && html.includes('data-ogsb'),
    'HTML must include the [data-ogsc] / [data-ogsb] Outlook overrides',
  );

  assert.ok(
    html.toLowerCase().includes(PRIMARY.toLowerCase()),
    `HTML must contain brand lime ${PRIMARY}`,
  );

  assert.ok(html.includes(mustContain), `HTML must contain "${mustContain}"`);
  assert.ok(text.length > 0, 'Plain-text fallback must be non-empty');
  assert.ok(
    text.includes(mustContain),
    `Plain text must contain "${mustContain}"`,
  );
}

describe('email-jsx-templates render shell', () => {
  it('welcome', async () => {
    const r = await renderWelcomeEmail({
      userName: 'Gastón',
      storeName: 'NOCTE',
    });
    expectBaseShell(r.html, r.text, 'NOCTE');
    assert.match(r.subject, /bienvenida.*Gast/i);
  });

  it('email verification', async () => {
    const link = 'https://app.ordefy.io/verify?token=abc';
    const r = await renderEmailVerificationEmail({
      userName: 'Gastón',
      verificationLink: link,
      expiresInMinutes: 60,
    });
    expectBaseShell(r.html, r.text, link);
  });

  it('password reset', async () => {
    const link = 'https://app.ordefy.io/reset-password?token=xyz';
    const r = await renderPasswordResetEmail({
      userName: 'Gastón',
      resetLink: link,
      expiresInMinutes: 30,
    });
    expectBaseShell(r.html, r.text, link);
  });

  it('collaborator invite', async () => {
    const r = await renderCollaboratorInviteEmail({
      inviteeName: 'María',
      inviterName: 'Gastón',
      storeName: 'NOCTE',
      role: 'logistics',
      inviteLink: 'https://app.ordefy.io/i/abc',
      expiresAt: FUTURE,
    });
    expectBaseShell(r.html, r.text, 'NOCTE');
    assert.ok(r.html.includes('Logística'), 'role label must be translated');
  });

  it('courier operator invite', async () => {
    const r = await renderCourierOperatorInviteEmail({
      inviteeName: 'Juan',
      inviterName: 'Gastón',
      storeName: 'NOCTE',
      carrierName: 'Asunción Express',
      inviteLink: 'https://app.ordefy.io/i/xyz',
      expiresAt: FUTURE,
    });
    expectBaseShell(r.html, r.text, 'Asunción Express');
  });

  it('trial start', async () => {
    const r = await renderTrialStartEmail({
      userName: 'Gastón',
      planName: 'Pro',
      trialDays: 14,
      trialEndsAt: '23 de mayo de 2026',
    });
    expectBaseShell(r.html, r.text, 'Pro');
  });

  it('trial ending', async () => {
    const r = await renderTrialEndingEmail({
      userName: 'Gastón',
      planName: 'Pro',
      daysRemaining: 3,
      upgradeLink: 'https://app.ordefy.io/billing/checkout',
    });
    expectBaseShell(r.html, r.text, 'Pro');
  });

  it('plan upgrade', async () => {
    const r = await renderPlanUpgradeEmail({
      userName: 'Gastón',
      previousPlan: 'Starter',
      newPlan: 'Pro',
      amount: '$49 USD',
      billingCycle: 'mensual',
      nextBillingDate: '9 de junio de 2026',
    });
    expectBaseShell(r.html, r.text, 'Pro');
  });

  it('plan cancellation', async () => {
    const r = await renderPlanCancellationEmail({
      userName: 'Gastón',
      currentPlan: 'Pro',
      effectiveDate: '9 de junio de 2026',
    });
    expectBaseShell(r.html, r.text, 'Pro');
  });

  it('order confirmation', async () => {
    const r = await renderOrderConfirmationEmail({
      customerName: 'Carolina',
      storeName: 'NOCTE',
      orderNumber: 'ORD-20260509',
      orderDate: '9 de mayo de 2026',
      items: [
        { name: 'Lentes Sleep Mode', quantity: 1, price: '229.000 Gs' },
      ],
      subtotal: '229.000 Gs',
      shipping: '25.000 Gs',
      total: '254.000 Gs',
    });
    expectBaseShell(r.html, r.text, 'ORD-20260509');
    assert.ok(r.html.includes('254.000 Gs'), 'total must render');
  });

  it('invoice', async () => {
    const r = await renderInvoiceEmail({
      customerName: 'Carolina',
      storeName: 'NOCTE',
      documentNumber: '1234',
      invoiceDate: '9 de mayo de 2026',
      items: [
        { name: 'Lentes', quantity: 1, unitPrice: '229.000 Gs' },
      ],
      subtotal: '208.182 Gs',
      iva10: '20.818 Gs',
      total: '229.000 Gs',
      kudeUrl: 'https://ekuatia.set.gov.py/consultas/qr?nVersion=1',
      isDemo: false,
    });
    // Document number renders 7-digit zero-padded.
    expectBaseShell(r.html, r.text, '0001234');
    assert.ok(r.html.includes('IVA 10%'), 'IVA row must render');
  });

  it('generic', async () => {
    const r = await renderGenericEmail({
      title: 'Aviso',
      body: 'Mensaje de prueba.',
      ctaText: 'Continuar',
      ctaUrl: 'https://app.ordefy.io/x',
    });
    expectBaseShell(r.html, r.text, 'Aviso');
  });

  it('invoice without kudeUrl renders without CTA', async () => {
    const r = await renderInvoiceEmail({
      customerName: 'Cliente',
      storeName: 'NOCTE',
      documentNumber: '99',
      invoiceDate: '9 de mayo de 2026',
      items: [{ name: 'Item', quantity: 1, unitPrice: '0 Gs' }],
      subtotal: '0 Gs',
      iva10: '0 Gs',
      total: '0 Gs',
      kudeUrl: null,
      isDemo: true,
    });
    assert.ok(!r.html.includes('Ver factura electrónica'),
      'CTA must be absent when kudeUrl is null');
    assert.ok(r.html.includes('modo demo'),
      'demo notice must render when isDemo is true');
  });

  it('order confirmation without trackingUrl falls back to copy', async () => {
    const r = await renderOrderConfirmationEmail({
      customerName: 'Cliente',
      storeName: 'NOCTE',
      orderNumber: 'X-1',
      orderDate: '9 de mayo de 2026',
      items: [{ name: 'Item', quantity: 1, price: '0 Gs' }],
      subtotal: '0 Gs',
      shipping: '0 Gs',
      total: '0 Gs',
    });
    assert.ok(!r.html.includes('Rastrear pedido'),
      'tracking CTA must be absent when no URL provided');
    assert.ok(r.html.includes('despachado'),
      'fallback paragraph must render');
  });
});
