import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { logger } from '@/utils/logger';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileSpreadsheet, FileText, FileDown, Lock, Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { exportService, ExportColumn } from '@/services/export.service';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { UpgradeModal } from '@/components/UpgradeModal';

interface ExportButtonProps {
  data: any[];
  filename: string;
  columns: ExportColumn[];
  title?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  /** When provided, adds a "Planilla Transportadora" option that exports
   *  with these columns instead of the default ones. */
  planillaColumns?: ExportColumn[];
}

export function ExportButton({
  data,
  filename,
  columns,
  title,
  variant = 'outline',
  size = 'default',
  planillaColumns,
}: ExportButtonProps) {
  const { toast } = useToast();
  const { hasFeature } = useSubscription();
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  // Check if user has PDF/Excel reports feature
  const hasPdfExcelReports = hasFeature('pdf_excel_reports');

  const handleExport = async (format: 'csv' | 'excel' | 'pdf') => {
    // Check feature access for PDF/Excel exports
    if ((format === 'pdf' || format === 'excel') && !hasPdfExcelReports) {
      setUpgradeModalOpen(true);
      return;
    }

    try {
      // Show loading toast
      toast({
        title: '📊 Exportando datos...',
        description: `Preparando ${data.length} registros para exportar a ${format.toUpperCase()}`,
      });

      // Execute export
      await exportService.export({
        filename,
        format,
        columns,
        data,
        title: title || filename,
        orientation: 'landscape',
      });

      // Show success toast
      toast({
        title: '✅ Exportación exitosa',
        description: `Se han exportado ${data.length} registros a ${format.toUpperCase()}`,
      });
    } catch (error) {
      logger.error('Export error:', error);
      toast({
        title: '❌ Error al exportar',
        description: 'No se pudo completar la exportación. Por favor intenta de nuevo.',
        variant: 'destructive',
      });
    }
  };

  const handlePlanillaExport = async () => {
    if (!hasPdfExcelReports) {
      setUpgradeModalOpen(true);
      return;
    }
    if (!planillaColumns) return;

    try {
      toast({
        title: '📋 Exportando planilla...',
        description: `Preparando ${data.length} pedidos en formato transportadora`,
      });

      await exportService.export({
        filename: `${filename} - Planilla`,
        format: 'excel',
        columns: planillaColumns,
        data,
        title: 'Planilla Transportadora',
        orientation: 'landscape',
      });

      toast({
        title: '✅ Planilla exportada',
        description: `${data.length} pedidos exportados en formato oficial`,
      });
    } catch (error) {
      logger.error('Planilla export error:', error);
      toast({
        title: '❌ Error al exportar',
        description: 'No se pudo completar la exportación. Por favor intenta de nuevo.',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} className="gap-2">
            <Download size={16} />
            Exportar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {planillaColumns && (
            <>
              <DropdownMenuItem onClick={handlePlanillaExport} className="gap-2">
                <Truck size={16} className="text-purple-600 dark:text-purple-400" />
                <div className="flex-1">
                  <p className="font-medium">Planilla Transportadora</p>
                  <p className="text-xs text-muted-foreground">Formato oficial de carga</p>
                </div>
                {!hasPdfExcelReports && <Lock size={14} className="text-muted-foreground" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => handleExport('excel')} className="gap-2">
            <FileSpreadsheet size={16} className="text-green-600 dark:text-green-400" />
            <div className="flex-1">
              <p className="font-medium">Excel (.xlsx)</p>
              <p className="text-xs text-muted-foreground">Hoja de cálculo</p>
            </div>
            {!hasPdfExcelReports && <Lock size={14} className="text-muted-foreground" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('csv')} className="gap-2">
            <FileText size={16} className="text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium">CSV</p>
              <p className="text-xs text-muted-foreground">Valores separados por coma</p>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('pdf')} className="gap-2">
            <FileDown size={16} className="text-red-600 dark:text-red-400" />
            <div className="flex-1">
              <p className="font-medium">PDF</p>
              <p className="text-xs text-muted-foreground">Documento profesional</p>
            </div>
            {!hasPdfExcelReports && <Lock size={14} className="text-muted-foreground" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Upgrade Modal for PDF/Excel Reports */}
      <UpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        feature="pdf_excel_reports"
      />
    </>
  );
}
