/**
 * Ordefy Branded Excel Export Utility
 * Generates dispatch Excel files with Ordefy branding for courier delivery tracking.
 */

import ExcelJS from 'exceljs';

const ORDEFY_COLORS = {
  PRIMARY: 'B0ED54',
  PRIMARY_LIGHT: 'E8F9D4',
  DARK: '1F2937',
  SUCCESS: '10B981',
  GRAY: '6B7280',
  AMBER: 'D97706',
  LIGHT_YELLOW: 'FEF3C7',
  ALT_ROW: 'F9FAFB',
  BORDER: 'E5E7EB'
};

const DISPATCH_HEADERS = [
  { key: 'order_number', header: 'PEDIDO', width: 15, editable: false },
  { key: 'customer_name', header: 'CLIENTE', width: 25, editable: false },
  { key: 'customer_phone', header: 'TELÉFONO', width: 15, editable: false },
  { key: 'delivery_address', header: 'DIRECCIÓN', width: 35, editable: false },
  { key: 'delivery_city', header: 'CIUDAD', width: 15, editable: false },
  { key: 'payment_type', header: 'TIPO PAGO', width: 12, editable: false },
  { key: 'amount_to_collect', header: 'A COBRAR', width: 15, editable: false },
  { key: 'carrier_fee', header: 'TARIFA', width: 12, editable: false },
  { key: 'delivery_status', header: 'ESTADO ENTREGA', width: 18, editable: true },
  { key: 'amount_collected', header: 'MONTO COBRADO', width: 16, editable: true },
  { key: 'failure_reason', header: 'MOTIVO', width: 20, editable: true },
  { key: 'notes', header: 'NOTAS', width: 25, editable: true }
];

export interface DispatchOrder {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryCity: string;
  paymentType: string;
  amountToCollect: number;
  carrierFee: number;
}

