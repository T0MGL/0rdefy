import { ExportColumn } from '@/services/export.service';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';

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
    header: 'Estado',
    key: 'status',
    width: 15,
    format: (value) => {
      const statusLabels: Record<string, string> = {
        pending: 'Pendiente',
        confirmed: 'Confirmado',
        in_preparation: 'En Preparación',
        ready_to_ship: 'Preparado',
        shipped: 'En Tránsito',
        in_transit: 'En Tránsito',
        delivered: 'Entregado',
        returned: 'Devuelto',
        cancelled: 'Cancelado',
        incident: 'Incidencia',
      };
      return statusLabels[value] || value;
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
