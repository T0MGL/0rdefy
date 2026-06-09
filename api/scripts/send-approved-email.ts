/**
 * send-approved-email.ts
 *
 * One-off. Dispara el email con KUDE (PDF + QR) al cliente para una factura
 * que ya esta en estado 'approved'. Usa la MISMA funcion que el poller
 * (dispatchApprovedInvoiceEmail): rearma el KUDE desde DB, respeta el gate
 * isApproved, y nunca throws.
 *
 *   railway run --service <worker> npx tsx api/scripts/send-approved-email.ts <storeId> <invoiceId>
 */
import 'dotenv/config';
import { dispatchApprovedInvoiceEmail } from '../services/invoicing.service';

async function main(): Promise<void> {
  const storeId = process.argv[2];
  const invoiceId = process.argv[3];
  if (!storeId || !invoiceId) {
    console.error('Uso: npx tsx api/scripts/send-approved-email.ts <storeId> <invoiceId>');
    process.exit(1);
  }
  console.log(`[send-approved-email] dispatching for store=${storeId} invoice=${invoiceId}`);
  const res = await dispatchApprovedInvoiceEmail(storeId, invoiceId);
  console.log('[send-approved-email] result:', JSON.stringify(res));
  process.exit(0);
}

main().catch((err) => {
  console.error('[send-approved-email] fatal:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
