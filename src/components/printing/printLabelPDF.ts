/**
 * PDF-based label printing system
 * Generates exact 4x6 inch PDFs for thermal label printers
 * Triggers browser print dialog directly using hidden iframe
 */

import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { getCurrencySymbol } from '@/utils/currency';

interface LabelData {
  storeName: string;
  orderNumber: string;
  orderDate?: string; // Date of the order (ISO string or formatted)
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  neighborhood?: string;
  city?: string;
  addressReference?: string;
  carrierName?: string;
  codAmount?: number;
  totalPrice?: number; // Fallback when codAmount is 0
  discountAmount?: number; // Discount applied to the order
  paymentMethod?: string;
  paymentGateway?: string; // From Shopify: 'cash_on_delivery', 'shopify_payments', etc.
  financialStatus?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided';
  prepaidMethod?: string; // Manual prepaid: 'transfer', 'efectivo_local', 'qr', 'otro'
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

  // ============================================================================
  // CRITICAL: Payment status determination - THIS CANNOT FAIL
  // ============================================================================

  // 1. Check if order was paid online (Shopify Payments, PayPal, etc.)
  const isPaidOnline = data.financialStatus === 'paid' || data.financialStatus === 'authorized';

  // 2. Check if order was manually marked as prepaid (transfer, QR, etc.)
  const isPrepaid = !!data.prepaidMethod;

  // 3. Check if payment gateway indicates COD
  const isCODGateway = data.paymentGateway === 'cash_on_delivery' ||
                       data.paymentGateway === 'cod' ||
                       data.paymentGateway === 'manual' ||
                       data.paymentGateway === 'pending';
  const isCODMethod = data.paymentMethod === 'cash' ||
                      data.paymentMethod === 'efectivo' ||
                      data.paymentMethod === 'cod' ||
                      data.paymentMethod === 'cash_on_delivery';

  // 4. CRITICAL: cod_amount is the SOURCE OF TRUTH from backend
  //    - cod_amount = 0 or undefined → nothing to collect (fully paid)
  //    - cod_amount > 0 → collect this exact amount (COD or upsell on paid order)
  const codAmountFromBackend = data.codAmount ?? 0;

  // 5. Determine amount to collect:
  //    - If prepaid (manually marked) → collect nothing
  //    - If paid online → collect nothing
  //    - If cod_amount > 0, use it (backend explicitly set this)
  //    - If NOT paid AND gateway is COD, use totalPrice as fallback (legacy)
  //    - Otherwise, collect nothing (PAGADO)
  let amountToCollect = 0;
  if (isPrepaid || isPaidOnline) {
    // Order is already paid - do NOT collect anything
    amountToCollect = 0;
  } else if (codAmountFromBackend > 0) {
    // Backend says collect this exact amount
    amountToCollect = codAmountFromBackend;
  } else if (isCODGateway || isCODMethod) {
    // Legacy fallback for orders without cod_amount set
    amountToCollect = data.totalPrice || 0;
  }

  // 6. MASTER DECISION: COBRAR only if amountToCollect > 0
  const isCOD = amountToCollect > 0;

  console.log('🏷️ [LABEL] Payment determination:', {
    financialStatus: data.financialStatus,
    prepaidMethod: data.prepaidMethod,
    paymentGateway: data.paymentGateway,
    isPaidOnline,
    isPrepaid,
    codAmountFromBackend,
    totalPrice: data.totalPrice,
    amountToCollect,
    isCOD,
    RESULT: isCOD ? `COBRAR ${getCurrencySymbol()} ${amountToCollect.toLocaleString()}` : 'PAGADO'
  });

  // Draw label
  drawLabel(pdf, data, qrDataUrl, isCOD, amountToCollect, data.discountAmount);

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
  amountToCollect: number,
  discountAmount?: number
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
  pdf.text(stripEmojis(data.storeName).toUpperCase(), MARGIN + 0.08, headerY + 0.22, { maxWidth: 2.2 });

  // Order date - small, below store name
  if (data.orderDate) {
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(80, 80, 80); // Dark gray
    pdf.text(data.orderDate, MARGIN + 0.08, headerY + 0.38);
    pdf.setTextColor(0, 0, 0); // Reset to black
  }

