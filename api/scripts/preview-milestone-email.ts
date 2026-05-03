/**
 * Generate hero + chart PNGs to /tmp and write a self-contained preview HTML
 * (with images inlined as base64 data URIs) so we can visually inspect what
 * Resend actually shipped without opening the inbox.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });

import { renderEmailHero, renderOrdersChart } from '../services/share-card-renderer';
import { renderMilestoneEmail, type MilestoneEmailData } from '../services/email-jsx-templates';

async function main() {
  const data: MilestoneEmailData = {
    firstName: 'Juan',
    milestoneValue: 100,
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
    heroImageCid: 'milestone-hero',
    chartImageCid: 'milestone-chart',
  };

  console.log('Rendering hero PNG...');
  const heroPng = await renderEmailHero({
    milestoneValue: 100,
    firstName: 'Juan',
    subtitle: 'ÓRDENES',
  });

  console.log('Rendering chart PNG...');
  const chartPng = await renderOrdersChart([
    { label: 'Ene', value: 5 },
    { label: 'Feb', value: 12 },
    { label: 'Mar', value: 28 },
    { label: 'Abr', value: 58 },
    { label: 'May', value: 100 },
  ]);

  fs.writeFileSync('/tmp/milestone-hero.png', heroPng);
  fs.writeFileSync('/tmp/milestone-chart.png', chartPng);

  const rendered = await renderMilestoneEmail(data);

  const heroB64 = `data:image/png;base64,${heroPng.toString('base64')}`;
  const chartB64 = `data:image/png;base64,${chartPng.toString('base64')}`;
  const html = rendered.html
    .replaceAll('cid:milestone-hero', heroB64)
    .replaceAll('cid:milestone-chart', chartB64);

  fs.writeFileSync('/tmp/milestone-email-preview-FULL.html', html);

  console.log('\n========================================');
  console.log('Previews generados:');
  console.log('  hero  -> /tmp/milestone-hero.png');
  console.log('  chart -> /tmp/milestone-chart.png');
  console.log('  html  -> /tmp/milestone-email-preview-FULL.html');
  console.log('========================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
