export interface Notification {
  id: string;
  type: 'order' | 'stock' | 'ads' | 'carrier';
  message: string;
  timestamp: string;
  read: boolean;
  priority: 'low' | 'medium' | 'high';
  actionUrl?: string;
}
