import { logger } from '../utils/logger';
import { Resend } from 'resend';
import {
  welcomeTemplate,
  emailVerificationTemplate,
  passwordResetTemplate,
  collaboratorInviteTemplate,
  trialStartTemplate,
  trialEndingTemplate,
  planUpgradeTemplate,
  planCancellationTemplate,
  orderConfirmationTemplate,
  genericTemplate,
} from './email-templates';
import type {
  WelcomeTemplateData,
  EmailVerificationTemplateData,
  PasswordResetTemplateData,
  CollaboratorInviteTemplateData,
  TrialStartTemplateData,
  TrialEndingTemplateData,
  PlanUpgradeTemplateData,
  PlanCancellationTemplateData,
  OrderConfirmationTemplateData,
  GenericEmailTemplateData,
} from './email-templates';

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

async function send(
  to: string,
  template: { html: string; text: string; subject: string },
  tag: string
): Promise<SendResult> {
  if (!isEmailEnabled()) {
    logger.info('EMAIL', `Resend not configured, skipping ${tag} to: ${to}`);
    return { success: true, messageId: 'skipped-no-api-key' };
  }

  try {
    const client = getResendClient()!;
    const { data: result, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

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

export async function sendWelcomeEmail(to: string, data: WelcomeTemplateData): Promise<SendResult> {
  return send(to, welcomeTemplate(data), 'welcome');
}

export async function sendEmailVerification(to: string, data: EmailVerificationTemplateData): Promise<SendResult> {
  return send(to, emailVerificationTemplate(data), 'email-verification');
}

export async function sendPasswordReset(to: string, data: PasswordResetTemplateData): Promise<SendResult> {
  return send(to, passwordResetTemplate(data), 'password-reset');
}

export async function sendCollaboratorInvite(to: string, data: CollaboratorInviteTemplateData): Promise<SendResult> {
  return send(to, collaboratorInviteTemplate(data), 'collaborator-invite');
}

export async function sendTrialStart(to: string, data: TrialStartTemplateData): Promise<SendResult> {
  return send(to, trialStartTemplate(data), 'trial-start');
}

export async function sendTrialEnding(to: string, data: TrialEndingTemplateData): Promise<SendResult> {
  return send(to, trialEndingTemplate(data), 'trial-ending');
}

export async function sendPlanUpgrade(to: string, data: PlanUpgradeTemplateData): Promise<SendResult> {
  return send(to, planUpgradeTemplate(data), 'plan-upgrade');
}

export async function sendPlanCancellation(to: string, data: PlanCancellationTemplateData): Promise<SendResult> {
  return send(to, planCancellationTemplate(data), 'plan-cancellation');
}

export async function sendOrderConfirmation(to: string, data: OrderConfirmationTemplateData): Promise<SendResult> {
  return send(to, orderConfirmationTemplate(data), 'order-confirmation');
}

export async function sendGenericEmail(to: string, data: GenericEmailTemplateData): Promise<SendResult> {
  return send(to, genericTemplate(data), 'generic');
}

export function isConfigured(): boolean {
  return isEmailEnabled();
}
