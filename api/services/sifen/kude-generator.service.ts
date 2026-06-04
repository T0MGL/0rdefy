/**
 * KUDE (Kyhyhera Umi Documentu Electroniko) PDF generator.
 *
 * Produces the legal human-readable representation of a Paraguay SIFEN
 * electronic invoice (Documento Electronico). Layout follows MT-SIFEN-010
 * section 10 "Representacion Grafica":
 *
 *   - Header: emisor (razon social, RUC, timbrado, domicilio)
 *   - Receptor: nombre, RUC o cedula, direccion
 *   - Cabecera: tipo de documento, numero, CDC, fecha de emision,
 *               condicion de venta, moneda
 *   - Detalle: items con codigo / descripcion / cantidad / precio /
 *              IVA / subtotal
 *   - Totales: subtotal, IVA 10%, IVA 5%, total
 *   - Pie: CDC en texto plano, QR con URL oficial (ekuatia.set.gov.py),
 *          leyenda "Consulte la validez de este documento..."
 *
 * Output: in-memory Buffer. No disk I/O. Caller decides what to do with it
 * (attach to email, stream to HTTP, store in Supabase storage).
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger';

// Brand mark: we embed the Ordefy favicon (square icon, no wordmark).
// The wordmark version looked crowded in the corner; a small square mark
// reads much cleaner at invoice scale (Anthropic / Stripe pattern).
//
// __dirname is not available under ESM (Railway runs via tsx/ESM loader),
// so we derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAVICON_PATH = path.join(__dirname, 'ordefy-favicon.png');
const FAVICON_BUFFER: Buffer | null = (() => {
  try {
    return fs.readFileSync(FAVICON_PATH);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[KUDE] Ordefy favicon not found at ${FAVICON_PATH}: ${msg}`);
    return null;
  }
})();
const FAVICON_ASPECT = 1088 / 960; // real pixel dims of the bundled PNG

// ================================================================
// Types
// ================================================================

export interface KudeItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  ivaRate: 0 | 5 | 10;
  subtotal: number;
}

export interface KudeEmitter {
  razonSocial: string;
  nombreFantasia?: string | null;
  ruc: string;
  rucDv: number;
  timbrado: string;
  timbradoInicio?: string | null;
  establecimientoCodigo: string;
  puntoExpedicion: string;
  direccion?: string | null;
  ciudadDescripcion?: string | null;
  telefono?: string | null;
  email?: string | null;
  actividadEconomica?: string | null;
}

export interface KudeReceiver {
  nombre: string;
  ruc?: string | null;
  rucDv?: number | null;
  documentoTipo?: 'CI' | 'RUC' | null;
  documentoNumero?: string | null;
  direccion?: string | null;
  email?: string | null;
}

export interface KudeTotals {
  subtotal: number;
  iva10: number;
  iva5: number;
  ivaExento: number;
  total: number;
}

export type KudeTipoDocumento = 1 | 5 | 6;

export interface KudeInput {
  tipoDocumento: KudeTipoDocumento;
  documentNumber: number;
  cdc: string;
  fechaEmision: string; // ISO 8601
  emitter: KudeEmitter;
  receiver: KudeReceiver;
  items: KudeItem[];
  totals: KudeTotals;
  qrUrl: string; // official SIFEN consulta URL
  condicionVenta?: 'Contado' | 'Credito';
  moneda?: string;
  environment: 'demo' | 'test' | 'prod';
}

// ================================================================
// Formatting helpers
// ================================================================

function formatPyg(amount: number): string {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Unit-price formatter for the line table. Guaraní (PYG) has no cents, and the
 * fiscal line builder guarantees an INTEGER precioUnitario on every line (clean
 * divides stay one line, non-dividing prices split into two integer-priced
 * lines). So the unit price is rendered as whole Guaraníes with the PY
 * thousands separator '.' and no decimal part: 174500 -> "174.500",
 * 163000 -> "163.000". round() is a defensive floor against any stray float.
 */
function formatUnitPrice(amount: number): string {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  } catch {
    return iso;
  }
}

