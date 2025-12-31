import { useState, useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { OnboardingGuard } from "@/components/OnboardingGuard";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DateRangeProvider } from "@/contexts/DateRangeContext";
import { PrivateRoute } from "@/components/PrivateRoute";
import { CardSkeleton } from "@/components/skeletons/CardSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShopifyAppBridgeProvider } from "@/components/ShopifyAppBridgeProvider";

// TypeScript declaration for Shopify App Bridge
declare global {
  interface Window {
    shopify?: {
      id?: {
        getToken: () => Promise<string>;
      };
    };
  }
}

// Lazy load pages for code splitting
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DashboardLogistics = lazy(() => import("./pages/DashboardLogistics"));
const Orders = lazy(() => import("./pages/Orders"));
const Warehouse = lazy(() => import("./pages/Warehouse"));
const Shipping = lazy(() => import("./pages/Shipping"));
const Returns = lazy(() => import("./pages/Returns"));
const Incidents = lazy(() => import("./pages/Incidents"));
const InventoryMovements = lazy(() => import("./pages/InventoryMovements").then(m => ({ default: m.InventoryMovements })));
const Products = lazy(() => import("./pages/Products"));
const Merchandise = lazy(() => import("./pages/Merchandise"));
const Customers = lazy(() => import("./pages/Customers"));
const Ads = lazy(() => import("./pages/Ads"));
const AdditionalValues = lazy(() => import("./pages/AdditionalValues"));
const Integrations = lazy(() => import("./pages/Integrations"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const Carriers = lazy(() => import("./pages/Carriers"));
const CarrierDetail = lazy(() => import("./pages/CarrierDetail"));
const CarrierCompare = lazy(() => import("./pages/CarrierCompare"));
const CourierPerformance = lazy(() => import("./pages/CourierPerformance"));
const Support = lazy(() => import("./pages/Support"));
const Settings = lazy(() => import("./pages/Settings"));
const Billing = lazy(() => import("./pages/Billing"));
const AcceptInvitation = lazy(() => import("./pages/AcceptInvitation"));
const Settlements = lazy(() => import("./pages/Settlements"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const LoginDemo = lazy(() => import("./pages/LoginDemo"));
const SignUp = lazy(() => import("./pages/SignUp"));
const Delivery = lazy(() => import("./pages/Delivery"));
const ShopifyOAuthCallback = lazy(() => import("./pages/ShopifyOAuthCallback"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Optimized QueryClient configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds (was 5 minutes)
      gcTime: 1000 * 60 * 5, // 5 minutes (was 10 minutes)
      refetchOnWindowFocus: true, // Enable window focus refetching for realtime feel
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

// Layout wrapper component to avoid duplication
const AppLayout = ({ children, sidebarCollapsed, onToggleSidebar }: {
  children: React.ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) => (
  <div className="flex min-h-screen w-full bg-background">
    <Sidebar collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
    <div className="flex-1 flex flex-col min-w-0">
      <Header />
      <main className="flex-1 p-6 overflow-auto">
        <Suspense fallback={<CardSkeleton count={3} />}>
          {children}
        </Suspense>
      </main>
    </div>
  </div>
);

// Protected route wrapper
const ProtectedLayout = ({ children, sidebarCollapsed, onToggleSidebar }: {
  children: React.ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) => (
  <PrivateRoute>
    <AppLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar}>
      {children}
    </AppLayout>
  </PrivateRoute>
);

const App = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed(prev => !prev);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeProvider>
            <ShopifyAppBridgeProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <AuthProvider>
                  <DateRangeProvider>
                    <ErrorBoundary>
                      <OnboardingGuard>
                        <Suspense fallback={<CardSkeleton count={1} />}>
                          <Routes>
                            {/* Public routes */}
                            <Route path="/login" element={<LoginDemo />} />
                            <Route path="/signup" element={<SignUp />} />
                            <Route path="/onboarding" element={<Onboarding />} />
                            <Route path="/accept-invite/:token" element={<AcceptInvitation />} />
                            <Route path="/delivery/:token" element={<Delivery />} />
                            <Route path="/shopify-oauth-callback" element={<ShopifyOAuthCallback />} />

                            {/* Protected routes with layout */}
                            <Route path="/" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Dashboard /></ProtectedLayout>} />
                            <Route path="/dashboard-logistics" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><DashboardLogistics /></ProtectedLayout>} />
                            <Route path="/orders" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Orders /></ProtectedLayout>} />
                            <Route path="/warehouse" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Warehouse /></ProtectedLayout>} />
                            <Route path="/shipping" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Shipping /></ProtectedLayout>} />
                            <Route path="/returns" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Returns /></ProtectedLayout>} />
                            <Route path="/incidents" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Incidents /></ProtectedLayout>} />
                            <Route path="/inventory" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><InventoryMovements /></ProtectedLayout>} />
                            <Route path="/products" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Products /></ProtectedLayout>} />
                            <Route path="/merchandise" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Merchandise /></ProtectedLayout>} />
                            <Route path="/customers" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Customers /></ProtectedLayout>} />
                            <Route path="/ads" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Ads /></ProtectedLayout>} />
                            <Route path="/additional-values" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><AdditionalValues /></ProtectedLayout>} />
                            <Route path="/integrations" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Integrations /></ProtectedLayout>} />
                            <Route path="/suppliers" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Suppliers /></ProtectedLayout>} />
                            <Route path="/carriers" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Carriers /></ProtectedLayout>} />
                            <Route path="/carriers/compare" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><CarrierCompare /></ProtectedLayout>} />
                            <Route path="/carriers/:id" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><CarrierDetail /></ProtectedLayout>} />
                            <Route path="/courier-performance" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><CourierPerformance /></ProtectedLayout>} />
                            <Route path="/settlements" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Settlements /></ProtectedLayout>} />
                            <Route path="/support" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Support /></ProtectedLayout>} />
                            <Route path="/settings" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Settings /></ProtectedLayout>} />
                            <Route path="/billing" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Billing /></ProtectedLayout>} />
                          </Routes>
                        </Suspense>
                      </OnboardingGuard>
                    </ErrorBoundary>
                  </DateRangeProvider>
                </AuthProvider>
              </BrowserRouter>
            </ShopifyAppBridgeProvider>
          </ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
