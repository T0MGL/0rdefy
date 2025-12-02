export interface Notification {
  id: string;
  type: 'order' | 'stock' | 'ads' | 'carrier';
  message: string;
  timestamp: string;
  read: boolean;
  priority: 'low' | 'medium' | 'high';
  actionUrl?: string;
  // Metadata for specific navigation and better UX
  metadata?: {
    orderId?: string;
    productId?: string;
    adId?: string;
    carrierId?: string;
    count?: number; // Number of items affected
    itemIds?: string[]; // List of affected item IDs
    timeReference?: string; // Original time for accurate "time ago" display
  };
}
