/**
 * Milestone detector — fires when a store crosses a meaningful order count
 * (delivered orders, not confirmed, to avoid false positives from cancellations).
 *
 * On match:
 *   1. Computes raw stats (first order, distinct products, carriers, delivery
 *      rate, best day, accumulated margin).
 *   2. Creates a share_card row (with public + private JSON data) keyed by a
 *      22-char nanoid token.
 *   3. Sends the founder-signed milestone email to the store owner.
 *   4. Inserts into founder_emails_sent for idempotency (UNIQUE (store, type,
 *      value) prevents double sends if the trigger fires twice).
 *
 * All work happens fire-and-forget from the order status PATCH path. Failures
 * never block the order status transition.
 */

import { customAlphabet } from 'nanoid';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';
import { sendMilestoneEmail } from './email.service';

export const MILESTONE_VALUES = [1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export type MilestoneValue = (typeof MILESTONE_VALUES)[number];

const NANOID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateToken = customAlphabet(NANOID_ALPHABET, 22);

const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.ordefy.io';

interface MilestoneStats {
  firstOrderAt: string | null;
  firstOrderTotal: number;
  productCount: number;
  carrierCount: number;
  deliveryRate: number;
  bestDay: string | null;
  bestDayCount: number;
  marginAccumulated: number;
  currency: string;
}

interface OwnerInfo {
  userId: string;
  email: string;
  firstName: string;
  storeName: string;
  timezone: string;
  currency: string;
  country: string | null;
}

/**
 * Public entrypoint. Safe to call fire-and-forget.
 */
export async function checkAndSendMilestone(storeId: string, _orderId: string): Promise<void> {
  try {
    const deliveredCount = await countDeliveredOrders(storeId);
    if (!isMilestone(deliveredCount)) return;

    const milestoneValue = deliveredCount as MilestoneValue;

    // Idempotency check: skip if already sent
    const { data: existing } = await supabaseAdmin
      .from('founder_emails_sent')
      .select('id')
      .eq('store_id', storeId)
      .eq('email_type', 'milestone')
      .eq('milestone_value', milestoneValue)
      .maybeSingle();

    if (existing) {
      logger.info(
        'MILESTONE',
        `Store ${storeId} already received milestone email for value ${milestoneValue}, skipping`,
      );
      return;
    }

    const owner = await resolveOwner(storeId);
    if (!owner) {
      logger.warn('MILESTONE', `No owner with email found for store ${storeId}, skipping`);
      return;
    }

    const stats = await computeStats(storeId);
    const shareCardId = await createShareCard(storeId, milestoneValue, owner, stats);
    const shareUrl = await buildShareUrl(shareCardId);

    const emailData = buildEmailData({
      milestoneValue,
      owner,
      stats,
      shareUrl,
    });

    const result = await sendMilestoneEmail(owner.email, emailData);

    // Insert idempotency record regardless of send success — we don't want
    // to retry forever on hard failures (e.g. invalid email address).
    await supabaseAdmin.from('founder_emails_sent').insert({
      store_id: storeId,
      email_type: 'milestone',
      milestone_value: milestoneValue,
      share_card_id: shareCardId,
      message_id: result.messageId ?? null,
    });

    if (result.success) {
      logger.info(
        'MILESTONE',
        `Sent milestone ${milestoneValue} email to ${owner.email} (store=${storeId}, msg=${result.messageId})`,
      );
    } else {
      logger.error(
        'MILESTONE',
        `Failed to send milestone ${milestoneValue} email to ${owner.email}: ${result.error}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    logger.error('MILESTONE', `checkAndSendMilestone failed for store ${storeId}: ${msg}`, err);
  }
}

function isMilestone(count: number): boolean {
  return (MILESTONE_VALUES as readonly number[]).includes(count);
}

async function countDeliveredOrders(storeId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('sleeves_status', 'delivered')
    .is('deleted_at', null);

  if (error) {
    logger.warn('MILESTONE', `countDeliveredOrders failed: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

async function resolveOwner(storeId: string): Promise<OwnerInfo | null> {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('name, country, timezone, currency')
    .eq('id', storeId)
    .maybeSingle();

  if (!store) return null;

  const { data: link } = await supabaseAdmin
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!link?.user_id) return null;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email, name')
    .eq('id', link.user_id)
    .maybeSingle();

  if (!user?.email) return null;

  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'Hola';

  return {
    userId: link.user_id,
    email: user.email,
    firstName,
    storeName: store.name || 'tu tienda',
    timezone: store.timezone || 'America/Asuncion',
    currency: store.currency || 'PYG',
    country: (store.country || null) as string | null,
  };
}

async function computeStats(storeId: string): Promise<MilestoneStats> {
  // First order overall (any status, ignore deleted)
  const { data: firstOrder } = await supabaseAdmin
    .from('orders')
    .select('created_at, total_price, currency')
    .eq('store_id', storeId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // Pull all delivered orders for derived stats. Bounded by milestone size
  // (max 10000 rows). For 10000 we accept the cost — this fires once per
  // store per milestone.
  const { data: deliveredOrders } = await supabaseAdmin
    .from('orders')
    .select('id, created_at, total_price, currency')
    .eq('store_id', storeId)
    .eq('sleeves_status', 'delivered')
    .is('deleted_at', null);

  // Total shipped (delivered + cancelled-after-shipping etc) for delivery rate
  const { count: shippedCount } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .is('deleted_at', null)
    .not('in_transit_at', 'is', null);

  const { count: deliveredCount } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('sleeves_status', 'delivered')
    .is('deleted_at', null);

  const deliveryRate =
    shippedCount && shippedCount > 0
      ? Math.round(((deliveredCount ?? 0) / shippedCount) * 100)
      : 100;

  // Best day
  const dayCounts = new Map<string, number>();
  for (const o of deliveredOrders ?? []) {
    if (!o.created_at) continue;
    const day = new Date(o.created_at).toISOString().slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  let bestDay: string | null = null;
  let bestDayCount = 0;
  for (const [day, n] of dayCounts.entries()) {
    if (n > bestDayCount) {
      bestDayCount = n;
      bestDay = day;
    }
  }

  // Distinct products and carriers used by delivered orders
  const orderIds = (deliveredOrders ?? []).map((o) => o.id);

  let productCount = 0;
  let carrierCount = 0;
  let marginAccumulated = 0;

  if (orderIds.length > 0) {
    // Distinct product_ids in order_line_items
    const { data: lineItems } = await supabaseAdmin
      .from('order_line_items')
      .select('product_id, quantity, unit_price')
      .in('order_id', orderIds);

    const productIds = new Set<string>();
    const lineItemsList = lineItems ?? [];
    for (const li of lineItemsList) {
      if (li.product_id) productIds.add(li.product_id as string);
    }
    productCount = productIds.size;

    // Pull product costs for margin calc
    if (productIds.size > 0) {
      const { data: products } = await supabaseAdmin
        .from('products')
        .select('id, cost')
        .in('id', Array.from(productIds));
      const costMap = new Map<string, number>();
      for (const p of products ?? []) {
        costMap.set(p.id as string, Number(p.cost) || 0);
      }
      for (const li of lineItemsList) {
        const cost = costMap.get(li.product_id as string) ?? 0;
        const unit = Number(li.unit_price) || 0;
        const qty = Number(li.quantity) || 0;
        marginAccumulated += (unit - cost) * qty;
      }
    }

    // Distinct carriers (carrier_id on orders, when present)
    const { data: carrierRows } = await supabaseAdmin
      .from('orders')
      .select('carrier_id')
      .in('id', orderIds)
      .not('carrier_id', 'is', null);
    const carrierIds = new Set<string>();
    for (const r of carrierRows ?? []) {
      if (r.carrier_id) carrierIds.add(r.carrier_id as string);
    }
    carrierCount = carrierIds.size;
  }

  return {
    firstOrderAt: firstOrder?.created_at ?? null,
    firstOrderTotal: Number(firstOrder?.total_price) || 0,
    productCount,
    carrierCount,
    deliveryRate,
    bestDay,
    bestDayCount,
    marginAccumulated,
    currency: (firstOrder?.currency as string) || 'PYG',
  };
}

async function createShareCard(
  storeId: string,
  milestoneValue: number,
  owner: OwnerInfo,
  stats: MilestoneStats,
): Promise<string> {
  const token = generateToken();

  const publicData = {
    milestone_value: milestoneValue,
    milestone_type: 'orders',
    store_handle: `@${slugify(owner.storeName)}`,
    headline: milestoneValue === 1 ? 'Primera orden' : 'Órdenes procesadas',
  };

  const privateData = {
    milestone_value: milestoneValue,
    first_order_total: stats.firstOrderTotal,
    product_count: stats.productCount,
    carrier_count: stats.carrierCount,
    delivery_rate: stats.deliveryRate,
    best_day: stats.bestDay,
    best_day_count: stats.bestDayCount,
    margin_accumulated: stats.marginAccumulated,
    currency: stats.currency,
  };

  const { data, error } = await supabaseAdmin
    .from('share_cards')
    .insert({
      store_id: storeId,
      token,
      milestone_type: 'orders',
      milestone_value: milestoneValue,
      public_data: publicData,
      private_data: privateData,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create share_card: ${error?.message ?? 'no data'}`);
  }
  return data.id as string;
}

async function buildShareUrl(shareCardId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('share_cards')
    .select('token')
    .eq('id', shareCardId)
    .single();
  const token = data?.token ?? '';
  return `${APP_URL}/wrapped/${token}`;
}

interface BuildEmailArgs {
  milestoneValue: number;
  owner: OwnerInfo;
  stats: MilestoneStats;
  shareUrl: string;
}

function buildEmailData({ milestoneValue, owner, stats, shareUrl }: BuildEmailArgs) {
  const firstOrderDate = stats.firstOrderAt
    ? formatDateEsAR(stats.firstOrderAt, owner.timezone)
    : 'el día que arrancaste';
  const firstOrderTime = stats.firstOrderAt
    ? formatTimeEsAR(stats.firstOrderAt, owner.timezone)
    : '';
  const firstOrderAmount = formatMoney(stats.firstOrderTotal, stats.currency);
  const marginAccumulated = formatMoney(stats.marginAccumulated, stats.currency);
  const bestDay = stats.bestDay ? formatDateEsAR(stats.bestDay, owner.timezone) : 'aún por venir';

  return {
    firstName: owner.firstName,
    milestoneValue,
    firstOrderDate,
    firstOrderTime,
    firstOrderAmount,
    productCount: stats.productCount,
    carrierCount: stats.carrierCount,
    deliveryRate: stats.deliveryRate,
    bestDay,
    bestDayCount: stats.bestDayCount,
    marginAccumulated,
    shareUrl,
    currency: stats.currency,
  };
}

function formatDateEsAR(iso: string, timezone: string): string {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      day: 'numeric',
      month: 'long',
    });
    return fmt.format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

function formatTimeEsAR(iso: string, timezone: string): string {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return fmt.format(d);
  } catch {
    return '';
  }
}

function formatMoney(value: number, currency: string): string {
  const rounded = Math.round(value);
  const formatted = new Intl.NumberFormat('es-AR').format(rounded);
  if (currency === 'PYG') return `${formatted} Gs`;
  if (currency === 'USD') return `$${formatted}`;
  return `${formatted} ${currency}`;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 24) || 'tienda'
  );
}

export const __test = {
  isMilestone,
  formatMoney,
  slugify,
};