  // Order number - large and prominent
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  // Remove leading # if already present in orderNumber
  const cleanOrderNumber = data.orderNumber.replace(/^#/, '');
  const orderText = `#${cleanOrderNumber}`;
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
  let currentY = nameY + (displayNameLines.length * lineHeight) + 0.1;

  // City - displayed BEFORE address (prominent)
  if (city) {
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.text(city, MARGIN + 0.08, currentY);
    currentY += 0.16;
  }

  // Build address text
  let fullAddress = customerAddress;
  if (neighborhood) {
    fullAddress += fullAddress ? `, ${neighborhood}` : neighborhood;
  }

  let addressEndY = currentY;
  if (fullAddress) {
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    const addrLines = pdf.splitTextToSize(fullAddress, CONTENT_WIDTH - 0.16);
    const displayAddrLines = addrLines.slice(0, 3); // Allow up to 3 lines for address
    pdf.text(displayAddrLines, MARGIN + 0.08, currentY);
    addressEndY = currentY + (displayAddrLines.length * 0.16);
  }

  // Reference - smaller text, positioned after address
  if (addressRef) {
    const detailsY = addressEndY + 0.08;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    const refText = `REF: ${addressRef}`;
    const refLines = pdf.splitTextToSize(refText, CONTENT_WIDTH - 0.16);
    pdf.text(refLines[0] || '', MARGIN + 0.08, detailsY);
  }

  // Phone - always at fixed position near bottom of address zone (with clearance from separator)
  const phoneBoxY = addressZoneY + addressZoneHeight - 0.38;
  pdf.setFontSize(12);
  pdf.setFont('courier', 'bold');
  const phoneText = `TEL: ${data.customerPhone}`;
  const phoneWidth = pdf.getTextWidth(phoneText) + 0.16;
  const phoneBoxHeight = 0.24;

  pdf.setLineWidth(0.02);
  pdf.rect(MARGIN + 0.08, phoneBoxY, phoneWidth, phoneBoxHeight);
  // Center text vertically in box
  pdf.text(phoneText, MARGIN + 0.16, phoneBoxY + 0.17);

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
    pdf.text(`${getCurrencySymbol()} ${amountToCollect.toLocaleString()}`, paymentBoxX + paymentBoxWidth / 2, paymentBoxY + 0.52, { align: 'center' });

    pdf.setTextColor(0, 0, 0);

    // Show discount badge if applicable
    if (discountAmount && discountAmount > 0) {
      const discountBadgeY = paymentBoxY + paymentBoxHeight + 0.08;
      pdf.setFillColor(255, 140, 0); // Orange
      pdf.rect(paymentBoxX, discountBadgeY, paymentBoxWidth, 0.32, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(9);
      pdf.text('DESC. APLICADO', paymentBoxX + paymentBoxWidth / 2, discountBadgeY + 0.12, { align: 'center' });
      pdf.setFontSize(10);
      pdf.text(`-${getCurrencySymbol()} ${discountAmount.toLocaleString()}`, paymentBoxX + paymentBoxWidth / 2, discountBadgeY + 0.26, { align: 'center' });
      pdf.setTextColor(0, 0, 0);
    }
  } else {
    // PAID - Green filled box (more visible)
    pdf.setFillColor(34, 139, 34); // Forest green
    pdf.rect(paymentBoxX, paymentBoxY, paymentBoxWidth, paymentBoxHeight, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.text('PAGADO', paymentBoxX + paymentBoxWidth / 2, paymentBoxY + 0.42, { align: 'center' });
    pdf.setTextColor(0, 0, 0);
  }

  // Carrier info - display on multiple lines
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  const carrierName = stripEmojis(data.carrierName || 'PROPIO').toUpperCase();

  // Split carrier name into words for multi-line display
  const carrierWords = carrierName.split(' ');
  const carrierCenterX = paymentBoxX + paymentBoxWidth / 2;

  // "DELIVERY" label on first line
  pdf.text('DELIVERY', carrierCenterX, actionZoneY + 1.25, { align: 'center' });

  // Carrier name words on subsequent lines
  let carrierY = actionZoneY + 1.4;
  carrierWords.forEach((word) => {
    if (word.trim()) {
      pdf.text(word, carrierCenterX, carrierY, { align: 'center' });
      carrierY += 0.13;
    }
  });

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

    // Same logic as generateLabelPDF - CRITICAL: cod_amount is source of truth
    const isPaidOnline = data.financialStatus === 'paid' || data.financialStatus === 'authorized';
    const isCODGateway = data.paymentGateway === 'cash_on_delivery' ||
                         data.paymentGateway === 'cod' ||
                         data.paymentGateway === 'manual' ||
                         data.paymentGateway === 'pending';
    const isCODMethod = data.paymentMethod === 'cash' ||
                        data.paymentMethod === 'efectivo' ||
                        data.paymentMethod === 'cod' ||
                        data.paymentMethod === 'cash_on_delivery';

    const codAmountFromBackend = data.codAmount ?? 0;
    let amountToCollect = 0;
    if (codAmountFromBackend > 0) {
      amountToCollect = codAmountFromBackend;
    } else if (!isPaidOnline && (isCODGateway || isCODMethod)) {
      amountToCollect = data.totalPrice || 0;
    }
    const isCOD = amountToCollect > 0;

    drawLabel(pdf, data, qrDataUrl, isCOD, amountToCollect, data.discountAmount);
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
