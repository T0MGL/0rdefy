/**
 * Polling Test Page
 *
 * This page demonstrates and tests smart polling functionality
 * Use this to verify:
 * - Polling starts/stops correctly
 * - Tab visibility detection works
 * - Navigation cleanup is proper
 * - No memory leaks
 * - API calls only when active
 *
 * Remove this file in production or protect with feature flag
 */

import { useState } from 'react';
import { useSmartPolling } from '@/hooks/useSmartPolling';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayCircle, PauseCircle, RefreshCw, Eye, EyeOff, Activity } from 'lucide-react';

export default function PollingTest() {
  const [logs, setLogs] = useState<string[]>([]);
  const [fetchCount, setFetchCount] = useState(0);
  const [enabled, setEnabled] = useState(true);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
  };

  // Test polling hook
  const {
    data,
    isLoading,
    isPolling,
    isPageVisible,
    refetch,
    startPolling,
    stopPolling,
  } = useSmartPolling({
    queryFn: async () => {
      setFetchCount((prev) => prev + 1);
      addLog(`🌐 API call #${fetchCount + 1}`);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));

      return {
        timestamp: new Date().toISOString(),
        data: Math.random(),
      };
    },
    interval: 3000, // 3 seconds for testing
    enabled,
    fetchOnMount: true,
    onPollingStart: () => {
      addLog('🚀 Polling started');
    },
    onPollingStop: () => {
      addLog('⏸️  Polling stopped');
    },
    onSuccess: () => {
      addLog('✅ Fetch successful');
    },
    onError: (error) => {
      addLog(`❌ Fetch failed: ${error.message}`);
    },
  });

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Smart Polling Test Page</h1>
        <p className="text-muted-foreground">
          Test and verify smart polling behavior
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity size={16} />
              Polling Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {isPolling ? (
                <>
                  <Badge className="bg-green-500">Active</Badge>
                  <span className="animate-pulse text-green-500">●</span>
                </>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {isPageVisible ? <Eye size={16} /> : <EyeOff size={16} />}
              Page Visibility
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={isPageVisible ? 'default' : 'secondary'}>
              {isPageVisible ? 'Visible' : 'Hidden'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">API Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fetchCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Loading</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={isLoading ? 'default' : 'outline'}>
              {isLoading ? 'Loading...' : 'Idle'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>
            Test different polling scenarios
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={enabled ? 'default' : 'outline'}
              onClick={() => setEnabled(!enabled)}
            >
              {enabled ? <PauseCircle size={16} className="mr-2" /> : <PlayCircle size={16} className="mr-2" />}
              {enabled ? 'Disable' : 'Enable'} Polling
            </Button>

            <Button variant="outline" onClick={refetch} disabled={!enabled}>
              <RefreshCw size={16} className="mr-2" />
              Manual Refresh
            </Button>

            <Button variant="outline" onClick={() => setLogs([])}>
              Clear Logs
            </Button>

            <Button variant="outline" onClick={() => setFetchCount(0)}>
              Reset Counter
            </Button>
          </div>

          <div className="p-4 bg-muted rounded-lg space-y-2">
            <h3 className="font-semibold text-sm">Test Scenarios:</h3>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>✅ Switch to another browser tab - polling should pause</li>
              <li>✅ Minimize window - polling should pause</li>
              <li>✅ Return to tab - polling should resume immediately</li>
              <li>✅ Navigate away from this page - polling should stop</li>
              <li>✅ Come back - polling should restart fresh</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Data Display */}
      <Card>
        <CardHeader>
          <CardTitle>Latest Data</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        </CardContent>
      </Card>

      {/* Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Logs</CardTitle>
          <CardDescription>
            Real-time logs of polling activity (max 50 entries)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-xs h-96 overflow-y-auto space-y-1">
            {logs.length === 0 ? (
              <div className="text-gray-500">No logs yet...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="hover:bg-gray-900">
                  {log}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Expected Behavior */}
      <Card className="border-orange-500">
        <CardHeader>
          <CardTitle>Expected Behavior</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">✅ When page is active:</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>See "API call" logs every 3 seconds</li>
                <li>Polling Status shows "Active" with green badge</li>
                <li>API Calls counter increases every 3 seconds</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-2">✅ When you switch tabs:</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>Page Visibility changes to "Hidden"</li>
                <li>NO new "API call" logs appear</li>
                <li>API Calls counter stops increasing</li>
                <li>Polling Status remains "Active" but paused</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-2">✅ When you return to tab:</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>Page Visibility changes to "Visible"</li>
                <li>Immediate "API call" log appears</li>
                <li>Polling resumes normally</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-2">✅ When you navigate away:</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>See "Polling stopped" log</li>
                <li>See "Component unmounting" log</li>
                <li>All timers cleaned up</li>
                <li>No more API calls</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Network Tab Instructions */}
      <Card className="border-blue-500">
        <CardHeader>
          <CardTitle>Verification with DevTools</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">📊 Network Tab Test:</h4>
              <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                <li>Open DevTools (F12) → Network tab</li>
                <li>Watch for API requests every 3 seconds</li>
                <li>Switch to another tab</li>
                <li>Wait 30 seconds</li>
                <li>Return to this tab</li>
                <li>Verify: NO requests were made while away</li>
                <li>Verify: Immediate request on return</li>
              </ol>
            </div>

            <div>
              <h4 className="font-semibold mb-2">💾 Memory Tab Test:</h4>
              <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                <li>Open DevTools → Memory tab</li>
                <li>Take heap snapshot</li>
                <li>Navigate away and back 10 times</li>
                <li>Take another heap snapshot</li>
                <li>Compare: Memory should be similar (no leaks)</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
