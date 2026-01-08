import { useState, useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { OnboardingGuard } from "@/components/OnboardingGuard";
import { AuthProvider, Module } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DateRangeProvider } from "@/contexts/DateRangeContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { PrivateRoute } from "@/components/PrivateRoute";
import { PermissionRoute } from "@/components/PermissionRoute";
import { CardSkeleton } from "@/components/skeletons/CardSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShopifyAppBridgeProvider } from "@/components/ShopifyAppBridgeProvider";
import { PlanLimitHandler } from "@/components/PlanLimitHandler";

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
const Logistics = lazy(() => import("./pages/Logistics"));
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
const Referral = lazy(() => import("./pages/Referral"));
const OnboardingPlan = lazy(() => import("./pages/OnboardingPlan"));
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

// Protected route wrapper (basic auth only)
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

// Protected route wrapper with permission check
const PermissionLayout = ({ children, module, sidebarCollapsed, onToggleSidebar }: {
  children: React.ReactNode;
  module: Module;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) => (
  <PermissionRoute module={module}>
    <AppLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar}>
      {children}
    </AppLayout>
  </PermissionRoute>
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
                  <SubscriptionProvider>
                    <PlanLimitHandler />
                    <DateRangeProvider>
                      <ErrorBoundary>
                        <OnboardingGuard>
                        <Suspense fallback={<CardSkeleton count={1} />}>
                          <Routes>
                            {/* Public routes */}
                            <Route path="/login" element={<LoginDemo />} />
                            <Route path="/signup" element={<SignUp />} />
                            <Route path="/onboarding" element={<Onboarding />} />
                            <Route path="/i/:token" element={<AcceptInvitation />} />
                            <Route path="/accept-invite/:token" element={<AcceptInvitation />} />
                            <Route path="/delivery/:token" element={<Delivery />} />
                            <Route path="/shopify-oauth-callback" element={<ShopifyOAuthCallback />} />
                            <Route path="/r/:code" element={<Referral />} />
                            <Route path="/onboarding/plan" element={<PrivateRoute><OnboardingPlan /></PrivateRoute>} />

                            {/* Protected routes with layout and permission checks */}
                            {/* Dashboard - accessible to all authenticated users */}
                            <Route path="/" element={<PermissionLayout module={Module.DASHBOARD} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Dashboard /></PermissionLayout>} />
                            <Route path="/dashboard-logistics" element={<PermissionLayout module={Module.WAREHOUSE} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><DashboardLogistics /></PermissionLayout>} />
                            <Route path="/logistics" element={<PermissionLayout module={Module.ANALYTICS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Logistics /></PermissionLayout>} />

                            {/* Orders module */}
                            <Route path="/orders" element={<PermissionLayout module={Module.ORDERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Orders /></PermissionLayout>} />
                            <Route path="/incidents" element={<PermissionLayout module={Module.ORDERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Incidents /></PermissionLayout>} />

                            {/* Warehouse module */}
                            <Route path="/warehouse" element={<PermissionLayout module={Module.WAREHOUSE} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Warehouse /></PermissionLayout>} />
                            <Route path="/shipping" element={<PermissionLayout module={Module.WAREHOUSE} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Shipping /></PermissionLayout>} />

                            {/* Returns module */}
                            <Route path="/returns" element={<PermissionLayout module={Module.RETURNS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Returns /></PermissionLayout>} />

                            {/* Products module */}
                            <Route path="/products" element={<PermissionLayout module={Module.PRODUCTS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Products /></PermissionLayout>} />
                            <Route path="/inventory" element={<PermissionLayout module={Module.PRODUCTS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><InventoryMovements /></PermissionLayout>} />

                            {/* Merchandise module */}
                            <Route path="/merchandise" element={<PermissionLayout module={Module.MERCHANDISE} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Merchandise /></PermissionLayout>} />

                            {/* Customers module */}
                            <Route path="/customers" element={<PermissionLayout module={Module.CUSTOMERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Customers /></PermissionLayout>} />

                            {/* Campaigns module */}
                            <Route path="/ads" element={<PermissionLayout module={Module.CAMPAIGNS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Ads /></PermissionLayout>} />

                            {/* Analytics module */}
                            <Route path="/additional-values" element={<PermissionLayout module={Module.ANALYTICS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><AdditionalValues /></PermissionLayout>} />

                            {/* Integrations module */}
                            <Route path="/integrations" element={<PermissionLayout module={Module.INTEGRATIONS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Integrations /></PermissionLayout>} />

                            {/* Suppliers module */}
                            <Route path="/suppliers" element={<PermissionLayout module={Module.SUPPLIERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Suppliers /></PermissionLayout>} />

                            {/* Carriers module */}
                            <Route path="/carriers" element={<PermissionLayout module={Module.CARRIERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Carriers /></PermissionLayout>} />
                            <Route path="/carriers/compare" element={<PermissionLayout module={Module.CARRIERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><CarrierCompare /></PermissionLayout>} />
                            <Route path="/carriers/:id" element={<PermissionLayout module={Module.CARRIERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><CarrierDetail /></PermissionLayout>} />
                            <Route path="/courier-performance" element={<PermissionLayout module={Module.CARRIERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><CourierPerformance /></PermissionLayout>} />
                            <Route path="/settlements" element={<PermissionLayout module={Module.CARRIERS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Settlements /></PermissionLayout>} />

                            {/* Support - no permission check, accessible to all authenticated users */}
                            <Route path="/support" element={<ProtectedLayout sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Support /></ProtectedLayout>} />

                            {/* Settings module */}
                            <Route path="/settings" element={<PermissionLayout module={Module.SETTINGS} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Settings /></PermissionLayout>} />

                            {/* Billing module - Owner only */}
                            <Route path="/billing" element={<PermissionLayout module={Module.BILLING} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar}><Billing /></PermissionLayout>} />
                          </Routes>
                        </Suspense>
                      </OnboardingGuard>
                      </ErrorBoundary>
                    </DateRangeProvider>
                  </SubscriptionProvider>
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
