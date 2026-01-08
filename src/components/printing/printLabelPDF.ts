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
  paymentMethod?: string;
  financialStatus?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided'; // From Shopify
  deliveryToken: string;
  items: Array<{
    name: string;
    quantity: number;
    price?: number; // Unit price for display
  }>;
}

/**
 * Generates a single 4x6 shipping label as PDF
 */
export async function generateLabelPDF(data: LabelData): Promise<Blob> {
  // Create PDF with exact 4x6 inch dimensions
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: [4, 6], // Width x Height in inches
    compress: true
  });

  // Generate QR code as base64 data URL
  const deliveryUrl = `${window.location.origin}/delivery/${data.deliveryToken}`;
  const qrDataUrl = await QRCode.toDataURL(deliveryUrl, {
    width: 400,
    margin: 0,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    },
    errorCorrectionLevel: 'M'
  });

  // Determine payment status
  // Priority: Check COD first (if codAmount > 0, it's COD regardless of payment_method)
  // This handles cases where payment_method might be incorrect but codAmount is set
  const hasCODAmount = data.codAmount && data.codAmount > 0;
  const isPaidByShopify = data.financialStatus === 'paid' || data.financialStatus === 'authorized';
  const isCODMethod = data.paymentMethod === 'cash' ||
                      data.paymentMethod === 'efectivo' ||
                      data.paymentMethod === 'cod' ||
                      data.paymentMethod === 'cash_on_delivery';

  // Debug logging
  console.log('🔍 [PDF DEBUG] Payment data:', {
    paymentMethod: data.paymentMethod,
    codAmount: data.codAmount,
    financialStatus: data.financialStatus,
    hasCODAmount,
    isPaidByShopify,
    isCODMethod,
  });

  // Logic: If has COD amount OR COD payment method (and not paid by Shopify), show COBRAR
  const isCOD = !isPaidByShopify && (hasCODAmount || isCODMethod);

  // Set default font
  pdf.setFont('helvetica', 'normal');

  // === WATERMARK - Very subtle ORDEFY branding ===
  const pageWidth = 4;
  const pageHeight = 6;
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  pdf.saveGraphicsState();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(100);
  pdf.setTextColor(245, 245, 245); // Very light gray - almost imperceptible

  // Draw diagonal watermark in center
  pdf.text('ORDEFY', centerX, centerY, {
    align: 'center',
    angle: -45
  });

  pdf.restoreGraphicsState();
  pdf.setTextColor(0, 0, 0); // Reset to black

  // === OUTER BORDER ===
  pdf.setLineWidth(0.04);
  pdf.rect(0.04, 0.04, 3.92, 5.92);

  // === ZONE A: HEADER (10% = 0.6in) ===
  const headerY = 0.04;
  const headerHeight = 0.6;

  // Store name (left)
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text(data.storeName.toUpperCase(), 0.12, headerY + 0.35, {
    maxWidth: 2.4
  });

  // Order number (right)
  pdf.setFontSize(24);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`#${data.orderNumber}`, 3.88, headerY + 0.4, { align: 'right' });

  // Header bottom border
  pdf.line(0.04, headerY + headerHeight, 3.96, headerY + headerHeight);

  // === ZONE B: ADDRESS (35% = 2.1in) ===
  const addressY = headerY + headerHeight;
  const addressHeight = 2.1;

  // Zone label
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('ENTREGAR A / SHIP TO:', 0.12, addressY + 0.15);

  // Customer name
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  const nameLines = pdf.splitTextToSize(data.customerName.toUpperCase(), 3.7);
  pdf.text(nameLines.slice(0, 2), 0.12, addressY + 0.45);

  // Customer address
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'normal');
  const addressText = [
    data.customerAddress || '',
    data.neighborhood ? `, ${data.neighborhood}` : ''
  ].join('');

  if (addressText) {
    const addressLines = pdf.splitTextToSize(addressText, 3.7);
    pdf.text(addressLines, 0.12, addressY + 0.95);
  }

  // City and reference
  let detailsY = addressY + 1.4;
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'normal');

  if (data.city || data.addressReference) {
    let cityRefText = '';
    if (data.city) cityRefText += data.city;
    if (data.addressReference) {
      cityRefText += cityRefText ? `  REF: ${data.addressReference}` : `REF: ${data.addressReference}`;
    }
    pdf.text(cityRefText, 0.12, detailsY);
    detailsY += 0.2;
  }

  // Phone number with border
  pdf.setFontSize(14);
  pdf.setFont('courier', 'bold');
  pdf.setLineWidth(0.02);
  const phoneText = `TEL: ${data.customerPhone}`;
  const phoneWidth = pdf.getTextWidth(phoneText) + 0.1;
  const phoneBoxY = detailsY + 0.05; // Moved down to avoid overlap with address zone border
  pdf.rect(0.12, phoneBoxY - 0.12, phoneWidth, 0.2);
  pdf.text(phoneText, 0.17, phoneBoxY);

  // Address bottom border
  pdf.setLineWidth(0.04);
  pdf.line(0.04, addressY + addressHeight, 3.96, addressY + addressHeight);

  // === ZONE C: ACTION (30% = 1.8in) ===
  const actionY = addressY + addressHeight;
  const actionHeight = 1.8;

  // QR Container (left 45%)
  const qrX = 0.04;
  const qrWidth = 1.8;

  // Add QR code image first
  pdf.addImage(qrDataUrl, 'PNG', qrX + 0.2, actionY + 0.15, 1.4, 1.4);

  // Vertical separator line will be drawn AFTER payment box (below) to avoid overlay

  // Action details (right 55%)
  const actionDetailsX = qrX + qrWidth + 0.1;
  const actionDetailsWidth = 2.06;

  if (isCOD) {
    // COD Box (black background)
    const codBoxY = actionY + 0.2;
    const codBoxHeight = 0.6;
    pdf.setFillColor(0, 0, 0);
    pdf.rect(actionDetailsX, codBoxY, actionDetailsWidth, codBoxHeight, 'F');

    // COD label (white text)
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('COBRAR', actionDetailsX + actionDetailsWidth / 2, codBoxY + 0.25, { align: 'center' });

    // COD amount (white text)
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Gs. ${data.codAmount?.toLocaleString()}`, actionDetailsX + actionDetailsWidth / 2, codBoxY + 0.48, { align: 'center' });

    // Reset text color
    pdf.setTextColor(0, 0, 0);
  } else {
    // PAID Box (border only)
    const paidBoxY = actionY + 0.2;
    const paidBoxHeight = 0.6;
    pdf.setLineWidth(0.04);
    pdf.rect(actionDetailsX, paidBoxY, actionDetailsWidth, paidBoxHeight);

    // PAID text
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('PAGADO', actionDetailsX + actionDetailsWidth / 2, paidBoxY + 0.3, { align: 'center' });

    // Payment status text from Shopify
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    const statusText = data.financialStatus === 'authorized' ? 'AUTORIZADO' :
                       data.financialStatus === 'paid' ? 'CONFIRMADO' : 'STANDARD';
    pdf.text(statusText, actionDetailsX + actionDetailsWidth / 2, paidBoxY + 0.5, { align: 'center' });
  }

  // Draw vertical separator line AFTER payment box to avoid overlay
  pdf.setLineWidth(0.02);
  pdf.setDrawColor(200, 200, 200); // Light gray line
  pdf.line(qrX + qrWidth, actionY, qrX + qrWidth, actionY + actionHeight);
  pdf.setDrawColor(0, 0, 0); // Reset to black

  // Carrier info
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`SERVICIOS: ${data.carrierName || 'PROPIO'}`, actionDetailsX + actionDetailsWidth / 2, actionY + 1.5, { align: 'center' });

  // Action bottom border
  pdf.setLineWidth(0.04);
  pdf.line(0.04, actionY + actionHeight, 3.96, actionY + actionHeight);

  // === ZONE D: PACKING LIST (25% = 1.5in) ===
  const packingY = actionY + actionHeight;

  // Table headers
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('QTY', 0.25, packingY + 0.2, { align: 'center' });
  pdf.text('ITEM', 0.6, packingY + 0.2);

  // Header underline
  pdf.setLineWidth(0.02);
  pdf.line(0.12, packingY + 0.25, 3.88, packingY + 0.25);

  // Table rows
  pdf.setFont('helvetica', 'normal');
  let rowY = packingY + 0.45;
  const displayItems = data.items.slice(0, 4);

  displayItems.forEach((item) => {
    pdf.text(item.quantity.toString(), 0.25, rowY, { align: 'center' });

    // Item name with price (if available)
    let itemText = item.name;
    if (item.price && item.price > 0) {
      itemText += ` @ Gs. ${item.price.toLocaleString()}`;
    }

    // Truncate long item names
    const itemLines = pdf.splitTextToSize(itemText, 3.2);
    pdf.text(itemLines[0], 0.6, rowY);

    // Light separator line
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.01);
    pdf.line(0.12, rowY + 0.05, 3.88, rowY + 0.05);

    rowY += 0.25;
  });

  // More items indicator
  if (data.items.length > 4) {
    pdf.text('+', 0.25, rowY, { align: 'center' });
    pdf.text(`...y ${data.items.length - 4} items más`, 0.6, rowY);
  }

  return pdf.output('blob');
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

    // For batch, we need to draw on current page
    // This is a simplified version - we'll regenerate the content directly
    const deliveryUrl = `${window.location.origin}/delivery/${labels[i].deliveryToken}`;
    const qrDataUrl = await QRCode.toDataURL(deliveryUrl, {
      width: 400,
      margin: 0,
      errorCorrectionLevel: 'M'
    });

    // Determine payment status for this label
    const hasCODAmount = labels[i].codAmount && labels[i].codAmount > 0;
    const isPaidByShopify = labels[i].financialStatus === 'paid' || labels[i].financialStatus === 'authorized';
    const isCODMethod = labels[i].paymentMethod === 'cash' ||
                        labels[i].paymentMethod === 'efectivo' ||
                        labels[i].paymentMethod === 'cod' ||
                        labels[i].paymentMethod === 'cash_on_delivery';
    const isCOD = !isPaidByShopify && (hasCODAmount || isCODMethod);

    // Draw the label
    drawLabelOnPage(pdf, labels[i], qrDataUrl, isCOD);
  }

  return pdf.output('blob');
}

/**
 * Helper function to draw label content on current PDF page
 */
function drawLabelOnPage(pdf: jsPDF, data: LabelData, qrDataUrl: string, isCOD: boolean) {
  // Set default font
  pdf.setFont('helvetica', 'normal');

  // === WATERMARK - Very subtle ORDEFY branding ===
  const pageWidth = 4;
  const pageHeight = 6;
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  pdf.saveGraphicsState();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(100);
  pdf.setTextColor(245, 245, 245); // Very light gray - almost imperceptible

  // Draw diagonal watermark in center
  pdf.text('ORDEFY', centerX, centerY, {
    align: 'center',
    angle: -45
  });

  pdf.restoreGraphicsState();
  pdf.setTextColor(0, 0, 0); // Reset to black

  // === OUTER BORDER ===
  pdf.setLineWidth(0.04);
  pdf.rect(0.04, 0.04, 3.92, 5.92);

  // === ZONE A: HEADER ===
  const headerY = 0.04;
  const headerHeight = 0.6;

  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text(data.storeName.toUpperCase(), 0.12, headerY + 0.35, { maxWidth: 2.4 });

  pdf.setFontSize(24);
  pdf.text(`#${data.orderNumber}`, 3.88, headerY + 0.4, { align: 'right' });

  pdf.line(0.04, headerY + headerHeight, 3.96, headerY + headerHeight);

  // === ZONE B: ADDRESS ===
  const addressY = headerY + headerHeight;
  const addressHeight = 2.1;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('ENTREGAR A / SHIP TO:', 0.12, addressY + 0.15);

  pdf.setFontSize(22);
  const nameLines = pdf.splitTextToSize(data.customerName.toUpperCase(), 3.7);
  pdf.text(nameLines.slice(0, 2), 0.12, addressY + 0.45);

  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'normal');
  const addressText = [
    data.customerAddress || '',
    data.neighborhood ? `, ${data.neighborhood}` : ''
  ].join('');

  if (addressText) {
    const addressLines = pdf.splitTextToSize(addressText, 3.7);
    pdf.text(addressLines, 0.12, addressY + 0.95);
  }

  let detailsY = addressY + 1.4;
  pdf.setFontSize(12);

  if (data.city || data.addressReference) {
    let cityRefText = '';
    if (data.city) cityRefText += data.city;
    if (data.addressReference) {
      cityRefText += cityRefText ? `  REF: ${data.addressReference}` : `REF: ${data.addressReference}`;
    }
    pdf.text(cityRefText, 0.12, detailsY);
    detailsY += 0.2;
  }

  pdf.setFontSize(14);
  pdf.setFont('courier', 'bold');
  pdf.setLineWidth(0.02);
  const phoneText = `TEL: ${data.customerPhone}`;
  const phoneWidth = pdf.getTextWidth(phoneText) + 0.1;
  const phoneBoxY = detailsY + 0.05; // Moved down to avoid overlap with address zone border
  pdf.rect(0.12, phoneBoxY - 0.12, phoneWidth, 0.2);
  pdf.text(phoneText, 0.17, phoneBoxY);

  pdf.setLineWidth(0.04);
  pdf.line(0.04, addressY + addressHeight, 3.96, addressY + addressHeight);

  // === ZONE C: ACTION ===
  const actionY = addressY + addressHeight;
  const actionHeight = 1.8;

  const qrX = 0.04;
  const qrWidth = 1.8;

  // Draw QR code first
  pdf.addImage(qrDataUrl, 'PNG', qrX + 0.2, actionY + 0.15, 1.4, 1.4);

  // Draw vertical separator line AFTER payment box (below) to avoid overlay
  // This will be drawn later after the payment box

  const actionDetailsX = qrX + qrWidth + 0.1;
  const actionDetailsWidth = 2.06;

  if (isCOD) {
    const codBoxY = actionY + 0.2;
    const codBoxHeight = 0.6;
    pdf.setFillColor(0, 0, 0);
    pdf.rect(actionDetailsX, codBoxY, actionDetailsWidth, codBoxHeight, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('COBRAR', actionDetailsX + actionDetailsWidth / 2, codBoxY + 0.25, { align: 'center' });

    pdf.setFontSize(18);
    pdf.text(`Gs. ${data.codAmount?.toLocaleString()}`, actionDetailsX + actionDetailsWidth / 2, codBoxY + 0.48, { align: 'center' });

    pdf.setTextColor(0, 0, 0);
  } else {
    const paidBoxY = actionY + 0.2;
    const paidBoxHeight = 0.6;
    pdf.setLineWidth(0.04);
    pdf.rect(actionDetailsX, paidBoxY, actionDetailsWidth, paidBoxHeight);

    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('PAGADO', actionDetailsX + actionDetailsWidth / 2, paidBoxY + 0.3, { align: 'center' });

    // Payment status text from Shopify
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    const statusText = data.financialStatus === 'authorized' ? 'AUTORIZADO' :
                       data.financialStatus === 'paid' ? 'CONFIRMADO' : 'STANDARD';
    pdf.text(statusText, actionDetailsX + actionDetailsWidth / 2, paidBoxY + 0.5, { align: 'center' });
  }

  // Draw vertical separator line AFTER payment box to avoid overlay
  pdf.setLineWidth(0.02);
  pdf.setDrawColor(200, 200, 200); // Light gray line
  pdf.line(qrX + qrWidth, actionY, qrX + qrWidth, actionY + actionHeight);
  pdf.setDrawColor(0, 0, 0); // Reset to black

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`SERVICIOS: ${data.carrierName || 'PROPIO'}`, actionDetailsX + actionDetailsWidth / 2, actionY + 1.5, { align: 'center' });

  pdf.setLineWidth(0.04);
  pdf.line(0.04, actionY + actionHeight, 3.96, actionY + actionHeight);

  // === ZONE D: PACKING LIST ===
  const packingY = actionY + actionHeight;

  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('QTY', 0.25, packingY + 0.2, { align: 'center' });
  pdf.text('ITEM', 0.6, packingY + 0.2);

  pdf.setLineWidth(0.02);
  pdf.line(0.12, packingY + 0.25, 3.88, packingY + 0.25);

  pdf.setFont('helvetica', 'normal');
  let rowY = packingY + 0.45;
  const displayItems = data.items.slice(0, 4);

  displayItems.forEach((item) => {
    pdf.text(item.quantity.toString(), 0.25, rowY, { align: 'center' });

    // Item name with price (if available)
    let itemText = item.name;
    if (item.price && item.price > 0) {
      itemText += ` @ Gs. ${item.price.toLocaleString()}`;
    }

    const itemLines = pdf.splitTextToSize(itemText, 3.2);
    pdf.text(itemLines[0], 0.6, rowY);

    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.01);
    pdf.line(0.12, rowY + 0.05, 3.88, rowY + 0.05);

    rowY += 0.25;
  });

  if (data.items.length > 4) {
    pdf.text('+', 0.25, rowY, { align: 'center' });
    pdf.text(`...y ${data.items.length - 4} items más`, 0.6, rowY);
  }
}

/**
 * Opens the PDF in a new window/tab for printing
 * This is the most reliable method because:
 * 1. The PDF viewer handles the 4x6 page size correctly
 * 2. User can verify the label before printing
 * 3. Works consistently across all browsers
 */
export async function triggerDirectPrint(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);

  // Open PDF in new window - let the native PDF viewer handle printing
  const printWindow = window.open(url, '_blank');

  if (!printWindow) {
    // If popup was blocked, fall back to download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'etiqueta-envio.pdf';
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // Clean up URL after window loads
  printWindow.onload = () => {
    // Give PDF time to render, then trigger print
    setTimeout(() => {
      printWindow.print();
    }, 1000);
  };

  // Cleanup URL after 30 seconds
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30000);
}

/**
 * Main function to print a single label
 * Generates PDF and triggers direct print dialog
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
 * Generates multi-page PDF and triggers direct print dialog
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
