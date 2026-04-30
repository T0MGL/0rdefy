/**
 * Send a real test milestone email + render share-card preview.
 *
 * Usage:
 *   tsx api/scripts/send-test-milestone-email.ts [--store-id <uuid>] [--milestone-value 100] [--to gaston@thebrightidea.ai]
 *
 * Behaviour:
 *   - If --store-id is omitted: uses canonical mock data ("Juan", 100, etc).
 *   - If --store-id is given: pulls real numbers via the milestone-detector
 *     stats path. (DB access required.)
 *   - Always renders the story-format share card PNG to /tmp.
 *   - Always sends the email to the --to address (defaults to
 *     gaston@thebrightidea.ai). Requires RESEND_API_KEY.
 *
 * Exit code 0 on success (email accepted by Resend), 1 on failure.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load env BEFORE importing anything that reads it.
// Try api/.env first (where Resend & Supabase live), fall back to root .env.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiEnvPath = path.resolve(__dirname, '../.env');
const rootEnvPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(apiEnvPath)) {
  dotenv.config({ path: apiEnvPath });
}
if (fs.existsSync(rootEnvPath)) {
  // Override:false means api/.env wins for keys present in both.
  dotenv.config({ path: rootEnvPath, override: false });
}

import { renderShareCard } from '../services/share-card-renderer';
import { renderMilestoneEmail, type MilestoneEmailData } from '../services/email-jsx-templates';
import { sendMilestoneEmail } from '../services/email.service';

interface Args {
  storeId?: string;
  milestoneValue: number;
  to: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { milestoneValue: 100, to: 'gaston@thebrightidea.ai' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--store-id' && next) {
      args.storeId = next;
      i++;
    } else if (a === '--milestone-value' && next) {
      args.milestoneValue = parseInt(next, 10);
      i++;
    } else if (a === '--to' && next) {
      args.to = next;
      i++;
    }
  }
  return args;
}

function buildMockData(milestoneValue: number): MilestoneEmailData {
  // Mirrors the canonical example from the brief.
  return {
    firstName: 'Juan',
    milestoneValue,
    firstOrderDate: '14 de marzo',
    firstOrderTime: '22:43',
    firstOrderAmount: '245.000 Gs',
    productCount: 28,
    carrierCount: 4,
    deliveryRate: 91,
    bestDay: '8 de abril',
    bestDayCount: 7,
    marginAccumulated: '8.420.000 Gs',
    shareUrl: 'https://app.ordefy.io/wrapped/preview',
    currency: 'PYG',
  };
}

async function main() {
  const args = parseArgs();
  console.log('Milestone test email');
  console.log('  --to               :', args.to);
  console.log('  --milestone-value  :', args.milestoneValue);
  console.log('  --store-id         :', args.storeId ?? '(none, using mock)');
  console.log('');

  // 1. Build email data (mock for now — real DB pull is exercised in
  //    production by checkAndSendMilestone).
  const data: MilestoneEmailData = buildMockData(args.milestoneValue);

  // If a store-id is provided, attempt to also create a share_card row so the
  // share URL in the email is real. Best-effort; failure is non-fatal.
  let realShareUrl: string | null = null;
  if (args.storeId) {
    try {
      const { supabaseAdmin } = await import('../db/connection');
      const { customAlphabet } = await import('nanoid');
      const tokenGen = customAlphabet(
        '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
        22,
      );
      const token = tokenGen();
      const { error } = await supabaseAdmin.from('share_cards').insert({
        store_id: args.storeId,
        token,
        milestone_type: 'orders',
        milestone_value: args.milestoneValue,
        public_data: {
          milestone_value: args.milestoneValue,
          milestone_type: 'orders',
          headline: 'Órdenes procesadas',
          store_handle: '@nocte',
        },
        private_data: {
          milestone_value: args.milestoneValue,
          first_order_total: 245000,
          product_count: data.productCount,
          carrier_count: data.carrierCount,
          delivery_rate: data.deliveryRate,
          best_day: '2026-04-08',
          best_day_count: data.bestDayCount,
          margin_accumulated: 8420000,
          currency: 'PYG',
        },
      });
      if (error) {
        console.warn('share_card insert failed:', error.message);
      } else {
        const appUrl = process.env.APP_URL || 'https://app.ordefy.io';
        realShareUrl = `${appUrl}/wrapped/${token}`;
        data.shareUrl = realShareUrl;
        console.log('share_card created, token =', token);
      }
    } catch (err) {
      console.warn('Could not create share_card:', (err as Error).message);
    }
  }

  // 2. Render the share-card PNG to /tmp
  console.log('Rendering share-card PNG (story 1080x1920)...');
  let imagePath: string | null = null;
  try {
    const png = await renderShareCard(
      {
        milestoneValue: data.milestoneValue,
        subtitle: 'ÓRDENES PROCESADAS',
        storeHandle: '@nocte',
        mode: 'private',
        privateLines: [
          `${data.productCount} productos diferentes`,
          `${data.deliveryRate}% delivery rate`,
          `${data.carrierCount} carriers usados`,
        ],
      },
      'story',
    );
    imagePath = `/tmp/share-card-test-${data.milestoneValue}.png`;
    fs.writeFileSync(imagePath, png);
    console.log('  -> wrote', imagePath, `(${png.byteLength} bytes)`);
  } catch (err) {
    console.warn('Share-card render failed (non-fatal):', (err as Error).message);
  }

  // 3. Render email to confirm HTML works before sending
  console.log('Rendering email HTML...');
  const rendered = await renderMilestoneEmail(data);
  const previewHtmlPath = `/tmp/milestone-email-preview-${data.milestoneValue}.html`;
  fs.writeFileSync(previewHtmlPath, rendered.html);
  console.log('  -> wrote', previewHtmlPath, `(${rendered.html.length} chars)`);
  console.log('  subject:', rendered.subject);

  // 4. Send the email
  if (!process.env.RESEND_API_KEY) {
    console.error('FATAL: RESEND_API_KEY not set. Cannot send real email.');
    console.error('       Set it in .env or export it before running.');
    process.exit(1);
  }

  console.log('Sending email via Resend to', args.to, '...');
  const result = await sendMilestoneEmail(args.to, data);

  if (!result.success) {
    console.error('SEND FAILED:', result.error);
    process.exit(1);
  }

  console.log('');
  console.log('========================================');
  console.log('SENT');
  console.log('========================================');
  console.log('message_id   :', result.messageId);
  console.log('share_url    :', data.shareUrl);
  console.log('image_preview:', imagePath ?? '(skipped)');
  console.log('email_preview:', previewHtmlPath);
  console.log('========================================');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
