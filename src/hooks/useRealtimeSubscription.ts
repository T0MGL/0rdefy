/**
 * useRealtimeSubscription Hook
 *
 * Generic hook for subscribing to Realtime changes on any Supabase table
 * Automatically filters by store_id from localStorage
 *
 * @example
 * ```tsx
 * useRealtimeSubscription({
 *   table: 'products',
 *   event: 'INSERT',
 *   callback: (payload) => {
 *     logger.log('New product:', payload.new);
 *     refetchProducts();
 *   }
 * });
 * ```
 */

import { useEffect, useRef } from 'react';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { logger } from '@/utils/logger';

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface UseRealtimeSubscriptionOptions {
  /**
   * Table name to subscribe to
   */
  table: string;

  /**
   * Event type to listen for: INSERT, UPDATE, DELETE, or * for all
   */
  event: RealtimeEvent;

  /**
   * Callback function when event occurs
   */
  callback: (payload: RealtimePostgresChangesPayload<any>) => void;

  /**
   * Optional filter (e.g., { column: 'status', value: 'active' })
   */
  filter?: {
    column: string;
    value: string | number;
  };

  /**
   * Whether to automatically filter by current store_id
   * @default true
   */
  filterByStore?: boolean;

  /**
   * Explicit store_id to filter by. Overrides localStorage lookup so the
   * subscription rebinds when the active store changes (multi-store users
   * switching tenants without a page reload). Falls back to localStorage if
   * omitted, for callers that don't have AuthContext access.
   */
  storeId?: string | null;

  /**
   * Whether subscription is enabled
   * @default true
   */
  enabled?: boolean;
}

export function useRealtimeSubscription({
  table,
  event,
  callback,
  filter,
  filterByStore = true,
  storeId,
  enabled = true,
}: UseRealtimeSubscriptionOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const resolvedStoreId = storeId ?? localStorage.getItem('current_store_id');

    if (filterByStore && !resolvedStoreId) {
      logger.warn(`[Realtime] No store_id resolved. Subscription to ${table} skipped.`);
      return;
    }

    // The app authenticates via custom JWT (Express). AuthContext mints a
    // second token signed with SUPABASE_JWT_SECRET on login and pushes it
    // into the Realtime client via supabase.realtime.setAuth(...).
    // This guard is the last-line defensive check; the actual token is
    // already attached to the WebSocket handshake by the time we get here.
    const supabaseToken = localStorage.getItem('supabase_token');
    if (!supabaseToken) {
      logger.warn(`[Realtime] No supabase_token found. Subscription to ${table} skipped.`);
      return;
    }

    const channelName = `realtime:${table}:${event}:${resolvedStoreId || 'global'}`;

    logger.log(`[Realtime] Subscribing to ${table} (${event}) for store ${resolvedStoreId}`);

    let channel = supabase.channel(channelName);

    // Build filter string
    let filterString = '';
    if (filterByStore && resolvedStoreId) {
      filterString = `store_id=eq.${resolvedStoreId}`;
    }
    if (filter) {
      const additionalFilter = `${filter.column}=eq.${filter.value}`;
      filterString = filterString ? `${filterString},${additionalFilter}` : additionalFilter;
    }

    channel = channel.on(
      'postgres_changes',
      {
        event,
        schema: 'public',
        table,
        filter: filterString || undefined,
      },
      (payload) => {
        logger.log(`[Realtime] ${table} ${payload.eventType}:`, payload);
        callbackRef.current(payload);
      }
    );

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        logger.log(`[Realtime] Subscribed to ${table} (${event})`);
      } else if (status === 'CLOSED') {
        logger.log(`[Realtime] Subscription to ${table} closed`);
      } else if (status === 'CHANNEL_ERROR') {
        logger.warn(`[Realtime] Subscription to ${table} failed:`, err ?? 'no details');
      }
    });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, event, filterByStore, storeId, enabled, filter?.column, filter?.value]);

  return {
    channel: channelRef.current,
  };
}
