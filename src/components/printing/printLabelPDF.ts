/**
 * PDF-based label printing system
 * Generates exact 4x6 inch PDFs for thermal label printers
 * Triggers browser print dialog directly using hidden iframe
 */

import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

interface LabelData {
  storeName: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  neighborhood?: string;
  city?: string;
  addressReference?: string;
  carrierName?: string;
  codAmount?: number;
  totalPrice?: number; // Fallback when codAmount is 0
  paymentMethod?: string;
  paymentGateway?: string; // From Shopify: 'cash_on_delivery', 'shopify_payments', etc.
  financialStatus?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided';
  deliveryToken: string;
  items: Array<{
    name: string;
    quantity: number;
    price?: number;
  }>;
}

/**
 * Strips emojis and special Unicode characters from text for PDF rendering
 */
function stripEmojis(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '') // Variation selectors
    .replace(/[\u{200D}]/gu, '') // Zero width joiner
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a single 4x6 shipping label as PDF
 */
export async function generateLabelPDF(data: LabelData): Promise<Blob> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: [4, 6],
    compress: true
  });

  // Generate QR code
  const deliveryUrl = `${window.location.origin}/delivery/${data.deliveryToken}`;
  const qrDataUrl = await QRCode.toDataURL(deliveryUrl, {
    width: 400,
    margin: 0,
    color: { dark: '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'M'
  });

  // Determine payment status
  const isPaidByShopify = data.financialStatus === 'paid' || data.financialStatus === 'authorized';
  const isCODGateway = data.paymentGateway === 'cash_on_delivery' ||
                       data.paymentGateway === 'cod' ||
                       data.paymentGateway === 'manual';
  const isCODMethod = data.paymentMethod === 'cash' ||
                      data.paymentMethod === 'efectivo' ||
                      data.paymentMethod === 'cod' ||
                      data.paymentMethod === 'cash_on_delivery';

  // Get amount to collect - use codAmount if available, otherwise totalPrice
  const amountToCollect = (data.codAmount && data.codAmount > 0) ? data.codAmount : (data.totalPrice || 0);
  const hasAmountToCollect = amountToCollect > 0;

  // COD logic: gateway says COD, OR has amount AND not paid online
  const isCOD = !isPaidByShopify && (isCODGateway || isCODMethod || hasAmountToCollect);

  console.log('🔍 [PDF] Payment check:', {
    paymentGateway: data.paymentGateway,
    financialStatus: data.financialStatus,
    codAmount: data.codAmount,
    totalPrice: data.totalPrice,
    amountToCollect,
    isCOD,
    isPaidByShopify
  });

  // Draw label
  drawLabel(pdf, data, qrDataUrl, isCOD, amountToCollect);

  return pdf.output('blob');
}

/**
 * Core label drawing function - used by both single and batch
 */
