/**
 * Reconciliation PDF Generator
 * Generates a settlement document to send to a courier after a delivery session.
 * Lists all orders, payment status, and total COD to be remitted.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export interface ReconciliationPDFOrder {
  display_order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  total_price: number;
  cod_amount: number;
  is_cod: boolean;
  id: string;
}

export interface ReconciliationPDFState {
  delivered: boolean;
  failure_reason?: string;
  override_prepaid?: boolean;
}

export interface ReconciliationPDFData {
  carrierName: string;
  deliveryDate: string;
  orders: ReconciliationPDFOrder[];
  reconciliationState: Map<string, ReconciliationPDFState>;
  totalAmountCollected: number | null;
}

function formatGs(amount: number): string {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Gs';
}

export function generateReconciliationPDF(data: ReconciliationPDFData): void {
  const { carrierName, deliveryDate, orders, reconciliationState, totalAmountCollected } = data;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let y = 20;

  const formattedDate = format(parseISO(deliveryDate), "d 'de' MMMM 'de' yyyy", { locale: es });

  // Calculate stats
  let totalDelivered = 0;
  let totalNotDelivered = 0;
  let totalCOD = 0;
  let totalPrepaid = 0;

  orders.forEach(order => {
    const state = reconciliationState.get(order.id);
    const isDelivered = state?.delivered ?? true;
    const effectiveIsCod = state?.override_prepaid ? false : order.is_cod;

    if (isDelivered) {
      totalDelivered++;
      if (effectiveIsCod) {
        totalCOD += order.cod_amount;
      } else {
        totalPrepaid++;
      }
    } else {
      totalNotDelivered++;
    }
  });

  // ==================== HEADER ====================
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CONCILIACION DE ENTREGAS', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Comprobante de rendicion de cobros', pageWidth / 2, y, { align: 'center' });
  y += 12;

  // ==================== INFO COLUMNS ====================
  const leftCol = margin;
  const rightCol = pageWidth / 2 + 5;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('REPARTIDOR:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(carrierName, leftCol + 30, y);

  doc.setFont('helvetica', 'bold');
  doc.text('FECHA DE SESION:', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(formattedDate, rightCol + 38, y);
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.text('Total pedidos:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(orders.length.toString(), leftCol + 30, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Generado:', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(
    format(new Date(), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es }),
    rightCol + 22,
    y,
  );
  y += 10;

  // ==================== SUMMARY BOX ====================
  const summaryBoxHeight = 28;
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y, pageWidth - margin * 2, summaryBoxHeight, 'F');
  doc.setLineWidth(0.3);
  doc.rect(margin, y, pageWidth - margin * 2, summaryBoxHeight);

  const colW = (pageWidth - margin * 2) / 4;
  const summaryItems: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: 'Entregados', value: totalDelivered.toString() },
    { label: 'No entregados', value: totalNotDelivered.toString() },
    { label: 'Total COD a rendir', value: formatGs(totalCOD), bold: true },
    { label: 'Pedidos prepago', value: totalPrepaid.toString() },
  ];

  summaryItems.forEach((item, i) => {
    const x = margin + colW * i + colW / 2;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(item.label, x, y + 8, { align: 'center' });

    doc.setFontSize(item.bold ? 12 : 11);
    doc.setFont('helvetica', 'bold');
    doc.text(item.value, x, y + 19, { align: 'center' });
  });

  y += summaryBoxHeight + 10;

  // ==================== ORDERS TABLE ====================
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE PEDIDOS', margin, y);
  y += 4;

  const tableRows = orders.map(order => {
    const state = reconciliationState.get(order.id);
    const isDelivered = state?.delivered ?? true;
    const effectiveIsCod = state?.override_prepaid ? false : order.is_cod;

    const paymentStatus = isDelivered
      ? (effectiveIsCod ? 'Pago COD' : 'Prepago')
      : 'No entregado';

    const amountCollected = isDelivered && effectiveIsCod
      ? formatGs(order.cod_amount)
      : isDelivered
        ? 'Prepago'
        : '-';

    return [
      order.display_order_number,
      order.customer_name,
      order.customer_phone,
      order.customer_city,
      formatGs(order.total_price),
      paymentStatus,
      amountCollected,
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['# Pedido', 'Cliente', 'Telefono', 'Zona', 'Total', 'Estado', 'Cobrado']],
    body: tableRows,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
    },
    headStyles: {
      fillColor: [40, 40, 40],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 22 },
      1: { cellWidth: 38 },
      2: { cellWidth: 25 },
      3: { cellWidth: 20 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'center', cellWidth: 22 },
      6: { halign: 'right', cellWidth: 22 },
    },
    margin: { left: margin, right: margin },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.index === 5) {
        const val = String(hookData.cell.raw ?? '');
        if (val === 'No entregado') {
          hookData.cell.styles.textColor = [180, 0, 0];
        } else if (val === 'Prepago') {
          hookData.cell.styles.textColor = [0, 100, 180];
        }
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // ==================== TOTAL FOOTER ====================
  const totalBoxH = totalAmountCollected !== null ? 22 : 16;

  if (y + totalBoxH > pageHeight - 30) {
    doc.addPage();
    y = 20;
  }

  doc.setFillColor(40, 40, 40);
  doc.rect(margin, y, pageWidth - margin * 2, totalBoxH, 'F');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`TOTAL COD A RENDIR:  ${formatGs(totalCOD)}`, margin + 5, y + 7);

  if (totalAmountCollected !== null) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Monto declarado por repartidor:  ${formatGs(totalAmountCollected)}`, margin + 5, y + 15);
  }

  doc.setTextColor(0, 0, 0);
  y += totalBoxH + 12;

  // ==================== FOOTER ====================
  if (y > pageHeight - 15) {
    doc.addPage();
    y = pageHeight - 12;
  }

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('Generado por Ordefy', pageWidth / 2, pageHeight - 8, { align: 'center' });

  // ==================== SAVE ====================
  const safeCarrier = carrierName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  const safeDate = deliveryDate.replace(/[^0-9-]/g, '');
  doc.save(`conciliacion-${safeCarrier}-${safeDate}.pdf`);
}
