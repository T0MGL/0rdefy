import { ExportColumn } from '@/services/export.service';
import { formatCurrency } from '@/utils/currency';

/**
 * Export configuration for Orders
 */
export const ordersExportColumns: ExportColumn[] = [
  {
    header: 'ID Pedido',
    key: 'id',
    width: 20,
    format: (value, row: any) => {
      // Use the same logic as the UI to display friendly order IDs
      return row.shopify_order_name ||
        (row.shopify_order_number ? `#${row.shopify_order_number}` : null) ||
        (row.shopify_order_id ? `SH#${row.shopify_order_id}` : null) ||
        `OR#${value.substring(0, 8)}`;
    }
  },
  { header: 'Cliente', key: 'customer', width: 20 },
  { header: 'Teléfono', key: 'phone', width: 15 },
  { header: 'Dirección', key: 'address', width: 30 },
  { header: 'Producto', key: 'product', width: 25 },
  {
    header: 'Cantidad',
    key: 'quantity',
    width: 10,
    format: (value) => String(value || 0)
  },
  {
    header: 'Total',
    key: 'total',
    width: 15,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'Zona',
    key: 'delivery_zone',
    width: 15,
    format: (value, row: any) => {
      if (!value) return 'Sin asignar';
      const zone = String(value).toUpperCase();
      if (zone === 'ASUNCION') return 'Asunción';
      if (zone === 'CENTRAL') return 'Central';
      // For interior or other zones, show the city name
      return row?.shipping_city || String(value).replace(/_/g, ' ');
    }
  },
  { header: 'Transportadora', key: 'carrier', width: 20 },
  {
    header: 'Confirmado WhatsApp',
    key: 'confirmedByWhatsApp',
    width: 15,
    format: (value) => value ? 'Sí' : 'No'
  },
  {
    header: 'Método de Pago',
    key: 'payment_method',
    width: 15,
    format: (value) => {
      if (!value) return 'No especificado';
      const methodLabels: Record<string, string> = {
        cash: 'Efectivo',
        efectivo: 'Efectivo',
        card: 'Tarjeta',
        transfer: 'Transferencia',
        online: 'Online',
        yape: 'Yape',
        plin: 'Plin',
        pending: 'Pendiente',
      };
      return methodLabels[value.toLowerCase()] || value;
    }
  },
  {
    header: 'Fecha',
    key: 'date',
    width: 20,
    format: (value) => {
      if (!value) return '';
      const date = new Date(value);
      return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  },
];

/**
 * Factory: Planilla de carga oficial para transportadoras.
 * Columnas exactas que exigen los carriers para importar pedidos:
 * CODIGO | EMPRESA | TELEFONO | DIRECCION | NOMBRE Y APELLIDO | CIUDAD |
 * BARRIO | REFERENCIA | CANTIDAD | PRODUCTO | IMPORTE | FECHA | UBICACIÓN | NOTA
 *
 * @param storeName - Nombre de la tienda (columna EMPRESA)
 */
export function createPlanillaTransportadoraColumns(storeName: string): ExportColumn[] {
  return [
    {
      header: 'CODIGO',
      key: 'id',
      width: 18,
      format: (value, row: any) =>
        row?.shopify_order_name ||
        (row?.shopify_order_number ? `#${row.shopify_order_number}` : null) ||
        `#${String(value).substring(0, 8).toUpperCase()}`,
    },
    {
      header: 'EMPRESA',
      // Use a dummy key that doesn't exist on the order object so it doesn't
      // conflict with the 'id' key used by CODIGO. ExcelJS maps row data by key,
      // so two columns sharing the same key would overwrite each other in rowData.
      // The format function ignores the (undefined) value and returns storeName directly.
      key: '_empresa',
      width: 22,
      format: () => storeName,
    },
    {
      header: 'TELEFONO',
      key: 'phone',
      width: 15,
      format: (value) => value ? String(value).replace(/\s+/g, '') : '',
    },
    {
      header: 'DIRECCION',
      key: 'address',
      width: 35,
      format: (value) => value || '',
    },
    {
      header: 'NOMBRE Y APELLIDO',
      key: 'customer',
      width: 25,
      format: (value) => value || '',
    },
    {
      header: 'CIUDAD',
      key: 'shipping_city',
      width: 20,
      format: (value, row: any) => value || row?.delivery_zone || '',
    },
    {
      header: 'BARRIO',
      key: 'neighborhood',
      width: 20,
      format: (value) => value || '',
    },
    {
      header: 'REFERENCIA',
      key: 'address_reference',
      width: 25,
      format: (value) => value || '',
    },
    {
      header: 'CANTIDAD',
      key: 'quantity',
      width: 10,
      format: (value) => String(value ?? 0),
    },
    {
      header: 'PRODUCTO',
      key: 'product',
      width: 32,
      format: (value) => value || '',
    },
    {
      header: 'IMPORTE',
      key: 'total',
      width: 14,
      // Plain number — carriers need it for calculations, no currency symbol.
      // Guard against NaN in case value is null/undefined/non-numeric.
      format: (value) => {
        const n = Number(value);
        return !isNaN(n) ? String(n) : '0';
      },
    },
    {
      header: 'FECHA',
      key: 'date',
      width: 12,
      format: (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${d.getFullYear()}`;
      },
    },
    {
      header: 'UBICACIÓN',
      // Google Maps link for delivery location pinning
      key: 'google_maps_link',
      width: 25,
      format: (value) => value || '',
    },
    {
      header: 'NOTA',
      key: 'delivery_notes',
      width: 32,
      format: (value, row: any) => {
        const parts = [value, row?.internal_notes].filter(Boolean);
        return parts.join(' | ');
      },
    },
  ];
}

/**
 * Export configuration for Products
 */
export const productsExportColumns: ExportColumn[] = [
  { header: 'ID', key: 'id', width: 20 },
  { header: 'Nombre', key: 'name', width: 25 },
  {
    header: 'Precio',
    key: 'price',
    width: 15,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'Costo',
    key: 'cost',
    width: 15,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'Stock',
    key: 'stock',
    width: 10,
    format: (value) => String(value || 0)
  },
  {
    header: 'Rentabilidad (%)',
    key: 'profitability',
    width: 15,
    format: (value) => `${value || 0}%`
  },
  {
    header: 'Ventas Totales',
    key: 'sales',
    width: 15,
    format: (value) => String(value || 0)
  },
  { header: 'Imagen URL', key: 'image', width: 40 },
];

/**
 * Export configuration for Customers
 */
export const customersExportColumns: ExportColumn[] = [
  { header: 'ID', key: 'id', width: 20 },
  { header: 'Nombre', key: 'first_name', width: 20 },
  { header: 'Apellido', key: 'last_name', width: 20 },
  { header: 'Email', key: 'email', width: 30 },
  { header: 'Teléfono', key: 'phone', width: 15 },
  {
    header: 'Acepta Marketing',
    key: 'accepts_marketing',
    width: 15,
    format: (value) => value ? 'Sí' : 'No'
  },
  {
    header: 'Total Pedidos',
    key: 'total_orders',
    width: 15,
    format: (value) => String(value || 0)
  },
  {
    header: 'Total Gastado',
    key: 'total_spent',
    width: 20,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'Fecha Creación',
    key: 'created_at',
    width: 20,
    format: (value) => {
      if (!value) return '';
      const date = new Date(value);
      return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  },
];

/**
 * Export configuration for Campaigns/Ads
 */
export const campaignsExportColumns: ExportColumn[] = [
  { header: 'ID', key: 'id', width: 20 },
  { header: 'Nombre', key: 'name', width: 25 },
  { header: 'Plataforma', key: 'platform', width: 15 },
  {
    header: 'Estado',
    key: 'status',
    width: 15,
    format: (value) => {
      const statusLabels: Record<string, string> = {
        active: 'Activa',
        paused: 'Pausada',
        ended: 'Finalizada',
      };
      return statusLabels[value] || value;
    }
  },
  {
    header: 'Inversión',
    key: 'investment',
    width: 20,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'Ingresos',
    key: 'revenue',
    width: 20,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'ROI',
    key: 'roi',
    width: 10,
    format: (value) => `${Number(value || 0).toFixed(1)}%`
  },
  {
    header: 'Conversiones',
    key: 'conversions',
    width: 15,
    format: (value) => String(value || 0)
  },
  {
    header: 'Fecha Inicio',
    key: 'startDate',
    width: 20,
    format: (value) => {
      if (!value) return '';
      const date = new Date(value);
      return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  },
  {
    header: 'Fecha Fin',
    key: 'endDate',
    width: 20,
    format: (value) => {
      if (!value) return '';
      const date = new Date(value);
      return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  },
];

/**
 * Export configuration for Suppliers
 */
export const suppliersExportColumns: ExportColumn[] = [
  { header: 'ID', key: 'id', width: 20 },
  { header: 'Nombre', key: 'name', width: 25 },
  { header: 'Contacto', key: 'contact', width: 20 },
  { header: 'Email', key: 'email', width: 30 },
  { header: 'Teléfono', key: 'phone', width: 15 },
  {
    header: 'Productos Suministrados',
    key: 'productsSupplied',
    width: 15,
    format: (value) => String(value || 0)
  },
  {
    header: 'Calificación',
    key: 'rating',
    width: 12,
    format: (value) => `${Number(value || 0).toFixed(1)} / 5.0`
  },
];

/**
 * Export configuration for Carriers/Couriers
 */
export const carriersExportColumns: ExportColumn[] = [
  { header: 'ID', key: 'id', width: 20 },
  { header: 'Nombre', key: 'name', width: 25 },
  {
    header: 'Tarifa Base',
    key: 'baseRate',
    width: 20,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'Tarifa/Km',
    key: 'perKmRate',
    width: 20,
    format: (value) => formatCurrency(Number(value || 0))
  },
  {
    header: 'Entregas Totales',
    key: 'totalDeliveries',
    width: 15,
    format: (value) => String(value || 0)
  },
  {
    header: 'Tasa Éxito (%)',
    key: 'successRate',
    width: 15,
    format: (value) => `${Number(value || 0).toFixed(1)}%`
  },
  {
    header: 'Tiempo Promedio (días)',
    key: 'avgDeliveryTime',
    width: 20,
    format: (value) => `${Number(value || 0).toFixed(1)} días`
  },
  {
    header: 'Calificación',
    key: 'rating',
    width: 12,
    format: (value) => `${Number(value || 0).toFixed(1)} / 5.0`
  },
];
