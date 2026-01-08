// Pre-filled demo data templates for the interactive tour

export const demoCarrierTemplate = {
  name: 'Delivery Express (Demo)',
  code: 'DEMO-EXPRESS',
  phone: '+595 21 555 1234',
  email: 'demo@deliveryexpress.com.py',
  zones: [
    { zone_name: 'Asuncion', price: 25000, delivery_time: '1-2 días' },
    { zone_name: 'Central', price: 35000, delivery_time: '2-3 días' },
    { zone_name: 'Interior', price: 45000, delivery_time: '3-5 días' },
  ],
};

export const demoProductTemplate = {
  name: 'Camiseta Básica (Demo)',
  sku: 'DEMO-CAM-001',
  price: 150000,
  cost: 50000,
  stock: 10,
  category: 'Ropa',
  description: 'Camiseta de algodón premium para el tour de demostración.',
};

export const demoCustomerTemplate = {
  name: 'Juan Pérez (Demo)',
  email: 'juan.perez.demo@example.com',
  phone: '+595 981 555 1234',
  address: 'Av. Mariscal López 1234',
  city: 'Asuncion',
  notes: 'Cliente de demostración para el tour guiado.',
};

export const demoOrderTemplate = {
  customer_name: 'Juan Pérez (Demo)',
  customer_email: 'juan.perez.demo@example.com',
  customer_phone: '+595 981 555 1234',
  shipping_address: 'Av. Mariscal López 1234, Asuncion',
  shipping_zone: 'Asuncion',
  notes: 'Pedido de demostración - se eliminará automáticamente.',
  quantity: 2,
};

export const demoSupplierTemplate = {
  name: 'Proveedor Demo S.A.',
  contact_name: 'María García',
  email: 'maria@proveedor-demo.com',
  phone: '+595 21 555 4321',
  address: 'Zona Industrial, Luque',
};

export const demoInboundShipmentTemplate = {
  supplier_name: 'Proveedor Demo S.A.',
  reference: 'DEMO-ISH-001',
  expected_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
  notes: 'Envío de demostración - tour guiado.',
  items: [
    { product_name: 'Camiseta Básica (Demo)', quantity: 20, unit_cost: 45000 },
  ],
};

// Marker suffix to identify demo data
export const DEMO_MARKER = '(Demo)';

// Check if an item is demo data
export function isDemoData(name: string): boolean {
  return name.includes(DEMO_MARKER);
}

// Format demo data for display
export function formatDemoPrice(price: number): string {
  return new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency: 'PYG',
    minimumFractionDigits: 0,
  }).format(price);
}
