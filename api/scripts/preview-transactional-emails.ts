/**
 * Render every transactional email (P0 + P1 + P2) to /tmp as both .html and
 * .txt so you can open them in a browser without sending anything via Resend.
 *
 * Run: npx tsx api/scripts/preview-transactional-emails.ts
 *
 * Output: /tmp/ordefy-emails/<slug>.html  +  /tmp/ordefy-emails/<slug>.txt
 *
 * The HTML file inlines the logo as a data URI so the preview works offline,
 * even before public/email/logo.png lives on the production CDN.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });

import {
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
  type RenderedEmail,
} from '../services/email-jsx-templates';

const OUT_DIR = '/tmp/ordefy-emails';
fs.mkdirSync(OUT_DIR, { recursive: true });

// Inline the production logos as data: URIs for offline previews. Both the
// transparent and the dark-baked variants are inlined so any combination of
// <picture><source>/<img> in the rendered HTML resolves locally without
// needing the asset to be live on the CDN.
const transparentLogoPath = path.resolve(__dirname, '../../public/email/logo.png');
const darkLogoPath = path.resolve(__dirname, '../../public/email/logo-dark.png');
const transparentLogoUri = fs.existsSync(transparentLogoPath)
  ? `data:image/png;base64,${fs.readFileSync(transparentLogoPath).toString('base64')}`
  : null;
const darkLogoUri = fs.existsSync(darkLogoPath)
  ? `data:image/png;base64,${fs.readFileSync(darkLogoPath).toString('base64')}`
  : null;

function persist(slug: string, rendered: RenderedEmail) {
  let html = rendered.html;
  if (darkLogoUri) {
    html = html.replaceAll(
      'https://app.ordefy.io/email/logo-dark.png',
      darkLogoUri,
    );
  }
  if (transparentLogoUri) {
    html = html.replaceAll(
      'https://app.ordefy.io/email/logo.png',
      transparentLogoUri,
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, `${slug}.html`), html);
  fs.writeFileSync(path.join(OUT_DIR, `${slug}.txt`), rendered.text);
  console.log(`  ${slug.padEnd(28)} subject="${rendered.subject}"`);
}

async function main() {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  console.log('Rendering 12 transactional emails to', OUT_DIR);
  console.log('---');

  persist('welcome', await renderWelcomeEmail({
    userName: 'Gastón',
    storeName: 'NOCTE',
  }));

  persist('email-verification', await renderEmailVerificationEmail({
    userName: 'Gastón',
    verificationLink: 'https://app.ordefy.io/verify?token=preview-token-abc123',
    expiresInMinutes: 60,
  }));

  persist('password-reset', await renderPasswordResetEmail({
    userName: 'Gastón',
    resetLink: 'https://app.ordefy.io/reset-password?token=preview-token-xyz789',
    expiresInMinutes: 30,
  }));

  persist('collaborator-invite', await renderCollaboratorInviteEmail({
    inviteeName: 'María',
    inviterName: 'Gastón',
    storeName: 'NOCTE',
    role: 'logistics',
    inviteLink: 'https://app.ordefy.io/i/preview-collaborator-token',
    expiresAt,
  }));

  persist('courier-operator-invite', await renderCourierOperatorInviteEmail({
    inviteeName: 'Juan',
    inviterName: 'Gastón',
    storeName: 'NOCTE',
    carrierName: 'Asunción Express',
    inviteLink: 'https://app.ordefy.io/i/preview-courier-token',
    expiresAt,
  }));

  persist('trial-start', await renderTrialStartEmail({
    userName: 'Gastón',
    planName: 'Pro',
    trialDays: 14,
    trialEndsAt: '23 de mayo de 2026',
  }));

  persist('trial-ending', await renderTrialEndingEmail({
    userName: 'Gastón',
    planName: 'Pro',
    daysRemaining: 3,
    upgradeLink: 'https://app.ordefy.io/billing/checkout',
  }));

  persist('plan-upgrade', await renderPlanUpgradeEmail({
    userName: 'Gastón',
    previousPlan: 'Starter',
    newPlan: 'Pro',
    amount: '$49 USD',
    billingCycle: 'mensual',
    nextBillingDate: '9 de junio de 2026',
  }));

  persist('plan-cancellation', await renderPlanCancellationEmail({
    userName: 'Gastón',
    currentPlan: 'Pro',
    effectiveDate: '9 de junio de 2026',
  }));

  persist('order-confirmation', await renderOrderConfirmationEmail({
    customerName: 'Carolina',
    storeName: 'NOCTE',
    orderNumber: 'ORD-20260509',
    orderDate: '9 de mayo de 2026',
    items: [
      { name: 'Lentes Sleep Mode (Onyx)', quantity: 2, price: '458.000 Gs' },
      { name: 'Estuche premium', quantity: 1, price: '0 Gs' },
    ],
    subtotal: '458.000 Gs',
    shipping: '25.000 Gs',
    total: '483.000 Gs',
    trackingUrl: 'https://app.ordefy.io/track/ORD-20260509',
  }));

  persist('invoice', await renderInvoiceEmail({
    customerName: 'Carolina',
    storeName: 'NOCTE',
    documentNumber: '1234',
    invoiceDate: '9 de mayo de 2026',
    items: [
      { name: 'Lentes Sleep Mode (Onyx)', quantity: 2, unitPrice: '229.000 Gs' },
    ],
    subtotal: '416.364 Gs',
    iva10: '41.636 Gs',
    total: '458.000 Gs',
    kudeUrl: 'https://ekuatia.set.gov.py/consultas/qr?nVersion=preview',
    isDemo: false,
  }));

  persist('generic', await renderGenericEmail({
    title: 'Tu suscripción se renovó',
    subtitle: 'Plan Pro · próximo cobro en 30 días.',
    body: 'Acabamos de renovar tu plan Pro por otro mes. No es necesario que hagas nada. Si tenés preguntas sobre la facturación, respondé este correo.',
    ctaText: 'Ver factura',
    ctaUrl: 'https://app.ordefy.io/billing/invoices',
    footerNote: 'Esta es una notificación automática.',
    preheader: 'Tu plan Pro se renovó por otro mes.',
  }));

  console.log('---');
  console.log(`Open: open ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
