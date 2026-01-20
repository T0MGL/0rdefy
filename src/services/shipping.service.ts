/**
 * Shipping Service (Frontend)
 * Handles order dispatch to couriers
 */

import apiClient from './api.client';

const BASE_URL = '/shipping';

export interface ReadyToShipOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  carrier_name: string;
  carrier_id: string;
  total_items: number;
  cod_amount: number;
  created_at: string;
  // Shopify order identifiers
  shopify_order_name?: string;
  shopify_order_number?: string;
  shopify_order_id?: string;
}

export interface Shipment {
  id: string;
  store_id: string;
  order_id: string;
  courier_id: string | null;
  shipped_at: string;
  shipped_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentResult {
  shipment_id: string | null;
  order_id: string;
  order_number: string;
  success: boolean;
  error_message: string | null;
}

export interface BatchDispatchResponse {
  total: number;
  succeeded: number;
  failed: number;
  results: ShipmentResult[];
}

/**
 * Gets all orders ready to ship (status: ready_to_ship)
 */
export async function getReadyToShipOrders(): Promise<ReadyToShipOrder[]> {
  const response = await apiClient.get<ReadyToShipOrder[]>(`${BASE_URL}/ready-to-ship`);
  return response.data;
}

/**
 * Dispatches a single order to courier
 */
export async function dispatchOrder(orderId: string, notes?: string): Promise<Shipment> {
  const response = await apiClient.post<Shipment>(`${BASE_URL}/dispatch`, {
    orderId,
    notes
  });
  return response.data;
}

/**
 * Dispatches multiple orders to couriers at once
 */
export async function dispatchBatch(
  orderIds: string[],
  notes?: string
): Promise<BatchDispatchResponse> {
  const response = await apiClient.post<BatchDispatchResponse>(`${BASE_URL}/dispatch-batch`, {
    orderIds,
    notes
  });
  return response.data;
}

/**
 * Gets shipment history for a specific order
 */
export async function getOrderShipments(orderId: string): Promise<Shipment[]> {
  const response = await apiClient.get<Shipment[]>(`${BASE_URL}/order/${orderId}`);
  return response.data;
}

/**
 * Gets shipment history for the store (paginated)
 */
export async function getShipmentHistory(
  limit: number = 50,
  offset: number = 0
): Promise<{ shipments: Shipment[]; total: number }> {
  const response = await apiClient.get<{ shipments: Shipment[]; total: number }>(
    `${BASE_URL}/history?limit=${limit}&offset=${offset}`
  );
  return response.data;
}

/**
 * Generates a CSV file for courier delivery tracking (Legacy - plain CSV)
 * @deprecated Use exportDispatchExcel instead for professional formatted spreadsheet
 */
export function generateDispatchCSV(orders: ReadyToShipOrder[], carrierName: string): void {
  // CSV Headers in Spanish for courier compatibility
  const headers = [
    'PEDIDO',
    'CLIENTE',
    'TELEFONO',
    'DIRECCION',
    'CIUDAD',
    'MONTO_COD',
    'TRANSPORTADORA',
    'ESTADO_ENTREGA',
    'MONTO_COBRADO',
    'MOTIVO_FALLA',
    'NOTAS'
  ];

  // Build CSV rows
  const rows = orders.map(order => {
    const addressParts = order.customer_address?.split(',') || [];
    const city = addressParts.length > 1 ? addressParts[addressParts.length - 1].trim() : '';
    const orderNumber = order.order_number;

    return [
      orderNumber,
      order.customer_name || '',
      order.customer_phone || '',
      order.customer_address || '',
      city,
      order.cod_amount?.toString() || '0',
      order.carrier_name || carrierName,
      '', '', '', ''
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const today = new Date();
  const dateStr = today.toLocaleDateString('es-PY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '');
  const filename = `DESPACHO-${carrierName.toUpperCase().replace(/\s+/g, '_')}-${dateStr}.csv`;

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.URL.revokeObjectURL(url);
  }
}

/**
 * Exports selected orders as professional Excel file with Ordefy branding
 * Features:
 * - Ordefy brand colors and styling (purple headers, yellow for editable columns)
 * - Dropdown validation for ESTADO_ENTREGA and MOTIVO
 * - Protected columns that courier shouldn't edit
 * - Clear instructions for courier
 * - Number formatting for amounts
 * - Summary section with totals
 */
export async function exportDispatchExcel(orders: ReadyToShipOrder[], carrierName: string): Promise<void> {
  const orderIds = orders.map(o => o.id);

  const response = await apiClient.post<Blob>(
    `${BASE_URL}/export-excel`,
    { orderIds, carrierName },
    { responseType: 'blob' }
  );

  // Generate filename with date
  const today = new Date();
  const dateStr = today.toLocaleDateString('es-PY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '');
  const sanitizedCarrier = carrierName.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
  const filename = `DESPACHO-${sanitizedCarrier}-${dateStr}.xlsx`;

  // Download the file
  const blob = new Blob([response.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = window.URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.URL.revokeObjectURL(url);
  }
}
