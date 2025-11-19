import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type ExportFormat = 'csv' | 'excel' | 'pdf';

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
  format?: (value: any) => string;
}

export interface ExportOptions {
  filename: string;
  format: ExportFormat;
  columns: ExportColumn[];
  data: any[];
  title?: string;
  orientation?: 'portrait' | 'landscape';
}

class ExportService {
  /**
   * Export data to CSV format
   */
  private exportToCSV(options: ExportOptions): void {
    const { filename, columns, data } = options;

    // Create header row
    const headers = columns.map(col => col.header);

    // Create data rows
    const rows = data.map(item =>
      columns.map(col => {
        const value = this.getNestedValue(item, col.key);
        return col.format ? col.format(value) : this.formatValue(value);
      })
    );

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => this.escapeCSV(cell)).join(','))
    ].join('\n');

    // Create and download file
    this.downloadFile(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
  }

  /**
   * Export data to Excel format (.xlsx)
   */
  private exportToExcel(options: ExportOptions): void {
    const { filename, columns, data, title } = options;

    // Create header row
    const headers = columns.map(col => col.header);

    // Create data rows
    const rows = data.map(item =>
      columns.map(col => {
        const value = this.getNestedValue(item, col.key);
        return col.format ? col.format(value) : value;
      })
    );

    // Create worksheet
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    const colWidths = columns.map(col => ({ wch: col.width || 15 }));
    ws['!cols'] = colWidths;

    // Style header row
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const address = XLSX.utils.encode_col(C) + '1';
      if (!ws[address]) continue;
      ws[address].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'CCCCCC' } },
        alignment: { horizontal: 'center' }
      };
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title || 'Data');

    // Download file
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  /**
   * Export data to PDF format
   */
  private exportToPDF(options: ExportOptions): void {
    const { filename, columns, data, title, orientation = 'landscape' } = options;

    // Create PDF document
    const doc = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4'
    });

    // Add title if provided
    if (title) {
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 14, 15);
    }

    // Prepare table headers
    const headers = columns.map(col => col.header);

    // Prepare table data
    const rows = data.map(item =>
      columns.map(col => {
        const value = this.getNestedValue(item, col.key);
        return col.format ? col.format(value) : this.formatValue(value);
      })
    );

    // Add table
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: title ? 22 : 14,
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
      margin: { top: 14, right: 14, bottom: 14, left: 14 },
    });

    // Add footer with date and page numbers
    const pageCount = (doc as any).internal.getNumberOfPages();
    const pageSize = doc.internal.pageSize;
    const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');

      // Add date
      const dateStr = new Date().toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      doc.text(dateStr, 14, pageHeight - 10);

      // Add page number
      doc.text(
        `Página ${i} de ${pageCount}`,
        pageSize.width - 14,
        pageHeight - 10,
        { align: 'right' }
      );
    }

    // Save PDF
    doc.save(`${filename}.pdf`);
  }

  /**
   * Main export function
   */
  export(options: ExportOptions): void {
    try {
      switch (options.format) {
        case 'csv':
          this.exportToCSV(options);
          break;
        case 'excel':
          this.exportToExcel(options);
          break;
        case 'pdf':
          this.exportToPDF(options);
          break;
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }
    } catch (error) {
      console.error('Export error:', error);
      throw error;
    }
  }

  /**
   * Helper: Get nested object value by path (e.g., "user.name")
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  /**
   * Helper: Format value for display
   */
  private formatValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Helper: Escape CSV special characters
   */
  private escapeCSV(value: string): string {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);

    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }

  /**
   * Helper: Download file
   */
  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}

export const exportService = new ExportService();