const TIPO_DOC_LABELS: Record<KudeTipoDocumento, string> = {
  1: 'FACTURA ELECTRONICA',
  5: 'NOTA DE CREDITO ELECTRONICA',
  6: 'NOTA DE DEBITO ELECTRONICA',
};

// ================================================================
// Main generator
// ================================================================

/**
 * Render the KUDE to a Buffer. Throws on fatal errors (QR generation
 * failure, pdfkit crash). Callers should catch and either retry or
 * surface to owner_alerts.
 */
export async function generateKudePdf(input: KudeInput): Promise<Buffer> {
  const qrDataUrl = await generateQrDataUrl(input.qrUrl);
  const qrImageBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 36, // 0.5 inch
        info: {
          Title: `${TIPO_DOC_LABELS[input.tipoDocumento]} ${input.documentNumber}`,
          Author: input.emitter.razonSocial,
          Subject: `CDC ${input.cdc}`,
          Creator: 'Ordefy',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));

      renderHeader(doc, input);
      renderReceiver(doc, input);
      renderItemsTable(doc, input);
      renderTotals(doc, input);
      renderFooter(doc, input, qrImageBuffer);

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ================================================================
// QR data url (PNG base64)
// ================================================================

async function generateQrDataUrl(url: string): Promise<string> {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      margin: 1,
      scale: 6,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[KUDE] QR generation failed: ${msg}`);
    throw new Error(`KUDE QR generation failed: ${msg}`);
  }
}

// ================================================================
// Sections
// ================================================================

function renderHeader(doc: PDFKit.PDFDocument, input: KudeInput): void {
  const { emitter } = input;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const topY = doc.page.margins.top;

  // Column geometry: strict split, 55% left / 38% right with a 7% gutter.
  const leftWidth = pageWidth * 0.55;
  const rightWidth = pageWidth * 0.38;
  const rightX = leftX + pageWidth - rightWidth;

  // --- TOP-RIGHT: Ordefy favicon (square mark, Anthropic-style) ---
  // Sits above the timbrado box, right-aligned. Clickable to ordefy.io.
  let timbradoTopY = topY;
  if (FAVICON_BUFFER) {
    const iconHeight = 24;
    const iconWidth = iconHeight * FAVICON_ASPECT;
    const iconX = leftX + pageWidth - iconWidth;
    const iconY = topY;
    try {
      doc.image(FAVICON_BUFFER, iconX, iconY, { height: iconHeight });
      doc.link(iconX, iconY, iconWidth, iconHeight, 'https://ordefy.io');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[KUDE] Embedding Ordefy favicon failed: ${msg}`);
    }
    timbradoTopY = topY + iconHeight + 10;
  }

  // --- LEFT COLUMN: emitter identity ---
  let ly = topY;

  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor('#0F172A')
    .text(emitter.nombreFantasia || emitter.razonSocial, leftX, ly, { width: leftWidth });
  ly = doc.y + 6;

  const emitterLines: string[] = [];
  if (emitter.nombreFantasia && emitter.nombreFantasia !== emitter.razonSocial) {
    emitterLines.push(`Razon Social: ${emitter.razonSocial}`);
  }
  emitterLines.push(`RUC: ${emitter.ruc}-${emitter.rucDv}`);
  const domicilio = [emitter.direccion, emitter.ciudadDescripcion].filter(Boolean).join(', ');
  if (domicilio) emitterLines.push(domicilio);
  if (emitter.telefono) emitterLines.push(`Tel: ${emitter.telefono}`);
  if (emitter.email) emitterLines.push(emitter.email);
  if (emitter.actividadEconomica) emitterLines.push(`Actividad: ${emitter.actividadEconomica}`);

  doc.font('Helvetica').fontSize(9).fillColor('#334155');
  for (const line of emitterLines) {
    doc.text(line, leftX, ly, { width: leftWidth });
    ly = doc.y + 1;
  }

  // --- RIGHT COLUMN: timbrado + document identification ---
  // Fixed-height box, starts below the wordmark.
  const boxPadX = 10;
  const boxPadY = 10;
  const lineGap = 12;
  const boxHeight = boxPadY + lineGap * 4 + 8;

  doc
    .save()
    .roundedRect(rightX, timbradoTopY, rightWidth, boxHeight, 4)
    .strokeColor('#CBD5E1')
    .lineWidth(0.8)
    .stroke()
    .restore();

  let ry = timbradoTopY + boxPadY;

  const kv = (label: string, value: string) => {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#64748B')
      .text(label.toUpperCase(), rightX + boxPadX, ry, { width: rightWidth - boxPadX * 2 });
    ry += 10;
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#0F172A')
      .text(value, rightX + boxPadX, ry, { width: rightWidth - boxPadX * 2 });
    ry += 14;
  };

  kv('Timbrado', emitter.timbrado);
  if (emitter.timbradoInicio) kv('Inicio de Vigencia', emitter.timbradoInicio);

  // Doc type title sits below the timbrado box
  const titleY = timbradoTopY + boxHeight + 10;
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#0F172A')
    .text(TIPO_DOC_LABELS[input.tipoDocumento], rightX, titleY, {
      width: rightWidth,
      align: 'right',
    });

  const docNumberFormatted = String(input.documentNumber).padStart(7, '0');
  const serie = `${emitter.establecimientoCodigo}-${emitter.puntoExpedicion}-${docNumberFormatted}`;

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#0F172A')
    .text(serie, rightX, titleY + 16, { width: rightWidth, align: 'right' });

  // Compute the floor of both columns and advance cursor past the taller one.
  // Tightened gap (was +10) so the receiver block sits closer to the emitter.
  const rightFloor = titleY + 16 + 22;
  const leftFloor = ly;
  doc.y = Math.max(leftFloor, rightFloor) + 6;
  doc.x = leftX;
  doc.fillColor('#000000');
}

