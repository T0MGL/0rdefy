/**
 * react-email template renderers (single source of truth).
 *
 * Renders JSX components to HTML strings using @react-email/render. Replaces
 * the legacy template-literal stack at `../email-templates.ts` (deleted).
 *
 * Each transactional surface exports:
 *   - render<X>Email(data): { subject, html, text }
 *   - <X>EmailData type (re-exported for callers)
 *
 * The text fallback is kept as part of the same shape so consumer code keeps
 * passing the rendered object straight to Resend.
 */

import { render } from '@react-email/render';
import * as React from 'react';

import {
  WelcomeEmail,
  welcomeEmailSubject,
  welcomeEmailText,
  type WelcomeEmailData,
} from './WelcomeEmail';
import {
  EmailVerificationEmail,
  emailVerificationEmailSubject,
  emailVerificationEmailText,
  type EmailVerificationEmailData,
} from './EmailVerificationEmail';
import {
  PasswordResetEmail,
  passwordResetEmailSubject,
  passwordResetEmailText,
  type PasswordResetEmailData,
} from './PasswordResetEmail';
import {
  CollaboratorInviteEmail,
  collaboratorInviteEmailSubject,
  collaboratorInviteEmailText,
  type CollaboratorInviteEmailData,
} from './CollaboratorInviteEmail';
import {
  CourierOperatorInviteEmail,
  courierOperatorInviteEmailSubject,
  courierOperatorInviteEmailText,
  type CourierOperatorInviteEmailData,
} from './CourierOperatorInviteEmail';
import {
  TrialStartEmail,
  trialStartEmailSubject,
  trialStartEmailText,
  type TrialStartEmailData,
} from './TrialStartEmail';
import {
  TrialEndingEmail,
  trialEndingEmailSubject,
  trialEndingEmailText,
  type TrialEndingEmailData,
} from './TrialEndingEmail';
import {
  PlanUpgradeEmail,
  planUpgradeEmailSubject,
  planUpgradeEmailText,
  type PlanUpgradeEmailData,
} from './PlanUpgradeEmail';
import {
  PlanCancellationEmail,
  planCancellationEmailSubject,
  planCancellationEmailText,
  type PlanCancellationEmailData,
} from './PlanCancellationEmail';
import {
  OrderConfirmationEmail,
  orderConfirmationEmailSubject,
  orderConfirmationEmailText,
  type OrderConfirmationEmailData,
} from './OrderConfirmationEmail';
import {
  InvoiceEmail,
  invoiceEmailSubject,
  invoiceEmailText,
  type InvoiceEmailData,
} from './InvoiceEmail';
import {
  GenericEmail,
  genericEmailSubject,
  genericEmailText,
  type GenericEmailData,
} from './GenericEmail';
import {
  MilestoneEmail,
  milestoneEmailText,
  milestoneEmailSubject,
  type MilestoneEmailData,
} from './MilestoneEmail';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ---------------- Welcome ----------------

export async function renderWelcomeEmail(
  data: WelcomeEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(WelcomeEmail, data));
  return {
    subject: welcomeEmailSubject(data),
    html,
    text: welcomeEmailText(data),
  };
}

// ---------------- Email verification ----------------

export async function renderEmailVerificationEmail(
  data: EmailVerificationEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(EmailVerificationEmail, data));
  return {
    subject: emailVerificationEmailSubject(),
    html,
    text: emailVerificationEmailText(data),
  };
}

// ---------------- Password reset ----------------

export async function renderPasswordResetEmail(
  data: PasswordResetEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(PasswordResetEmail, data));
  return {
    subject: passwordResetEmailSubject(),
    html,
    text: passwordResetEmailText(data),
  };
}

// ---------------- Collaborator invite ----------------

export async function renderCollaboratorInviteEmail(
  data: CollaboratorInviteEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(CollaboratorInviteEmail, data));
  return {
    subject: collaboratorInviteEmailSubject(data),
    html,
    text: collaboratorInviteEmailText(data),
  };
}

// ---------------- Courier-operator invite ----------------

export async function renderCourierOperatorInviteEmail(
  data: CourierOperatorInviteEmailData,
): Promise<RenderedEmail> {
  const html = await render(
    React.createElement(CourierOperatorInviteEmail, data),
  );
  return {
    subject: courierOperatorInviteEmailSubject(data),
    html,
    text: courierOperatorInviteEmailText(data),
  };
}

// ---------------- Trial start ----------------

export async function renderTrialStartEmail(
  data: TrialStartEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(TrialStartEmail, data));
  return {
    subject: trialStartEmailSubject(data),
    html,
    text: trialStartEmailText(data),
  };
}

// ---------------- Trial ending ----------------

export async function renderTrialEndingEmail(
  data: TrialEndingEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(TrialEndingEmail, data));
  return {
    subject: trialEndingEmailSubject(data),
    html,
    text: trialEndingEmailText(data),
  };
}

// ---------------- Plan upgrade ----------------

export async function renderPlanUpgradeEmail(
  data: PlanUpgradeEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(PlanUpgradeEmail, data));
  return {
    subject: planUpgradeEmailSubject(data),
    html,
    text: planUpgradeEmailText(data),
  };
}

// ---------------- Plan cancellation ----------------

export async function renderPlanCancellationEmail(
  data: PlanCancellationEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(PlanCancellationEmail, data));
  return {
    subject: planCancellationEmailSubject(),
    html,
    text: planCancellationEmailText(data),
  };
}

// ---------------- Order confirmation ----------------

export async function renderOrderConfirmationEmail(
  data: OrderConfirmationEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(OrderConfirmationEmail, data));
  return {
    subject: orderConfirmationEmailSubject(data),
    html,
    text: orderConfirmationEmailText(data),
  };
}

// ---------------- Invoice (SIFEN) ----------------

export async function renderInvoiceEmail(
  data: InvoiceEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(InvoiceEmail, data));
  return {
    subject: invoiceEmailSubject(data),
    html,
    text: invoiceEmailText(data),
  };
}

// ---------------- Generic wrapper ----------------

export async function renderGenericEmail(
  data: GenericEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(GenericEmail, data));
  return {
    subject: genericEmailSubject(data),
    html,
    text: genericEmailText(data),
  };
}

// ---------------- Milestone (founder-signed) ----------------

export async function renderMilestoneEmail(
  data: MilestoneEmailData,
): Promise<RenderedEmail> {
  const html = await render(React.createElement(MilestoneEmail, data));
  return {
    subject: milestoneEmailSubject(data),
    html,
    text: milestoneEmailText(data),
  };
}

// ---------------- Re-exported types ----------------

export type {
  WelcomeEmailData,
  EmailVerificationEmailData,
  PasswordResetEmailData,
  CollaboratorInviteEmailData,
  CourierOperatorInviteEmailData,
  TrialStartEmailData,
  TrialEndingEmailData,
  PlanUpgradeEmailData,
  PlanCancellationEmailData,
  OrderConfirmationEmailData,
  InvoiceEmailData,
  GenericEmailData,
  MilestoneEmailData,
};