export async function generateDispatchExcel(
  sessionInfo: string,
  orders: DispatchOrder[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ordefy';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Despacho', {
    properties: { tabColor: { argb: ORDEFY_COLORS.PRIMARY } },
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  // Row 1: Title
  worksheet.mergeCells('A1:L1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'ORDEFY - Planilla de Despacho';
  titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: ORDEFY_COLORS.DARK } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORDEFY_COLORS.PRIMARY_LIGHT } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 35;

  // Row 2: Session info + instructions
  worksheet.mergeCells('A2:F2');
  const sessionInfoCell = worksheet.getCell('A2');
  sessionInfoCell.value = sessionInfo;
  sessionInfoCell.font = { name: 'Arial', size: 11, color: { argb: ORDEFY_COLORS.GRAY } };
  sessionInfoCell.alignment = { horizontal: 'left', vertical: 'middle' };

  worksheet.mergeCells('G2:L2');
  const instructionsCell = worksheet.getCell('G2');
  instructionsCell.value = 'Complete las columnas AMARILLAS y devuelva este archivo';
  instructionsCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'B45309' } };
  instructionsCell.alignment = { horizontal: 'right', vertical: 'middle' };
  worksheet.getRow(2).height = 25;

  worksheet.getRow(3).height = 10;

  // Row 4: Headers
  worksheet.columns = DISPATCH_HEADERS.map(h => ({ key: h.key, width: h.width }));
  const headerRow = worksheet.getRow(4);
  DISPATCH_HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h.header;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: h.editable ? 'FFFFFF' : ORDEFY_COLORS.DARK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: h.editable ? ORDEFY_COLORS.AMBER : ORDEFY_COLORS.PRIMARY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: ORDEFY_COLORS.DARK } },
      left: { style: 'thin', color: { argb: ORDEFY_COLORS.DARK } },
      bottom: { style: 'thin', color: { argb: ORDEFY_COLORS.DARK } },
      right: { style: 'thin', color: { argb: ORDEFY_COLORS.DARK } }
    };
  });
  headerRow.height = 30;

  // Data rows
  orders.forEach((order, index) => {
    const row = worksheet.getRow(5 + index);
    const rowData = [
      order.orderNumber, order.customerName, order.customerPhone, order.deliveryAddress,
      order.deliveryCity, order.paymentType, order.amountToCollect, order.carrierFee,
      '', '', '', ''
    ];

    rowData.forEach((value, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      cell.value = value;
      const isEditable = DISPATCH_HEADERS[colIndex].editable;
      const isAmountColumn = colIndex === 6 || colIndex === 7 || colIndex === 9;

      cell.font = { name: 'Arial', size: 10, color: { argb: ORDEFY_COLORS.DARK } };
      cell.alignment = { horizontal: isAmountColumn ? 'right' : 'left', vertical: 'middle', wrapText: colIndex === 3 };

      if (isEditable) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORDEFY_COLORS.LIGHT_YELLOW } };
      } else if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORDEFY_COLORS.ALT_ROW } };
      }

      if (isAmountColumn && typeof value === 'number') cell.numFmt = '#,##0';

      cell.border = {
        top: { style: 'thin', color: { argb: ORDEFY_COLORS.BORDER } },
        left: { style: 'thin', color: { argb: ORDEFY_COLORS.BORDER } },
        bottom: { style: 'thin', color: { argb: ORDEFY_COLORS.BORDER } },
        right: { style: 'thin', color: { argb: ORDEFY_COLORS.BORDER } }
      };
    });
    row.height = 28;
  });

  // Data validation
  const dataStartRow = 5;
  const dataEndRow = 4 + orders.length;

  if (orders.length > 0) {
    worksheet.dataValidations.add(`I${dataStartRow}:I${dataEndRow}`, {
      type: 'list', allowBlank: true,
      formulae: ['"ENTREGADO,NO ENTREGADO,RECHAZADO,REPROGRAMADO"'],
      showErrorMessage: true, errorTitle: 'Estado inválido',
      error: 'Seleccione: ENTREGADO, NO ENTREGADO, RECHAZADO o REPROGRAMADO'
    });
    worksheet.dataValidations.add(`K${dataStartRow}:K${dataEndRow}`, {
      type: 'list', allowBlank: true,
      formulae: ['"NO CONTESTA,DIRECCION INCORRECTA,CLIENTE AUSENTE,RECHAZADO,SIN DINERO,REPROGRAMADO,OTRO"'],
      showErrorMessage: true, errorTitle: 'Motivo inválido',
      error: 'Seleccione un motivo de la lista o deje vacío'
    });
  }

  // Summary section
  const summaryStartRow = dataEndRow + 2;

  worksheet.mergeCells(`A${summaryStartRow}:C${summaryStartRow}`);
  const totalOrdersCell = worksheet.getCell(`A${summaryStartRow}`);
  totalOrdersCell.value = `Total de pedidos: ${orders.length}`;
  totalOrdersCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: ORDEFY_COLORS.DARK } };

  worksheet.mergeCells(`D${summaryStartRow}:F${summaryStartRow}`);
  const totalCodCell = worksheet.getCell(`D${summaryStartRow}`);
  const totalToCollect = orders.reduce((sum, o) => sum + o.amountToCollect, 0);
  totalCodCell.value = `Total a cobrar: ${totalToCollect.toLocaleString('es-PY')} Gs`;
  totalCodCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: ORDEFY_COLORS.SUCCESS } };

  const paidCount = orders.filter(o => o.paymentType === '✓ PAGADO').length;
  worksheet.mergeCells(`G${summaryStartRow}:I${summaryStartRow}`);
  const paidInfoCell = worksheet.getCell(`G${summaryStartRow}`);
  paidInfoCell.value = `${paidCount} ya pagado(s) | ${orders.length - paidCount} COD`;
  paidInfoCell.font = { name: 'Arial', size: 10, color: { argb: ORDEFY_COLORS.GRAY } };
  paidInfoCell.alignment = { horizontal: 'center' };

  const instructionsRow = summaryStartRow + 2;
  worksheet.mergeCells(`A${instructionsRow}:L${instructionsRow}`);
  const instructionsFinalCell = worksheet.getCell(`A${instructionsRow}`);
  instructionsFinalCell.value = 'Instrucciones: Complete ESTADO ENTREGA para todos los pedidos. Para entregas fallidas, indique el MOTIVO. Para COD entregados, ingrese MONTO COBRADO.';
  instructionsFinalCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: ORDEFY_COLORS.GRAY } };
  instructionsFinalCell.alignment = { wrapText: true };
  worksheet.getRow(instructionsRow).height = 35;

  const footerRow = instructionsRow + 2;
  worksheet.mergeCells(`A${footerRow}:L${footerRow}`);
  const footerCell = worksheet.getCell(`A${footerRow}`);
  footerCell.value = 'Generado por Ordefy | ordefy.io | Gestión de e-commerce simplificada';
  footerCell.font = { name: 'Arial', size: 9, color: { argb: ORDEFY_COLORS.GRAY } };
  footerCell.alignment = { horizontal: 'center' };

  // Sheet protection
  for (let rowIdx = dataStartRow; rowIdx <= dataEndRow; rowIdx++) {
    [9, 10, 11, 12].forEach(col => {
      worksheet.getCell(rowIdx, col).protection = { locked: false };
    });
  }

  await worksheet.protect('ordefy2024', {
    selectLockedCells: true, selectUnlockedCells: true,
    formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false,
    deleteRows: false, deleteColumns: false
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