function renderReceiver(doc: PDFKit.PDFDocument, input: KudeInput): void {
  const { receiver } = input;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const startY = doc.y;

  const padX = 12;
  const padY = 10;

  // Build lines first so we can size the box to fit.
  const lines: Array<{ label: string; value: string }> = [];
  lines.push({ label: 'Nombre / Razon Social', value: receiver.nombre });

  if (receiver.ruc && receiver.rucDv !== null && receiver.rucDv !== undefined) {
    lines.push({ label: 'RUC', value: `${receiver.ruc}-${receiver.rucDv}` });
  } else if (receiver.documentoNumero) {
    const tipo = receiver.documentoTipo || 'CI';
    lines.push({ label: tipo, value: receiver.documentoNumero });
  }
  if (receiver.email) lines.push({ label: 'Email', value: receiver.email });
  if (receiver.direccion) lines.push({ label: 'Direccion', value: receiver.direccion });

  const headerH = 16;
  const rowH = 14;
  const boxHeight = padY + headerH + lines.length * rowH + padY;

  doc
    .save()
    .roundedRect(leftX, startY, pageWidth, boxHeight, 4)
    .strokeColor('#CBD5E1')
    .lineWidth(0.8)
    .stroke()
    .restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#64748B')
    .text('DATOS DEL COMPRADOR', leftX + padX, startY + padY, {
      width: pageWidth - padX * 2,
      characterSpacing: 0.5,
    });

  let ry = startY + padY + headerH;
  for (const { label, value } of lines) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#64748B')
      .text(`${label}:`, leftX + padX, ry, { width: 140, continued: false });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#0F172A')
      .text(value, leftX + padX + 140, ry, { width: pageWidth - padX * 2 - 140 });
    ry += rowH;
  }

  doc.y = startY + boxHeight + 12;
  doc.x = leftX;
}