function drawLabel(
  pdf: jsPDF,
  data: LabelData,
  qrDataUrl: string,
  isCOD: boolean,
  amountToCollect: number
) {
  const PAGE_WIDTH = 4;
  const PAGE_HEIGHT = 6;
  const MARGIN = 0.1;
  const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

  // Clean text data
  const customerName = stripEmojis(data.customerName).toUpperCase();
  const customerAddress = stripEmojis(data.customerAddress || '');
  const neighborhood = stripEmojis(data.neighborhood || '');
  const city = stripEmojis(data.city || '');
  const addressRef = stripEmojis(data.addressReference || '');

  // === WATERMARK (draw first, behind everything) ===
  pdf.saveGraphicsState();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(80);
  pdf.setTextColor(230, 230, 230); // More visible gray
  pdf.text('ORDEFY', PAGE_WIDTH / 2, PAGE_HEIGHT / 2, {
    align: 'center',
    angle: -45
  });
  pdf.restoreGraphicsState();
  pdf.setTextColor(0, 0, 0);

  // === OUTER BORDER ===
  pdf.setLineWidth(0.03);
  pdf.setDrawColor(0, 0, 0);
  pdf.rect(MARGIN, MARGIN, CONTENT_WIDTH, PAGE_HEIGHT - (MARGIN * 2));

  // === ZONE A: HEADER (0.5in) ===
  const headerY = MARGIN;
  const headerHeight = 0.5;

  // Store name
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(stripEmojis(data.storeName).toUpperCase(), MARGIN + 0.08, headerY + 0.32, { maxWidth: 2.2 });

  // Order number - large and prominent
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  const orderText = `##${data.orderNumber}`;
  pdf.text(orderText, PAGE_WIDTH - MARGIN - 0.08, headerY + 0.35, { align: 'right' });

  // Header separator
  pdf.setLineWidth(0.02);
  pdf.line(MARGIN, headerY + headerHeight, PAGE_WIDTH - MARGIN, headerY + headerHeight);

  // === ZONE B: ADDRESS (1.9in fixed height) ===
  const addressZoneY = headerY + headerHeight;
  const addressZoneHeight = 1.9;

  // "ENTREGAR A" label
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text('ENTREGAR A / SHIP TO:', MARGIN + 0.08, addressZoneY + 0.18);

  // Customer name - max 2 lines, font size adapts
  let nameFontSize = 18;
  pdf.setFontSize(nameFontSize);
  pdf.setFont('helvetica', 'bold');
  let nameLines = pdf.splitTextToSize(customerName, CONTENT_WIDTH - 0.16);

  // If name is too long, reduce font
  if (nameLines.length > 2) {
    nameFontSize = 15;
    pdf.setFontSize(nameFontSize);
    nameLines = pdf.splitTextToSize(customerName, CONTENT_WIDTH - 0.16);
  }

  const displayNameLines = nameLines.slice(0, 2);
  const nameY = addressZoneY + 0.4;
  const lineHeight = nameFontSize * 0.018; // Approximate line height in inches

  pdf.text(displayNameLines, MARGIN + 0.08, nameY);

  // Address section - positioned after name
  const addressStartY = nameY + (displayNameLines.length * lineHeight) + 0.12;

  // Build address text
  let fullAddress = customerAddress;
  if (neighborhood) {
    fullAddress += fullAddress ? `, ${neighborhood}` : neighborhood;
  }

  if (fullAddress) {
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    const addrLines = pdf.splitTextToSize(fullAddress, CONTENT_WIDTH - 0.16);
    pdf.text(addrLines.slice(0, 2), MARGIN + 0.08, addressStartY);
  }

  // City / Reference - smaller text
  const detailsY = addressStartY + 0.35;
  if (city || addressRef) {
    pdf.setFontSize(10);
    let detailText = city || '';
    if (addressRef) {
      detailText += detailText ? ` | REF: ${addressRef}` : `REF: ${addressRef}`;
    }
    const detailLines = pdf.splitTextToSize(detailText, CONTENT_WIDTH - 0.16);
    pdf.text(detailLines[0] || '', MARGIN + 0.08, detailsY);
  }

  // Phone - always at fixed position near bottom of address zone (with clearance from separator)
  const phoneY = addressZoneY + addressZoneHeight - 0.35;
  pdf.setFontSize(13);
  pdf.setFont('courier', 'bold');
  const phoneText = `TEL: ${data.customerPhone}`;
  const phoneWidth = pdf.getTextWidth(phoneText) + 0.12;

  pdf.setLineWidth(0.02);
  pdf.rect(MARGIN + 0.08, phoneY - 0.12, phoneWidth, 0.22);
  pdf.text(phoneText, MARGIN + 0.14, phoneY);

  // Address zone separator
  pdf.setLineWidth(0.02);
  pdf.line(MARGIN, addressZoneY + addressZoneHeight, PAGE_WIDTH - MARGIN, addressZoneY + addressZoneHeight);

  // === ZONE C: QR + PAYMENT (1.8in) ===
  const actionZoneY = addressZoneY + addressZoneHeight;
  const actionZoneHeight = 1.8;

  // QR Code (left side)
  const qrSize = 1.4;
  const qrX = MARGIN + 0.15;
  const qrY = actionZoneY + 0.2;
  pdf.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

  // Vertical separator
  const separatorX = MARGIN + 1.7;
  pdf.setLineWidth(0.01);
  pdf.setDrawColor(180, 180, 180);
  pdf.line(separatorX, actionZoneY + 0.05, separatorX, actionZoneY + actionZoneHeight - 0.05);
  pdf.setDrawColor(0, 0, 0);

  // Payment box (right side)
  const paymentBoxX = separatorX + 0.12;
  const paymentBoxWidth = PAGE_WIDTH - MARGIN - paymentBoxX - 0.08;
  const paymentBoxY = actionZoneY + 0.15;
  const paymentBoxHeight = 0.7;

  if (isCOD) {
    // COD - Black filled box
    pdf.setFillColor(0, 0, 0);
    pdf.rect(paymentBoxX, paymentBoxY, paymentBoxWidth, paymentBoxHeight, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('COBRAR', paymentBoxX + paymentBoxWidth / 2, paymentBoxY + 0.25, { align: 'center' });

    pdf.setFontSize(16);
    pdf.text(`Gs. ${amountToCollect.toLocaleString('es-PY')}`, paymentBoxX + paymentBoxWidth / 2, paymentBoxY + 0.52, { align: 'center' });

    pdf.setTextColor(0, 0, 0);
  } else {
    // PAID - Outlined box
    pdf.setLineWidth(0.03);
    pdf.rect(paymentBoxX, paymentBoxY, paymentBoxWidth, paymentBoxHeight);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('PAGADO', paymentBoxX + paymentBoxWidth / 2, paymentBoxY + 0.35, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const statusText = data.financialStatus === 'authorized' ? 'AUTORIZADO' :
                       data.financialStatus === 'paid' ? 'CONFIRMADO' : 'STANDARD';
    pdf.text(statusText, paymentBoxX + paymentBoxWidth / 2, paymentBoxY + 0.55, { align: 'center' });
  }

  // Carrier info
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  const carrierText = `DELIVERY: ${data.carrierName || 'PROPIO'}`;
  pdf.text(carrierText, paymentBoxX + paymentBoxWidth / 2, actionZoneY + 1.45, { align: 'center' });

  // Action zone separator
  pdf.setLineWidth(0.02);
  pdf.line(MARGIN, actionZoneY + actionZoneHeight, PAGE_WIDTH - MARGIN, actionZoneY + actionZoneHeight);

  // === ZONE D: PACKING LIST (remaining space ~1.7in) ===
  const packingY = actionZoneY + actionZoneHeight;

  // Table header
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('QTY', MARGIN + 0.25, packingY + 0.18, { align: 'center' });
  pdf.text('ITEM', MARGIN + 0.55, packingY + 0.18);

  pdf.setLineWidth(0.01);
  pdf.line(MARGIN + 0.08, packingY + 0.22, PAGE_WIDTH - MARGIN - 0.08, packingY + 0.22);

  // Items
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  let itemY = packingY + 0.4;
  const maxItems = 4;
  const itemsToShow = data.items.slice(0, maxItems);

  itemsToShow.forEach((item) => {
    pdf.text(item.quantity.toString(), MARGIN + 0.25, itemY, { align: 'center' });

    let itemName = stripEmojis(item.name);
    // Truncate if too long
    const maxNameWidth = CONTENT_WIDTH - 0.7;
    while (pdf.getTextWidth(itemName) > maxNameWidth && itemName.length > 10) {
      itemName = itemName.slice(0, -4) + '...';
    }
    pdf.text(itemName, MARGIN + 0.55, itemY);

    // Light separator
    pdf.setDrawColor(220, 220, 220);
    pdf.line(MARGIN + 0.08, itemY + 0.06, PAGE_WIDTH - MARGIN - 0.08, itemY + 0.06);
    pdf.setDrawColor(0, 0, 0);

    itemY += 0.28;
  });

  // Show more items indicator
  if (data.items.length > maxItems) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.text(`+${data.items.length - maxItems} items más`, MARGIN + 0.55, itemY);
  }
}

/**
 * Generates a multi-page PDF with multiple labels
 */
export async function generateBatchLabelsPDF(labels: LabelData[]): Promise<Blob> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: [4, 6],
    compress: true
  });

  for (let i = 0; i < labels.length; i++) {
    if (i > 0) {
      pdf.addPage([4, 6], 'portrait');
    }

    const data = labels[i];
    const deliveryUrl = `${window.location.origin}/delivery/${data.deliveryToken}`;
    const qrDataUrl = await QRCode.toDataURL(deliveryUrl, {
      width: 400,
      margin: 0,
      errorCorrectionLevel: 'M'
    });

    const isPaidByShopify = data.financialStatus === 'paid' || data.financialStatus === 'authorized';
    const isCODGateway = data.paymentGateway === 'cash_on_delivery' ||
                         data.paymentGateway === 'cod' ||
                         data.paymentGateway === 'manual';
    const isCODMethod = data.paymentMethod === 'cash' ||
                        data.paymentMethod === 'efectivo' ||
                        data.paymentMethod === 'cod' ||
                        data.paymentMethod === 'cash_on_delivery';

    const amountToCollect = (data.codAmount && data.codAmount > 0) ? data.codAmount : (data.totalPrice || 0);
    const hasAmountToCollect = amountToCollect > 0;
    const isCOD = !isPaidByShopify && (isCODGateway || isCODMethod || hasAmountToCollect);

    drawLabel(pdf, data, qrDataUrl, isCOD, amountToCollect);
  }

  return pdf.output('blob');
}

/**
 * Opens the PDF in a new window/tab for printing
 */
export async function triggerDirectPrint(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank');

  if (!printWindow) {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'etiqueta-envio.pdf';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 1000);
  };

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30000);
}

/**
 * Main function to print a single label
 */
export async function printLabelPDF(data: LabelData): Promise<boolean> {
  try {
    const pdfBlob = await generateLabelPDF(data);
    await triggerDirectPrint(pdfBlob);
    return true;
  } catch (error) {
    console.error('Error generating label PDF:', error);
    return false;
  }
}

/**
 * Main function to print multiple labels in batch
 */
export async function printBatchLabelsPDF(labels: LabelData[]): Promise<boolean> {
  try {
    const pdfBlob = await generateBatchLabelsPDF(labels);
    await triggerDirectPrint(pdfBlob);
    return true;
  } catch (error) {
    console.error('Error generating batch labels PDF:', error);
    return false;
  }
}
