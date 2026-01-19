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
import { useToast } from './use-toast';

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
   * Whether to show toast notifications on errors
   * @default true
   */
  showToastOnError?: boolean;

  /**
   * Whether to automatically filter by current store_id
   * @default true
   */
  filterByStore?: boolean;

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
  showToastOnError = true,
  filterByStore = true,
  enabled = true,
}: UseRealtimeSubscriptionOptions) {
  const { toast } = useToast();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const storeId = localStorage.getItem('current_store_id');

    if (filterByStore && !storeId) {
      logger.warn(`[Realtime] No store_id found in localStorage. Subscription to ${table} skipped.`);
      return;
    }

    // Create a unique channel name
    const channelName = `realtime:${table}:${event}:${storeId || 'global'}`;

    logger.log(`[Realtime] Subscribing to ${table} (${event}) for store ${storeId}`);

    // Create channel
    let channel = supabase.channel(channelName);

    // Build filter string
    let filterString = '';
    if (filterByStore && storeId) {
      filterString = `store_id=eq.${storeId}`;
    }
    if (filter) {
      const additionalFilter = `${filter.column}=eq.${filter.value}`;
      filterString = filterString ? `${filterString},${additionalFilter}` : additionalFilter;
    }

    // Subscribe to changes
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
        callback(payload);
      }
    );

    // Subscribe and handle status
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        logger.log(`[Realtime] ✅ Subscribed to ${table} (${event})`);
      } else if (status === 'CLOSED') {
        logger.log(`[Realtime] ⚠️  Subscription to ${table} closed`);
      } else if (status === 'CHANNEL_ERROR') {
        logger.error(`[Realtime] ❌ Subscription error for ${table}:`, err);
        if (showToastOnError) {
          toast({
            title: 'Realtime Error',
            description: `Failed to subscribe to ${table} updates`,
            variant: 'destructive',
          });
        }
      }
    });

    channelRef.current = channel;

    // Cleanup on unmount
    return () => {
      logger.log(`[Realtime] Unsubscribing from ${table}`);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, event, filterByStore, enabled, filter?.column, filter?.value]);

  return {
    channel: channelRef.current,
  };
}
