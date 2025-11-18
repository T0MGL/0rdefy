/**
 * Webhook Health Monitor Component
 *
 * Real-time monitoring dashboard for Shopify webhook health
 * - Shows success rate, processing time, error breakdown
 * - Displays health status (healthy, degraded, unhealthy)
 * - Lists pending retries
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, XCircle, Activity, Clock, TrendingUp } from 'lucide-react';

interface WebhookHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  metrics: {
    total_received: number;
    total_processed: number;
    total_failed: number;
    total_duplicates: number;
    success_rate: number;
    avg_processing_time_ms: number;
    pending_retries: number;
    error_breakdown: {
      '401_unauthorized': number;
      '404_not_found': number;
      '500_server_error': number;
      'timeout': number;
      'other': number;
    };
  };
  period_hours: number;
  timestamp: string;
}

interface WebhookHealthMonitorProps {
  integrationId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // seconds
}

export const WebhookHealthMonitor: React.FC<WebhookHealthMonitorProps> = ({
  integrationId,
  autoRefresh = true,
  refreshInterval = 30,
}) => {
  const [health, setHealth] = useState<WebhookHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [processingRetries, setProcessingRetries] = useState(false);

  const fetchHealth = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch('/api/shopify/webhook-health?hours=24', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch webhook health');
      }

      const data = await response.json();
      if (data.success) {
        setHealth(data);
        setLastUpdated(new Date());
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err: any) {
      console.error('Error fetching webhook health:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const processRetryQueue = async () => {
    try {
      setProcessingRetries(true);

      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch('/api/shopify/webhook-retry/process', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();
      if (data.success) {
        // Refresh health metrics after processing
        await fetchHealth();
      }
    } catch (err: any) {
      console.error('Error processing retry queue:', err);
    } finally {
      setProcessingRetries(false);
    }
  };

  useEffect(() => {
    fetchHealth();

    if (autoRefresh) {
      const interval = setInterval(fetchHealth, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case 'unhealthy':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Activity className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      healthy: 'default',
      degraded: 'secondary',
      unhealthy: 'destructive',
    };

    return (
      <Badge variant={variants[status] || 'default'} className="text-xs">
        {status.toUpperCase()}
      </Badge>
    );
  };

  if (loading && !health) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Webhook Health</CardTitle>
          <CardDescription>Loading webhook metrics...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <Activity className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Webhook Health</CardTitle>
          <CardDescription>Error loading metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={fetchHealth} className="mt-4" size="sm">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return null;
  }

  const { status, issues, metrics, period_hours } = health;

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(status)}
              <div>
                <CardTitle>Webhook Health Monitor</CardTitle>
                <CardDescription>
                  Last {period_hours} hours • Updated{' '}
                  {lastUpdated ? lastUpdated.toLocaleTimeString() : 'never'}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(status)}
              <Button onClick={fetchHealth} size="sm" variant="outline">
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        {issues.length > 0 && (
          <CardContent>
            <Alert variant={status === 'unhealthy' ? 'destructive' : 'default'}>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Issues Detected</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  {issues.map((issue, idx) => (
                    <li key={idx} className="text-sm">
                      {issue}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Webhooks */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Received</CardDescription>
            <CardTitle className="text-3xl">{metrics.total_received}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              Processed: {metrics.total_processed} • Failed: {metrics.total_failed}
            </div>
          </CardContent>
        </Card>

        {/* Success Rate */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Success Rate</CardDescription>
            <CardTitle className="text-3xl flex items-center gap-2">
              {metrics.success_rate.toFixed(1)}%
              <TrendingUp
                className={`h-5 w-5 ${
                  metrics.success_rate >= 95
                    ? 'text-green-500'
                    : metrics.success_rate >= 80
                    ? 'text-yellow-500'
                    : 'text-red-500'
                }`}
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              Duplicates: {metrics.total_duplicates}
            </div>
          </CardContent>
        </Card>

        {/* Processing Time */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Processing Time</CardDescription>
            <CardTitle className="text-3xl flex items-center gap-2">
              {metrics.avg_processing_time_ms}
              <span className="text-sm font-normal text-muted-foreground">ms</span>
              <Clock className="h-5 w-5 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {metrics.avg_processing_time_ms < 500 ? 'Excellent' :
               metrics.avg_processing_time_ms < 1000 ? 'Good' : 'Slow'}
            </div>
          </CardContent>
        </Card>

        {/* Pending Retries */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Retries</CardDescription>
            <CardTitle className="text-3xl flex items-center gap-2">
              {metrics.pending_retries}
              <Activity className="h-5 w-5 text-orange-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              onClick={processRetryQueue}
              size="sm"
              variant="outline"
              disabled={processingRetries || metrics.pending_retries === 0}
              className="w-full"
            >
              {processingRetries ? 'Processing...' : 'Process Now'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Error Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Error Breakdown</CardTitle>
          <CardDescription>Types of errors encountered</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(metrics.error_breakdown).map(([errorType, count]) => {
              const total = metrics.total_received;
              const percentage = total > 0 ? (count / total) * 100 : 0;

              const labels: Record<string, string> = {
                '401_unauthorized': '401 Unauthorized',
                '404_not_found': '404 Not Found',
                '500_server_error': '500 Server Error',
                'timeout': 'Timeout',
                'other': 'Other',
              };

              if (count === 0) return null;

              return (
                <div key={errorType} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{labels[errorType] || errorType}</span>
                    <span className="text-muted-foreground">
                      {count} ({percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {Object.values(metrics.error_breakdown).every(count => count === 0) && (
              <div className="text-center text-sm text-muted-foreground py-4">
                No errors detected
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