function renderItemsTable(doc: PDFKit.PDFDocument, input: KudeInput): void {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;

  const cols = {
    codigo: { x: leftX, width: 50 },
    descripcion: { x: leftX + 50, width: pageWidth - 50 - 40 - 75 - 45 - 75 },
    cantidad: { x: 0, width: 40 },
    precio: { x: 0, width: 75 },
    iva: { x: 0, width: 45 },
    subtotal: { x: 0, width: 75 },
  };
  cols.cantidad.x = cols.descripcion.x + cols.descripcion.width;
  cols.precio.x = cols.cantidad.x + cols.cantidad.width;
  cols.iva.x = cols.precio.x + cols.precio.width;
  cols.subtotal.x = cols.iva.x + cols.iva.width;

  const headerY = doc.y;
  doc
    .save()
    .rect(leftX, headerY, pageWidth, 18)
    .fillColor('#F3F4F6')
    .fill()
    .restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#000000')
    .text('Codigo', cols.codigo.x + 4, headerY + 5, { width: cols.codigo.width - 8 })
    .text('Descripcion', cols.descripcion.x + 4, headerY + 5, { width: cols.descripcion.width - 8 })
    .text('Cant.', cols.cantidad.x, headerY + 5, { width: cols.cantidad.width, align: 'center' })
    .text('Precio unit.', cols.precio.x, headerY + 5, { width: cols.precio.width - 4, align: 'right' })
    .text('IVA', cols.iva.x, headerY + 5, { width: cols.iva.width, align: 'center' })
    .text('Subtotal', cols.subtotal.x, headerY + 5, { width: cols.subtotal.width - 4, align: 'right' });

  let y = headerY + 20;

  doc.font('Helvetica').fontSize(9).fillColor('#000000');

  for (const item of input.items) {
    const ivaLabel = item.ivaRate === 0 ? 'Exento' : `${item.ivaRate}%`;
    const descriptionHeight = doc.heightOfString(item.descripcion, {
      width: cols.descripcion.width - 8,
    });
    const rowHeight = Math.max(16, descriptionHeight + 6);

    // Zebra background (light)
    if (input.items.indexOf(item) % 2 === 1) {
      doc
        .save()
        .rect(leftX, y - 2, pageWidth, rowHeight + 2)
        .fillColor('#FAFAFA')
        .fill()
        .restore();
    }

    doc
      .fillColor('#000000')
      .text(item.codigo, cols.codigo.x + 4, y, { width: cols.codigo.width - 8 })
      .text(item.descripcion, cols.descripcion.x + 4, y, { width: cols.descripcion.width - 8 })
      .text(formatPyg(item.cantidad), cols.cantidad.x, y, { width: cols.cantidad.width, align: 'center' })
      .text(formatUnitPrice(item.precioUnitario), cols.precio.x, y, { width: cols.precio.width - 4, align: 'right' })
      .text(ivaLabel, cols.iva.x, y, { width: cols.iva.width, align: 'center' })
      .text(formatPyg(item.subtotal), cols.subtotal.x, y, { width: cols.subtotal.width - 4, align: 'right' });

    y += rowHeight;

    // Pagination guard: if next row would overflow, add new page.
    if (y > doc.page.height - doc.page.margins.bottom - 160) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }

  // Bottom border of table
  doc
    .save()
    .moveTo(leftX, y)
    .lineTo(leftX + pageWidth, y)
    .strokeColor('#CCCCCC')
    .lineWidth(0.5)
    .stroke()
    .restore();

  doc.y = y + 6;
  doc.x = leftX;
}

function renderTotals(doc: PDFKit.PDFDocument, input: KudeInput): void {
  const { totals } = input;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const boxX = leftX + pageWidth * 0.55;
  const boxWidth = pageWidth * 0.45;
  const startY = doc.y + 4;

  let y = startY;
  const renderRow = (label: string, amount: number, bold = false) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 11 : 9)
      .fillColor('#000000')
      .text(label, boxX, y, { width: boxWidth / 2, align: 'left' })
      .text(`${formatPyg(amount)} Gs`, boxX + boxWidth / 2, y, {
        width: boxWidth / 2,
        align: 'right',
      });
    y += bold ? 16 : 13;
  };

  renderRow('Subtotal', totals.subtotal);
  if (totals.iva10 > 0) renderRow('IVA 10%', totals.iva10);
  if (totals.iva5 > 0) renderRow('IVA 5%', totals.iva5);
  if (totals.ivaExento > 0) renderRow('Exento', totals.ivaExento);

  // Divider
  doc
    .save()
    .moveTo(boxX, y + 1)
    .lineTo(boxX + boxWidth, y + 1)
    .strokeColor('#000000')
    .lineWidth(0.8)
    .stroke()
    .restore();
  y += 6;

  renderRow('TOTAL', totals.total, true);

  doc.y = y + 4;
  doc.x = leftX;
}

