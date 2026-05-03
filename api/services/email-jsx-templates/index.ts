/**
 * react-email template renderers (Phase A scaffold).
 *
 * Renders JSX components to HTML strings using @react-email/render.
 * The legacy template literal stack in `../email-templates.ts` continues to
 * power the existing 10 transactional emails (welcome, password reset,
 * collaborator invite, invoice, etc.) — they will be migrated incrementally.
 *
 * New emails (milestone, share-card receipts) live here.
 */

import { render } from '@react-email/render';
import * as React from 'react';
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

export type { MilestoneEmailData };
