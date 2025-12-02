import { Notification } from '@/types/notification';
import type { Order, Product, Ad } from '@/types';
import type { Carrier } from '@/services/carriers.service';
import { isOlderThan, getHoursDifference, formatTimeAgo, getNow } from './timeUtils';

interface NotificationEngineData {
  orders: Order[];
  products: Product[];
  ads: Ad[];
  carriers: Carrier[];
}

export function generateNotifications(data: NotificationEngineData): Notification[] {
  const { orders, products, ads, carriers } = data;
  const notifications: Notification[] = [];

  // Pedidos pendientes >24h - CON TIMESTAMP PRECISO Y METADATA
  const oldPending = orders.filter((o) => {
    if (o.status !== 'pending') return false;
    return isOlderThan(o.date, 24);
  });

  if (oldPending.length > 0) {
    // Create individual notifications for critical old orders (>48h)
    const criticalOrders = oldPending.filter(o => isOlderThan(o.date, 48));

    criticalOrders.forEach((order) => {
      const hoursAgo = Math.floor(getHoursDifference(order.date));
      notifications.push({
        id: `notif-order-critical-${order.id}`,
        type: 'order',
        message: `Pedido #${order.id.substring(0, 8)} de ${order.customer} sin confirmar (${formatTimeAgo(order.date)})`,
        timestamp: getNow().toISOString(),
        read: false,
        priority: 'high',
        actionUrl: `/orders?filter=pending&highlight=${order.id}`,
        metadata: {
          orderId: order.id,
          timeReference: order.date,
          count: 1,
        },
      });
    });

    // Summary notification for all pending >24h
    if (oldPending.length > criticalOrders.length) {
      const regularOld = oldPending.filter(o => !isOlderThan(o.date, 48));
      if (regularOld.length > 0) {
        notifications.push({
          id: 'notif-orders-pending-24h',
          type: 'order',
          message: `${regularOld.length} pedido${regularOld.length > 1 ? 's' : ''} pendiente${regularOld.length > 1 ? 's' : ''} de confirmación por más de 24h`,
          timestamp: getNow().toISOString(),
          read: false,
          priority: 'high',
          actionUrl: '/orders?filter=pending&sort=oldest',
          metadata: {
            count: regularOld.length,
            itemIds: regularOld.map(o => o.id),
          },
        });
      }
    }
  }

  // Stock bajo (<10) - CON METADATA
  const lowStock = products.filter((p) => p.stock < 10);

  // Critical stock (0 units)
  const outOfStock = lowStock.filter(p => p.stock === 0);
  outOfStock.forEach((product) => {
    notifications.push({
      id: `notif-stock-critical-${product.id}`,
      type: 'stock',
      message: `⚠️ "${product.name}" sin stock disponible`,
      timestamp: getNow().toISOString(),
      read: false,
      priority: 'high',
      actionUrl: `/products?highlight=${product.id}`,
      metadata: {
        productId: product.id,
        count: 1,
      },
    });
  });

  // Low stock warning (1-9 units)
  const veryLowStock = lowStock.filter(p => p.stock > 0);
  if (veryLowStock.length > 0) {
    notifications.push({
      id: 'notif-stock-low',
      type: 'stock',
      message: `${veryLowStock.length} producto${veryLowStock.length > 1 ? 's con' : ' con'} stock bajo (menos de 10 unidades)`,
      timestamp: getNow().toISOString(),
      read: false,
      priority: 'medium',
      actionUrl: '/products?filter=low-stock',
      metadata: {
        count: veryLowStock.length,
        itemIds: veryLowStock.map(p => p.id),
      },
    });
  }

  // ROAS bajo (<2.5) - CON METADATA
  const lowROAS = ads.filter((ad) => ad.status === 'active' && ad.roas < 2.5);
  if (lowROAS.length > 0) {
    // Very low ROAS campaigns (<1.5) get individual notifications
    const criticalROAS = lowROAS.filter(ad => ad.roas < 1.5);
    criticalROAS.forEach((ad) => {
      notifications.push({
        id: `notif-ads-critical-${ad.id}`,
        type: 'ads',
        message: `Campaña "${ad.name}" con ROAS crítico (${ad.roas.toFixed(2)}x) - ¡Revisa urgente!`,
        timestamp: getNow().toISOString(),
        read: false,
        priority: 'high',
        actionUrl: `/ads?highlight=${ad.id}`,
        metadata: {
          adId: ad.id,
          count: 1,
        },
      });
    });

    // Summary for low ROAS (1.5-2.5)
    const warningROAS = lowROAS.filter(ad => ad.roas >= 1.5);
    if (warningROAS.length > 0) {
      notifications.push({
        id: 'notif-ads-low-roas',
        type: 'ads',
        message: `${warningROAS.length} campaña${warningROAS.length > 1 ? 's' : ''} con ROAS bajo. Revisa tu inversión publicitaria`,
        timestamp: getNow().toISOString(),
        read: false,
        priority: 'medium',
        actionUrl: '/ads?filter=low-roas',
        metadata: {
          count: warningROAS.length,
          itemIds: warningROAS.map(ad => ad.id),
        },
      });
    }
  }

  // Transportadoras con tasa <80% - CON METADATA
  const poorCarriers = carriers.filter((c) => (c.delivery_rate || 0) < 80);

  // Very poor carriers (<60%) get individual notifications
  const criticalCarriers = poorCarriers.filter(c => (c.delivery_rate || 0) < 60);
  criticalCarriers.forEach((carrier) => {
    notifications.push({
      id: `notif-carrier-critical-${carrier.id}`,
      type: 'carrier',
      message: `Transportadora "${carrier.name}" con tasa crítica de entrega (${carrier.delivery_rate}%) - Considera cambiar`,
      timestamp: getNow().toISOString(),
      read: false,
      priority: 'high',
      actionUrl: `/carriers/${carrier.id}`,
      metadata: {
        carrierId: carrier.id,
        count: 1,
      },
    });
  });

  // Summary for poor carriers (60-80%)
  const warningCarriers = poorCarriers.filter(c => (c.delivery_rate || 0) >= 60);
  if (warningCarriers.length > 0) {
    notifications.push({
      id: 'notif-carriers-poor',
      type: 'carrier',
      message: `${warningCarriers.length} transportadora${warningCarriers.length > 1 ? 's con' : ' con'} tasa de entrega menor al 80%`,
      timestamp: getNow().toISOString(),
      read: false,
      priority: 'medium',
      actionUrl: '/carriers?filter=poor-performance',
      metadata: {
        count: warningCarriers.length,
        itemIds: warningCarriers.map(c => c.id),
      },
    });
  }

  // Pedidos para entregar mañana - CON METADATA Y TIMEZONE CORRECTO
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
      id: 'notif-deliveries-tomorrow',
      type: 'order',
      message: `${tomorrowDeliveries.length} pedido${tomorrowDeliveries.length > 1 ? 's programados' : ' programado'} para entrega mañana`,
      timestamp: getNow().toISOString(),
      read: false,
      priority: 'low',
      actionUrl: '/orders?filter=tomorrow-delivery',
      metadata: {
        count: tomorrowDeliveries.length,
        itemIds: tomorrowDeliveries.map(o => o.id),
      },
    });
  }

  // Pedidos sin confirmar por WhatsApp (>12h)
  const unconfirmedWA = orders.filter((o) => {
    if (o.status !== 'pending') return false;
    if (o.confirmedByWhatsApp) return false;
    return isOlderThan(o.date, 12);
  });

  if (unconfirmedWA.length > 0) {
    notifications.push({
      id: 'notif-unconfirmed-whatsapp',
      type: 'order',
      message: `${unconfirmedWA.length} pedido${unconfirmedWA.length > 1 ? 's' : ''} sin confirmación de WhatsApp por más de 12h`,
      timestamp: getNow().toISOString(),
      read: false,
      priority: 'medium',
      actionUrl: '/orders?filter=pending&sort=oldest',
      metadata: {
        count: unconfirmedWA.length,
        itemIds: unconfirmedWA.map(o => o.id),
      },
    });
  }

  return notifications;
}
