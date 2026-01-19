/**
 * useRealtimeTable Hook
 *
 * Higher-level hook that subscribes to ALL changes on a table
 * and automatically updates local state
 *
 * @example
 * ```tsx
 * const { data, loading, error, refetch } = useRealtimeTable<Product>({
 *   table: 'products',
 *   initialData: products,
 *   onInsert: (product) => toast({ title: `New product: ${product.name}` }),
 *   onUpdate: (product) => toast({ title: `Updated: ${product.name}` }),
 *   onDelete: (id) => toast({ title: 'Product deleted' }),
 * });
 * ```
 */

import { useState, useCallback, useEffect } from 'react';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useRealtimeSubscription } from './useRealtimeSubscription';
import { useToast } from './use-toast';
import { logger } from '@/utils/logger';

export interface UseRealtimeTableOptions<T> {
  /**
   * Table name to subscribe to
   */
  table: string;

  /**
   * Initial data (optional)
   */
  initialData?: T[];

  /**
   * Callback when new record is inserted
   */
  onInsert?: (record: T) => void;

  /**
   * Callback when record is updated
   */
  onUpdate?: (record: T) => void;

  /**
   * Callback when record is deleted
   */
  onDelete?: (id: string) => void;

  /**
   * Show toast notifications for changes
   * @default false
   */
  showNotifications?: boolean;

  /**
   * Filter by store_id automatically
   * @default true
   */
  filterByStore?: boolean;

  /**
   * Enable/disable subscription
   * @default true
   */
  enabled?: boolean;
}

export function useRealtimeTable<T extends { id: string }>({
  table,
  initialData = [],
  onInsert,
  onUpdate,
  onDelete,
  showNotifications = false,
  filterByStore = true,
  enabled = true,
}: UseRealtimeTableOptions<T>) {
  const { toast } = useToast();
  const [data, setData] = useState<T[]>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update data when initialData changes
  useEffect(() => {
    if (initialData.length > 0) {
      setData(initialData);
    }
  }, [initialData]);

  // Handle all realtime events
  const handleRealtimeChange = useCallback(
    (payload: RealtimePostgresChangesPayload<T>) => {
      logger.log(`[useRealtimeTable] ${table} change:`, payload.eventType);

      switch (payload.eventType) {
        case 'INSERT':
          if (payload.new) {
            setData((prev) => {
              // Avoid duplicates
              const exists = prev.some((item) => item.id === payload.new.id);
              if (exists) return prev;
              return [...prev, payload.new as T];
            });

            if (showNotifications) {
              toast({
                title: 'New Record',
                description: `A new ${table.slice(0, -1)} was added`,
              });
            }

            if (onInsert) {
              onInsert(payload.new as T);
            }
          }
          break;

        case 'UPDATE':
          if (payload.new) {
            setData((prev) =>
              prev.map((item) =>
                item.id === payload.new.id ? (payload.new as T) : item
              )
            );

            if (showNotifications) {
              toast({
                title: 'Record Updated',
                description: `A ${table.slice(0, -1)} was updated`,
              });
            }

            if (onUpdate) {
              onUpdate(payload.new as T);
            }
          }
          break;

        case 'DELETE':
          if (payload.old) {
            const deletedId = (payload.old as T).id;
            setData((prev) => prev.filter((item) => item.id !== deletedId));

            if (showNotifications) {
              toast({
                title: 'Record Deleted',
                description: `A ${table.slice(0, -1)} was deleted`,
                variant: 'destructive',
              });
            }

            if (onDelete) {
              onDelete(deletedId);
            }
          }
          break;
      }
    },
    [table, showNotifications, onInsert, onUpdate, onDelete, toast]
  );

  // Subscribe to all events on this table
  useRealtimeSubscription({
    table,
    event: '*',
    callback: handleRealtimeChange,
    filterByStore,
    enabled,
    showToastOnError: true,
  });

  // Manual refetch function (you can implement actual fetching logic here)
  const refetch = useCallback(() => {
    setLoading(true);
    // Implement fetch logic if needed
    // For now, just toggle loading
    setTimeout(() => setLoading(false), 100);
  }, []);

  return {
    data,
    loading,
    error,
    refetch,
    setData, // Allow manual data updates if needed
  };
}
