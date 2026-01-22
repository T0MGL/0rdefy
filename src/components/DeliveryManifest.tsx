/**
 * Delivery Manifest Component
 * Generates a PDF document listing all orders being dispatched to a courier
 * Includes signature sections for legal proof of delivery handoff
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReadyToShipOrder } from '@/services/shipping.service';
import { getOrderDisplayId } from '@/utils/orderDisplay';
import { formatCurrency } from '@/utils/currency';

interface DeliveryManifestData {
  orders: ReadyToShipOrder[];
  carrierName: string;
  dispatchDate: Date;
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  notes?: string;
}

export class DeliveryManifestGenerator {
  /**
   * Generate and download delivery manifest PDF
   */
  static generate(data: DeliveryManifestData): void {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;

    // ==================== HEADER ====================
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('ORDEN DE ENTREGA A REPARTIDOR', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Comprobante de entrega de mercadería', pageWidth / 2, yPos, { align: 'center' });
    yPos += 7;

    // Document number / Control number
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    const manifestNumber = `MAN-${data.dispatchDate.toISOString().split('T')[0].replace(/-/g, '')}-${data.orders.length.toString().padStart(3, '0')}`;
    doc.text(`No. ${manifestNumber}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;

    // ==================== INFO SECTION ====================
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');

    // Left column - Store info
    const leftCol = 20;
    const rightCol = 110;

    doc.text('DATOS DE LA TIENDA:', leftCol, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.text(`Nombre: ${data.storeName}`, leftCol, yPos);
    yPos += 5;
    if (data.storeAddress) {
      doc.text(`Dirección: ${data.storeAddress}`, leftCol, yPos);
      yPos += 5;
    }
    if (data.storePhone) {
      doc.text(`Teléfono: ${data.storePhone}`, leftCol, yPos);
      yPos += 5;
    }

    // Right column - Dispatch info
    const tempY = yPos;
    yPos = 45; // Reset to align with left column
    doc.setFont('helvetica', 'bold');
    doc.text('DATOS DEL DESPACHO:', rightCol, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.text(`Fecha: ${data.dispatchDate.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`, rightCol, yPos);
    yPos += 5;
    doc.text(`Transportadora: ${data.carrierName}`, rightCol, yPos);
    yPos += 5;
    doc.text(`Total de pedidos: ${data.orders.length}`, rightCol, yPos);

    yPos = Math.max(tempY, yPos) + 10;

    // ==================== ORDERS TABLE ====================
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('DETALLE DE PEDIDOS:', leftCol, yPos);
    yPos += 5;

    const tableData = data.orders.map((order, index) => {
      const orderId = getOrderDisplayId(order);
      const codAmount = order.cod_amount > 0
        ? formatCurrency(order.cod_amount)
        : 'Pagado';

      return [
        (index + 1).toString(),
        orderId,
        order.customer_name,
        order.customer_phone,
        this.truncateText(order.customer_address, 40),
        order.total_items.toString(),
        codAmount
      ];
    });

    autoTable(doc, {
      startY: yPos,
      head: [['#', 'ID Pedido', 'Cliente', 'Teléfono', 'Dirección', 'Items', 'Monto COD']],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2,
      },
      headStyles: {
        fillColor: [66, 66, 66],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { cellWidth: 25 },
        2: { cellWidth: 35 },
        3: { cellWidth: 25 },
        4: { cellWidth: 45 },
        5: { halign: 'center', cellWidth: 15 },
        6: { halign: 'right', cellWidth: 25 },
      },
      margin: { left: leftCol, right: leftCol },
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;

    // ==================== SUMMARY ====================
    const totalCOD = data.orders.reduce((sum, order) => sum + order.cod_amount, 0);
    const totalItems = data.orders.reduce((sum, order) => sum + order.total_items, 0);

    // Draw summary box
    const summaryBoxY = yPos;
    const summaryBoxHeight = 25;
    doc.setFillColor(240, 240, 240);
    doc.rect(leftCol, summaryBoxY, pageWidth - (leftCol * 2), summaryBoxHeight, 'F');
    doc.setLineWidth(0.5);
    doc.rect(leftCol, summaryBoxY, pageWidth - (leftCol * 2), summaryBoxHeight);

    yPos += 7;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL DE ÓRDENES ENTREGADAS: ${data.orders.length}`, leftCol + 5, yPos);
    yPos += 6;
    doc.setFontSize(10);
    doc.text(`Total de items: ${totalItems}`, leftCol + 5, yPos);
    yPos += 6;
    doc.text(`Total monto COD a cobrar: ${formatCurrency(totalCOD)}`, leftCol + 5, yPos);
    yPos += 12;

    // ==================== NOTES ====================
    if (data.notes) {
      doc.setFont('helvetica', 'bold');
      doc.text('OBSERVACIONES:', leftCol, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const splitNotes = doc.splitTextToSize(data.notes, pageWidth - (leftCol * 2));
      doc.text(splitNotes, leftCol, yPos);
      yPos += (splitNotes.length * 5) + 10;
    }

    // ==================== SIGNATURE SECTION ====================
    // Check if we need a new page
    if (yPos > pageHeight - 80) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('FIRMAS:', leftCol, yPos);
    yPos += 10;

    // Signature boxes
    const boxWidth = (pageWidth - (leftCol * 2) - 10) / 2;
    const boxHeight = 40;

    // Store owner signature box
    doc.setLineWidth(0.5);
    doc.rect(leftCol, yPos, boxWidth, boxHeight);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('_'.repeat(30), leftCol + 10, yPos + boxHeight + 5);
    doc.setFont('helvetica', 'bold');
    doc.text('FIRMA ENCARGADO/DUEÑO', leftCol + (boxWidth / 2), yPos + boxHeight + 10, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Nombre: ${'_'.repeat(30)}`, leftCol + 5, yPos + boxHeight + 15);
    doc.text(`CI/RUC: ${'_'.repeat(30)}`, leftCol + 5, yPos + boxHeight + 20);

    // Courier signature box
    const rightBoxX = leftCol + boxWidth + 10;
    doc.setLineWidth(0.5);
    doc.rect(rightBoxX, yPos, boxWidth, boxHeight);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('_'.repeat(30), rightBoxX + 10, yPos + boxHeight + 5);
    doc.setFont('helvetica', 'bold');
    doc.text('FIRMA REPARTIDOR', rightBoxX + (boxWidth / 2), yPos + boxHeight + 10, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Nombre: ${'_'.repeat(30)}`, rightBoxX + 5, yPos + boxHeight + 15);
    doc.text(`CI: ${'_'.repeat(30)}`, rightBoxX + 5, yPos + boxHeight + 20);

    yPos += boxHeight + 25;

    // ==================== LEGAL TEXT ====================
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    const legalText = 'El repartidor confirma haber recibido todos los pedidos listados en este documento en buen estado. El encargado/dueño de la tienda confirma haber entregado todos los pedidos al repartidor. Este documento tiene validez legal como comprobante de entrega de mercadería.';
    const splitLegal = doc.splitTextToSize(legalText, pageWidth - (leftCol * 2));
    doc.text(splitLegal, leftCol, yPos);

    // ==================== FOOTER ====================
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    const footerY = pageHeight - 10;
    doc.text(
      `Generado por Ordefy - ${new Date().toLocaleDateString('es-ES')}`,
      pageWidth / 2,
      footerY,
      { align: 'center' }
    );

    // ==================== SAVE PDF ====================
    const sanitizedStoreName = data.storeName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const sanitizedCarrierName = data.carrierName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    const dateStr = data.dispatchDate.toISOString().split('T')[0];
    const filename = `orden-entrega-${sanitizedStoreName}-${sanitizedCarrierName}-${dateStr}.pdf`;
    doc.save(filename);
  }

  /**
   * Helper to truncate long text
   */
  private static truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }
}
