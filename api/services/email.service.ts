import { logger } from '../utils/logger';
import { Resend } from 'resend';
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
  renderMilestoneEmail,
  type WelcomeEmailData,
  type EmailVerificationEmailData,
  type PasswordResetEmailData,
  type CollaboratorInviteEmailData,
  type CourierOperatorInviteEmailData,
  type TrialStartEmailData,
  type TrialEndingEmailData,
  type PlanUpgradeEmailData,
  type PlanCancellationEmailData,
  type OrderConfirmationEmailData,
  type InvoiceEmailData,
  type GenericEmailData,
  type MilestoneEmailData,
  type RenderedEmail,
} from './email-jsx-templates';

let resendClient: Resend | null = null;

const getResendClient = (): Resend | null => {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Ordefy <noreply@ops.ordefy.io>';

const isEmailEnabled = (): boolean => !!process.env.RESEND_API_KEY;

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** When set, the attachment is embedded inline and referenced via cid:contentId in HTML */
  contentId?: string;
}

async function send(
  to: string,
  rendered: RenderedEmail,
  tag: string,
  fromOverride?: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  if (!isEmailEnabled()) {
    logger.info('EMAIL', `Resend not configured, skipping ${tag} to: ${to}`);
    return { success: true, messageId: 'skipped-no-api-key' };
  }

  try {
    const client = getResendClient()!;
    const payload: Record<string, unknown> = {
      from: fromOverride || FROM_EMAIL,
      to: [to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((att) => {
        const a: Record<string, unknown> = {
          filename: att.filename,
          content: att.content,
          contentType: att.contentType || 'application/pdf',
        };
        // Resend inline-image format: when content_id is set, the asset is
        // available in HTML as <img src="cid:<id>" />. Both camelCase and
        // snake_case keys are sent for SDK compatibility.
        if (att.contentId) {
          a.content_id = att.contentId;
          a.contentId = att.contentId;
        }
        return a;
      });
    }

    const { data: result, error } = await client.emails.send(
      payload as unknown as Parameters<typeof client.emails.send>[0],
    );

    if (error) {
      logger.error('EMAIL', `Resend error on ${tag}: ${error.message}`);
      return { success: false, error: error.message };
    }

    logger.info('EMAIL', `${tag} sent to ${to}, id: ${result?.id}`);
    return { success: true, messageId: result?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('EMAIL', `Exception on ${tag}: ${message}`);
    return { success: false, error: message };
  }
}

// ================================================================
// Public email functions
// ================================================================

export async function sendWelcomeEmail(
  to: string,
  data: WelcomeEmailData,
): Promise<SendResult> {
  return send(to, await renderWelcomeEmail(data), 'welcome');
}

export async function sendEmailVerification(
  to: string,
  data: EmailVerificationEmailData,
): Promise<SendResult> {
  return send(to, await renderEmailVerificationEmail(data), 'email-verification');
}

export async function sendPasswordReset(
  to: string,
  data: PasswordResetEmailData,
): Promise<SendResult> {
  return send(to, await renderPasswordResetEmail(data), 'password-reset');
}

export async function sendCollaboratorInvite(
  to: string,
  data: CollaboratorInviteEmailData,
): Promise<SendResult> {
  return send(to, await renderCollaboratorInviteEmail(data), 'collaborator-invite');
}

/**
 * Send a courier-operator invite. Distinct from sendCollaboratorInvite so the
 * copy (and Resend tag) are courier-specific. Same SendResult contract:
 * callers treat success=false as "log link, surface to admin for manual
 * share". Never block the API call on email delivery.
 */
export async function sendCourierOperatorInvite(
  to: string,
  data: CourierOperatorInviteEmailData,
): Promise<SendResult> {
  return send(
    to,
    await renderCourierOperatorInviteEmail(data),
    'courier-operator-invite',
  );
}

export async function sendTrialStart(
  to: string,
  data: TrialStartEmailData,
): Promise<SendResult> {
  return send(to, await renderTrialStartEmail(data), 'trial-start');
}

export async function sendTrialEnding(
  to: string,
  data: TrialEndingEmailData,
): Promise<SendResult> {
  return send(to, await renderTrialEndingEmail(data), 'trial-ending');
}

export async function sendPlanUpgrade(
  to: string,
  data: PlanUpgradeEmailData,
): Promise<SendResult> {
  return send(to, await renderPlanUpgradeEmail(data), 'plan-upgrade');
}

export async function sendPlanCancellation(
  to: string,
  data: PlanCancellationEmailData,
): Promise<SendResult> {
  return send(to, await renderPlanCancellationEmail(data), 'plan-cancellation');
}

export async function sendOrderConfirmation(
  to: string,
  data: OrderConfirmationEmailData,
): Promise<SendResult> {
  return send(to, await renderOrderConfirmationEmail(data), 'order-confirmation');
}

/**
 * Send an electronic invoice email to a store customer. The "from" address
 * uses the store name as display name so the customer sees
 * "NOCTE <noreply@ops.ordefy.io>" instead of the generic Ordefy sender.
 *
 * Optionally attaches files (KUDE PDF in typical usage).
 */
export async function sendInvoiceEmail(
  to: string,
  data: InvoiceEmailData,
  storeName: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  // Sanitize store name: strip angle brackets to prevent header injection
  const safeName = storeName.replace(/[<>]/g, '').trim();
  const fromAddress = `${safeName} <noreply@ops.ordefy.io>`;
  return send(
    to,
    await renderInvoiceEmail(data),
    'invoice-email',
    fromAddress,
    attachments,
  );
}

export async function sendGenericEmail(
  to: string,
  data: GenericEmailData,
): Promise<SendResult> {
  return send(to, await renderGenericEmail(data), 'generic');
}

/**
 * Founder-signed milestone email (react-email rendered).
 *
 * The "From" header is overridden to display "Gastón de Ordefy" so the email
 * lands as personal in the inbox, not as a transactional notification. The
 * underlying mailbox (and SPF/DKIM) is the same ops sender. Override the
 * full address by setting MILESTONE_FROM_EMAIL in env.
 *
 * Image strategy: Satori renders are downscaled to 560px native (matches the
 * email container width). At that size each PNG is ~10-15 KB, total MIME
 * message stays well under Gmail's 102 KB clip threshold even with two
 * inline images attached via CID.
 *
 * Optional `chartPoints` controls the chart data. If omitted, falls back to
 * a synthetic curve (test/preview only).
 */
export async function sendMilestoneEmail(
  to: string,
  data: MilestoneEmailData,
  opts?: {
    chartPoints?: Array<{ label: string; value: number }>;
    storeId?: string;
  },
): Promise<SendResult> {
  const { renderEmailHero, renderOrdersChart } = await import(
    './share-card-renderer'
  );

  const heroSubtitle = data.milestoneValue === 1 ? 'PRIMERA' : 'ÓRDENES';
  const points =
    opts?.chartPoints ?? buildSyntheticChartPoints(data.milestoneValue);

  const [heroPng, chartPng] = await Promise.all([
    renderEmailHero({
      milestoneValue: data.milestoneValue,
      subtitle: heroSubtitle,
    }),
    renderOrdersChart(points),
  ]);

  const heroCid = 'milestone-hero';
  const chartCid = 'milestone-chart';

  const enrichedData: MilestoneEmailData = {
    ...data,
    heroImageUrl: `cid:${heroCid}`,
    chartImageUrl: `cid:${chartCid}`,
  };
  const rendered = await renderMilestoneEmail(enrichedData);

  const fromOverride =
    process.env.MILESTONE_FROM_EMAIL ||
    'Gastón de Ordefy <noreply@ops.ordefy.io>';

  // Branded Spanish filenames (visible if Gmail can't render inline)
  const heroFilename = `ordefy-${data.milestoneValue}-ordenes.png`;
  const chartFilename = `ordefy-progreso.png`;

  return send(to, rendered, 'milestone', fromOverride, [
    {
      filename: heroFilename,
      content: heroPng,
      contentType: 'image/png',
      contentId: heroCid,
    },
    {
      filename: chartFilename,
      content: chartPng,
      contentType: 'image/png',
      contentId: chartCid,
    },
  ]);
}

function buildSyntheticChartPoints(
  milestoneValue: number,
): Array<{ label: string; value: number }> {
  // Cumulative growth curve, slightly accelerating, ending at milestoneValue.
  // Used when no real data is available (test script / preview).
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul'];
  const n = Math.min(7, Math.max(4, Math.ceil(milestoneValue / 30)));
  const result: Array<{ label: string; value: number }> = [];
  for (let i = 0; i < n; i++) {
    // Easing curve so the line accelerates toward the end
    const t = i / (n - 1);
    const eased = Math.pow(t, 1.6);
    result.push({
      label: months[i] ?? `M${i + 1}`,
      value: Math.round(eased * milestoneValue),
    });
  }
  // Make sure last point lands exactly on milestoneValue
  result[result.length - 1].value = milestoneValue;
  return result;
}

export function isConfigured(): boolean {
  return isEmailEnabled();
}
