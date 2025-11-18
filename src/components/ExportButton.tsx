import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ExportButtonProps {
  data: any[];
  filename: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
}

export function ExportButton({ data, filename, variant = 'outline', size = 'default' }: ExportButtonProps) {
  const { toast } = useToast();

  const handleExport = (format: 'sheets' | 'csv' | 'excel') => {
    // Preparado para backend - por ahora solo notifica
    toast({
      title: '🚀 Exportación preparada',
      description: `Se exportarán ${data.length} registros a ${format === 'sheets' ? 'Google Sheets' : format.toUpperCase()}. Funcionalidad disponible próximamente.`,
    });
    
    // TODO: Backend endpoint
    // await fetch('/api/export', {
    //   method: 'POST',
    //   body: JSON.stringify({ data, format, filename })
    // });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className="gap-2">
          <Download size={16} />
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => handleExport('sheets')} className="gap-2">
          <FileSpreadsheet size={16} className="text-green-600" />
          <div>
            <p className="font-medium">Google Sheets</p>
            <p className="text-xs text-muted-foreground">Exportar en línea</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('excel')} className="gap-2">
          <FileSpreadsheet size={16} className="text-blue-600" />
          <div>
            <p className="font-medium">Excel (.xlsx)</p>
            <p className="text-xs text-muted-foreground">Descargar archivo</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('csv')} className="gap-2">
          <FileText size={16} className="text-gray-600" />
          <div>
            <p className="font-medium">CSV</p>
            <p className="text-xs text-muted-foreground">Valores separados por coma</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
