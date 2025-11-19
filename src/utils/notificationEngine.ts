import { Notification } from '@/types/notification';
import type { Order, Product, Ad } from '@/types';
import type { Carrier } from '@/services/carriers.service';

interface NotificationEngineData {
  orders: Order[];
  products: Product[];
  ads: Ad[];
  carriers: Carrier[];
}

export function generateNotifications(data: NotificationEngineData): Notification[] {
  const { orders, products, ads, carriers } = data;
  const notifications: Notification[] = [];

  // Pedidos pendientes >24h
  const oldPending = orders.filter((o) => {
    if (o.status !== 'pending') return false;
    const orderDate = new Date(o.date);
    const now = new Date();
    const diffHours = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
    return diffHours > 24;
  });

  if (oldPending.length > 0) {
    notifications.push({
      id: 'notif-001',
      type: 'order',
      message: `${oldPending.length} pedido${oldPending.length > 1 ? 's' : ''} pendiente${oldPending.length > 1 ? 's' : ''} de confirmación por más de 24h`,
      timestamp: new Date().toISOString(),
      read: false,
      priority: 'high',
      actionUrl: '/orders',
    });
  }

  // Stock bajo (<10)
  const lowStock = products.filter((p) => p.stock < 10);
  if (lowStock.length > 0) {
    notifications.push({
      id: 'notif-002',
      type: 'stock',
      message: `${lowStock.length} producto${lowStock.length > 1 ? 's con' : ' con'} stock bajo (menos de 10 unidades)`,
      timestamp: new Date().toISOString(),
      read: false,
      priority: 'medium',
      actionUrl: '/products',
    });
  }

  // ROAS bajo (<2.5)
  const lowROAS = ads.filter((ad) => ad.status === 'active' && ad.roas < 2.5);
  if (lowROAS.length > 0) {
    notifications.push({
      id: 'notif-003',
      type: 'ads',
      message: `${lowROAS.length} campaña${lowROAS.length > 1 ? 's' : ''} con ROAS bajo. Revisa tu inversión publicitaria`,
      timestamp: new Date().toISOString(),
      read: false,
      priority: 'high',
      actionUrl: '/ads',
    });
  }

  // Transportadoras con tasa <80%
  const poorCarriers = carriers.filter((c) => (c.delivery_rate || 0) < 80);
  if (poorCarriers.length > 0) {
    notifications.push({
      id: 'notif-004',
      type: 'carrier',
      message: `${poorCarriers.length} transportadora${poorCarriers.length > 1 ? 's con' : ' con'} tasa de entrega menor al 80%`,
      timestamp: new Date().toISOString(),
      read: false,
      priority: 'medium',
      actionUrl: '/carriers',
    });
  }

  // Pedidos para entregar mañana (calcula la fecha real)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

  const tomorrowDeliveries = orders.filter((o) => {
    if (o.status !== 'confirmed' && o.status !== 'shipped') return false;
    if (!o.delivery_date) return false;

    const deliveryDate = new Date(o.delivery_date);
    deliveryDate.setHours(0, 0, 0, 0);

    return deliveryDate >= tomorrow && deliveryDate < dayAfterTomorrow;
  });

  if (tomorrowDeliveries.length > 0) {
    notifications.push({
      id: 'notif-005',
      type: 'order',
      message: `${tomorrowDeliveries.length} pedido${tomorrowDeliveries.length > 1 ? 's programados' : ' programado'} para entrega mañana`,
      timestamp: new Date().toISOString(),
      read: false,
      priority: 'low',
      actionUrl: '/orders',
    });
  }

  return notifications;
}
