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
import { logger } from '../../utils/logger';

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

  // Left block: emitter data
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#000000')
    .text(emitter.nombreFantasia || emitter.razonSocial, leftX, topY, { width: pageWidth * 0.55 });

  doc.moveDown(0.2);

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#333333')
    .text(`Razon Social: ${emitter.razonSocial}`, { width: pageWidth * 0.55 });

  doc.text(`RUC: ${emitter.ruc}-${emitter.rucDv}`);

  if (emitter.direccion) {
    const line = [emitter.direccion, emitter.ciudadDescripcion].filter(Boolean).join(', ');
    doc.text(line);
  }
  if (emitter.telefono) doc.text(`Tel: ${emitter.telefono}`);
  if (emitter.email) doc.text(`Email: ${emitter.email}`);
  if (emitter.actividadEconomica) doc.text(`Actividad: ${emitter.actividadEconomica}`);

  // Right block: document identification
  const rightX = leftX + pageWidth * 0.6;
  const rightWidth = pageWidth * 0.4;

  doc
    .save()
    .rect(rightX, topY, rightWidth, 86)
    .strokeColor('#000000')
    .lineWidth(0.8)
    .stroke()
    .restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#000000')
    .text('Timbrado N.', rightX + 6, topY + 6, { width: rightWidth - 12 });

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(emitter.timbrado, rightX + 6, topY + 20, { width: rightWidth - 12 });

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('Inicio de Vigencia', rightX + 6, topY + 36, { width: rightWidth - 12 });

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(emitter.timbradoInicio || '-', rightX + 6, topY + 50, { width: rightWidth - 12 });

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(TIPO_DOC_LABELS[input.tipoDocumento], rightX + 6, topY + 66, { width: rightWidth - 12, align: 'center' });

  // Below the right box: document number
  const docNumberFormatted = String(input.documentNumber).padStart(7, '0');
  const serie = `${emitter.establecimientoCodigo}-${emitter.puntoExpedicion}-${docNumberFormatted}`;

  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor('#000000')
    .text(serie, rightX, topY + 92, { width: rightWidth, align: 'center' });

  // Environment badge for non-prod
  if (input.environment !== 'prod') {
    const badgeColor = input.environment === 'demo' ? '#8B5CF6' : '#EAB308';
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(badgeColor)
      .text(`[${input.environment.toUpperCase()}]`, rightX, topY + 112, {
        width: rightWidth,
        align: 'center',
      });
  }

  // Move cursor below header block
  doc.y = topY + 140;
  doc.x = leftX;
  doc.fillColor('#000000');
}

function renderReceiver(doc: PDFKit.PDFDocument, input: KudeInput): void {
  const { receiver } = input;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const startY = doc.y;

  doc
    .save()
    .rect(leftX, startY, pageWidth, 64)
    .strokeColor('#000000')
    .lineWidth(0.8)
    .stroke()
    .restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#333333')
    .text('DATOS DEL COMPRADOR', leftX + 6, startY + 6);

  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  doc.text(`Nombre / Razon Social: ${receiver.nombre}`, leftX + 6, doc.y);

  const docLine: string[] = [];
  if (receiver.ruc && receiver.rucDv !== null && receiver.rucDv !== undefined) {
    docLine.push(`RUC: ${receiver.ruc}-${receiver.rucDv}`);
  } else if (receiver.documentoNumero) {
    const tipo = receiver.documentoTipo || 'CI';
    docLine.push(`${tipo}: ${receiver.documentoNumero}`);
  } else {
    docLine.push('Documento: sin identificar');
  }
  if (receiver.email) docLine.push(`Email: ${receiver.email}`);
  doc.text(docLine.join('    '), leftX + 6, doc.y);

  if (receiver.direccion) {
    doc.text(`Direccion: ${receiver.direccion}`, leftX + 6, doc.y);
  }

  doc.y = startY + 72;
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
      .text(formatPyg(item.precioUnitario), cols.precio.x, y, { width: cols.precio.width - 4, align: 'right' })
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
  const footerHeight = 120;
  const bottomY = doc.page.height - doc.page.margins.bottom - footerHeight;

  // Anchor footer to the bottom of the current page.
  doc.y = Math.max(doc.y, bottomY);
  const startY = doc.y;

  const qrSize = 90;
  const qrX = leftX;
  const qrY = startY + 4;

  try {
    doc.image(qrImageBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[KUDE] Embedding QR image failed: ${msg}`);
  }

  const textX = qrX + qrSize + 12;
  const textWidth = pageWidth - qrSize - 12;

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#000000')
    .text('CDC (Codigo de Control)', textX, qrY, { width: textWidth });

  doc
    .font('Courier')
    .fontSize(10)
    .text(input.cdc, textX, qrY + 12, { width: textWidth });

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('Fecha de Emision', textX, qrY + 34, { width: textWidth });

  doc
    .font('Helvetica')
    .fontSize(9)
    .text(formatDate(input.fechaEmision), textX, qrY + 46, { width: textWidth });

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('Condicion de Venta', textX, qrY + 60, { width: textWidth });

  doc
    .font('Helvetica')
    .fontSize(9)
    .text(input.condicionVenta || 'Contado', textX, qrY + 72, { width: textWidth });

  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#555555')
    .text(
      'Consulte la validez de este documento en https://ekuatia.set.gov.py/consultas/ con el CDC.',
      leftX,
      qrY + qrSize + 8,
      { width: pageWidth, align: 'center' },
    );

  doc
    .font('Helvetica-Oblique')
    .fontSize(7)
    .fillColor('#777777')
    .text(
      'KUDE generado por Ordefy. Documento electronico aprobado por la DNIT.',
      leftX,
      qrY + qrSize + 22,
      { width: pageWidth, align: 'center' },
    );
}
