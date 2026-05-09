/**
 * Pick List PDF generator (Wave Dispatch, Migration 178).
 *
 * Builds a printable warehouse pick list aggregated by product and variant.
 * One physical line per SKU/variant with the total units the picker has to
 * pull. Includes a wave code at the top so each batch is traceable end to
 * end (PDF, etiquettes, dispatch session, settlement).
 *
 * Same jsPDF stack as printLabelPDF.ts. Renders an A4 page with a clean
 * sans table, group rows for products with multiple variants, and a
 * footer summary.
 */

import * as shippingService from '@/services/shipping.service';
import type { PickListRow } from '@/services/shipping.service';

interface PickListGroup {
  productId: string | null;
  productName: string;
  variants: PickListRow[];
  totalForProduct: number;
}

interface PrintPickListOptions {
  orderIds: string[];
  waveCode?: string;
  storeName?: string;
  totalOrders?: number;
}

/**
 * Strips emojis and zero-width characters that pdfkit/jsPDF cannot render.
 */
function stripUnsafeChars(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .trim();
}

function groupByProduct(rows: PickListRow[]): PickListGroup[] {
  const map = new Map<string, PickListGroup>();

  for (const row of rows) {
    const key = row.product_id ?? `__${row.product_name || 'desconocido'}`;
    const existing = map.get(key);
    if (existing) {
      existing.variants.push(row);
      existing.totalForProduct += row.total_quantity;
    } else {
      map.set(key, {
        productId: row.product_id,
        productName: row.product_name || 'Sin nombre',
        variants: [row],
        totalForProduct: row.total_quantity,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName, 'es', { sensitivity: 'base' })
  );
}

function buildWaveCode(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const seq = String(now.getHours() * 60 + now.getMinutes()).padStart(4, '0');
  return `PD-${yyyy}${mm}${dd}-${seq}`;
}

export async function generatePickListPDF(
  options: PrintPickListOptions
): Promise<Blob> {
  const rows = await shippingService.getPickList(options.orderIds);

  if (rows.length === 0) {
    throw new Error('No hay items para generar el pick list');
  }

  const groups = groupByProduct(rows);
  const totalUnits = rows.reduce((sum, r) => sum + r.total_quantity, 0);
  const totalOrders = options.totalOrders ?? options.orderIds.length;
  const waveCode = options.waveCode || buildWaveCode();

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const PAGE_WIDTH = 210;
  const PAGE_HEIGHT = 297;
  const MARGIN = 15;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

  // ------- HEADER -------
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('PICK LIST', MARGIN, MARGIN + 6);

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  const headerRight = `Ola ${waveCode}`;
  pdf.text(headerRight, PAGE_WIDTH - MARGIN, MARGIN + 6, { align: 'right' });

  // Date row
  pdf.setFontSize(9);
  pdf.setTextColor(100, 100, 100);
  const fechaStr = new Date().toLocaleString('es-PY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  pdf.text(fechaStr, MARGIN, MARGIN + 11);
  if (options.storeName) {
    pdf.text(stripUnsafeChars(options.storeName), PAGE_WIDTH - MARGIN, MARGIN + 11, {
      align: 'right',
    });
  }
  pdf.setTextColor(0, 0, 0);

  // Header rule
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN, MARGIN + 14, PAGE_WIDTH - MARGIN, MARGIN + 14);

  // ------- TABLE HEADER -------
  let y = MARGIN + 21;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PRODUCTO', MARGIN, y);
  pdf.text('SKU', MARGIN + 110, y);
  pdf.text('CANT.', PAGE_WIDTH - MARGIN, y, { align: 'right' });

  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, y + 1.5, PAGE_WIDTH - MARGIN, y + 1.5);

  y += 7;

  // ------- ROWS -------
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);

  const lineHeight = 6;
  const groupGap = 2;
  const bottomLimit = PAGE_HEIGHT - MARGIN - 25;

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      pdf.addPage();
      y = MARGIN + 10;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.text('PRODUCTO', MARGIN, y);
      pdf.text('SKU', MARGIN + 110, y);
      pdf.text('CANT.', PAGE_WIDTH - MARGIN, y, { align: 'right' });
      pdf.setLineWidth(0.2);
      pdf.line(MARGIN, y + 1.5, PAGE_WIDTH - MARGIN, y + 1.5);
      y += 7;
      pdf.setFont('helvetica', 'normal');
    }
  };

  groups.forEach(group => {
    ensureSpace(lineHeight + 2);

    // Product row (bold, with total when there are multiple variants)
    pdf.setFont('helvetica', 'bold');
    const productName = stripUnsafeChars(group.productName);
    const truncatedName =
      productName.length > 65 ? productName.slice(0, 62) + '...' : productName;
    pdf.text(truncatedName, MARGIN, y);

    if (group.variants.length === 1 && !group.variants[0].variant_title) {
      // Single line: show SKU + qty inline
      const v = group.variants[0];
      if (v.sku) {
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(9);
        pdf.text(v.sku, MARGIN + 110, y);
        pdf.setFontSize(10);
      }
      pdf.setFont('helvetica', 'bold');
      pdf.text(group.totalForProduct.toString(), PAGE_WIDTH - MARGIN, y, {
        align: 'right',
      });
      y += lineHeight + groupGap;
    } else {
      pdf.text(group.totalForProduct.toString(), PAGE_WIDTH - MARGIN, y, {
        align: 'right',
      });
      y += lineHeight;

      // Variant rows
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      group.variants.forEach(v => {
        ensureSpace(lineHeight);
        const variantLabel = stripUnsafeChars(v.variant_title || 'Sin variante');
        pdf.text(`  ${variantLabel}`, MARGIN, y);
        if (v.sku) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(9);
          pdf.text(v.sku, MARGIN + 110, y);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
        }
        pdf.text(v.total_quantity.toString(), PAGE_WIDTH - MARGIN, y, {
          align: 'right',
        });
        y += lineHeight;
      });
      y += groupGap;
    }
  });

  // ------- FOOTER (totals) -------
  ensureSpace(20);
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN, y + 2, PAGE_WIDTH - MARGIN, y + 2);
  y += 9;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(
    `${totalOrders} pedidos`,
    MARGIN,
    y
  );
  pdf.text(
    `${totalUnits} unidades fisicas`,
    PAGE_WIDTH - MARGIN,
    y,
    { align: 'right' }
  );

  return pdf.output('blob');
}

/**
 * Convenience helper to generate and trigger printing the pick list PDF
 * in a single call.
 */
export async function printPickListPDF(
  options: PrintPickListOptions
): Promise<{ success: boolean; waveCode: string }> {
  const waveCode = options.waveCode || buildWaveCode();
  const blob = await generatePickListPDF({ ...options, waveCode });

  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank');

  if (!printWindow) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `pick-list-${waveCode}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { success: true, waveCode };
  }

  printWindow.onload = () => {
    setTimeout(() => printWindow.print(), 800);
  };

  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { success: true, waveCode };
}