function renderFooter(
  doc: PDFKit.PDFDocument,
  input: KudeInput,
  qrImageBuffer: Buffer,
): void {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const footerHeight = 140;
  const bottomY = doc.page.height - doc.page.margins.bottom - footerHeight;

  // Anchor footer to the bottom of the current page.
  doc.y = Math.max(doc.y, bottomY);
  const startY = doc.y;

  // Thin separator line above the footer.
  doc
    .save()
    .moveTo(leftX, startY)
    .lineTo(leftX + pageWidth, startY)
    .strokeColor('#E2E8F0')
    .lineWidth(0.6)
    .stroke()
    .restore();

  const qrSize = 96;
  const qrX = leftX;
  const qrY = startY + 14;

  try {
    doc.image(qrImageBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[KUDE] Embedding QR image failed: ${msg}`);
  }

  // Right column: metadata in label/value rows, same pattern as receiver.
  const metaX = qrX + qrSize + 18;
  const metaWidth = pageWidth - qrSize - 18;
  let my = qrY;

  const metaRow = (label: string, value: string, mono = false) => {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#64748B')
      .text(label.toUpperCase(), metaX, my, { width: metaWidth, characterSpacing: 0.4 });
    my += 10;
    doc
      .font(mono ? 'Courier' : 'Helvetica-Bold')
      .fontSize(mono ? 10 : 10)
      .fillColor('#0F172A')
      .text(value, metaX, my, { width: metaWidth });
    my += mono ? 16 : 14;
    my += 4;
  };

  metaRow('CDC (Codigo de Control)', input.cdc, true);
  metaRow('Fecha de Emision', formatDate(input.fechaEmision));
  metaRow('Condicion de Venta', input.condicionVenta || 'Contado');

  // Legend centered below both columns.
  const legendY = startY + footerHeight - 28;
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#64748B')
    .text(
      'Consulte la validez de este documento en ekuatia.set.gov.py/consultas con el CDC.',
      leftX,
      legendY,
      { width: pageWidth, align: 'center' },
    );

  // Brand line: text-only. Logo lives in the top-right corner, not in
  // the footer. 'Ordefy' is a clickable link.
  //
  // NOTE: pdfkit's combination of { lineBreak: false, link: '...' } on
  // text() yields NaN in the annotation's height when finalizing the
  // PDF (pdfkit can't measure unbounded inline text). Workaround: draw
  // the text, then overlay a doc.link() rectangle with explicit coords.
  const brandY = legendY + 14;
  const prefix = 'Generado por ';
  const brand = 'Ordefy';
  const suffix = '  \u00b7  Documento electronico aprobado por la DNIT.';

  doc.font('Helvetica-Oblique').fontSize(8);
  const prefixWidth = doc.widthOfString(prefix);
  doc.font('Helvetica-Bold').fontSize(8);
  const brandWidth = doc.widthOfString(brand);
  const brandHeight = doc.currentLineHeight();
  doc.font('Helvetica-Oblique').fontSize(8);
  const suffixWidth = doc.widthOfString(suffix);
  const totalWidth = prefixWidth + brandWidth + suffixWidth;
  const startX = leftX + (pageWidth - totalWidth) / 2;

  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#64748B')
    .text(prefix, startX, brandY, { lineBreak: false });

  const brandX = startX + prefixWidth;
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#0F172A')
    .text(brand, brandX, brandY, { lineBreak: false });
  doc.link(brandX, brandY, brandWidth, brandHeight, 'https://ordefy.io');

  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#64748B')
    .text(suffix, brandX + brandWidth, brandY, { lineBreak: false });
}
