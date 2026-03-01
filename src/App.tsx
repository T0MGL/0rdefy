import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { OnboardingGuard } from "@/components/OnboardingGuard";
import { AuthProvider, Module } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DateRangeProvider } from "@/contexts/DateRangeContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { GlobalViewProvider } from "@/contexts/GlobalViewContext";
// OnboardingTourProvider removed - using DemoTourProvider only
import { DemoTourProvider } from "@/components/demo-tour/DemoTourProvider";
import { PrivateRoute } from "@/components/PrivateRoute";
import { PermissionRoute } from "@/components/PermissionRoute";
import { CardSkeleton } from "@/components/skeletons/CardSkeleton";
import { PageSkeleton } from "@/components/LoadingSkeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShopifyAppBridgeProvider } from "@/components/ShopifyAppBridgeProvider";
import { PlanLimitHandler } from "@/components/PlanLimitHandler";
import { notificationsService } from "@/services/notifications.service";
// Lazy load DemoTour - only loaded when tour is triggered
const DemoTour = lazy(() => import("@/components/demo-tour").then(m => ({ default: m.DemoTour })));

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
const Warehouse = lazy(() => import("./pages/WarehouseNew"));
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
const Invoicing = lazy(() => import("./pages/Invoicing"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Optimized QueryClient configuration for production cost control
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes - Longer cache reduces API calls
      gcTime: 1000 * 60 * 10, // 10 minutes - Keeps recently accessed data in memory
      refetchOnWindowFocus: false, // ✅ DISABLED: Prevents extra API calls on tab switch (was causing 2x requests)
      refetchOnReconnect: true, // Keep enabled - important for network recovery
      retry: 1,
    },
  },
});

// Skip link component for accessibility
const SkipLink = () => (
  <a
    href="#main-content"
    className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
  >
    Saltar al contenido principal
  </a>
);

// Layout wrapper component to avoid duplication
// Sidebar now handles its own hover-based expansion state internally
// Mobile: Bottom tabs navigation, Desktop: Sidebar
const AppLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-screen w-full bg-background">
    <SkipLink />
    {/* Sidebar - Hidden on mobile, visible on lg+ */}
    <div className="hidden lg:block">
      <Sidebar />
    </div>
    <div className="flex-1 flex flex-col min-w-0">
      <Header />
      {/* Main content - Add bottom padding on mobile for bottom nav */}
      <main id="main-content" className="flex-1 p-4 sm:p-6 pb-24 lg:pb-6 overflow-auto" tabIndex={-1}>
        <Suspense fallback={<PageSkeleton />}>
          {children}
        </Suspense>
      </main>
    </div>
    {/* Mobile Bottom Navigation - Visible only on mobile */}
    <MobileBottomNav />
  </div>
);

// Protected route wrapper (basic auth only)
const ProtectedLayout = ({ children }: { children: React.ReactNode }) => (
  <PrivateRoute>
    <AppLayout>
      {children}
    </AppLayout>
  </PrivateRoute>
);

// Protected route wrapper with permission check
const PermissionLayout = ({ children, module }: {
  children: React.ReactNode;
  module: Module;
}) => (
  <PermissionRoute module={module}>
    <AppLayout>
      {children}
    </AppLayout>
  </PermissionRoute>
);

const App = () => {
  // Sidebar now manages its own hover-based expansion state internally
  // No more prop drilling for collapsed state!

  // Cleanup singleton services on app unmount
  useEffect(() => {
    return () => {
      notificationsService.destroy();
    };
  }, []);

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
                      <GlobalViewProvider>
                        <DemoTourProvider>
                        <ErrorBoundary>
                          <OnboardingGuard>
                            {/* Demo Tour - interactive onboarding experience (lazy loaded) */}
                            {/* ErrorBoundary wraps DemoTour to prevent crashes from breaking the app */}
                            <ErrorBoundary fallback={<div />}>
                              <Suspense fallback={<div className="hidden" />}>
                                <DemoTour autoStart={true} />
                              </Suspense>
                            </ErrorBoundary>
                            {/* Suspense now handled inside AppLayout to keep Sidebar/Header visible during page transitions */}
                              <Routes>
                            {/* Public routes - wrapped in Suspense for lazy loading */}
                            <Route path="/login" element={<Suspense fallback={<div className="hidden" />}><LoginDemo /></Suspense>} />
                            <Route path="/signup" element={<Suspense fallback={<div className="hidden" />}><SignUp /></Suspense>} />
                            <Route path="/onboarding" element={<Suspense fallback={<div className="hidden" />}><Onboarding /></Suspense>} />
                            <Route path="/i/:token" element={<Suspense fallback={<div className="hidden" />}><AcceptInvitation /></Suspense>} />
                            <Route path="/accept-invite/:token" element={<Suspense fallback={<div className="hidden" />}><AcceptInvitation /></Suspense>} />
                            <Route path="/delivery/:token" element={<Suspense fallback={<div className="hidden" />}><Delivery /></Suspense>} />
                            <Route path="/shopify-oauth-callback" element={<Suspense fallback={<div className="hidden" />}><ShopifyOAuthCallback /></Suspense>} />
                            <Route path="/r/:code" element={<Suspense fallback={<div className="hidden" />}><Referral /></Suspense>} />
                            <Route path="/onboarding/plan" element={<PrivateRoute><Suspense fallback={<div className="hidden" />}><OnboardingPlan /></Suspense></PrivateRoute>} />

                            {/* Protected routes with layout and permission checks */}
                            {/* Dashboard - accessible to all authenticated users */}
                            <Route path="/" element={<PermissionLayout module={Module.DASHBOARD} ><Dashboard /></PermissionLayout>} />
                            <Route path="/dashboard-logistics" element={<PermissionLayout module={Module.WAREHOUSE} ><DashboardLogistics /></PermissionLayout>} />
                            <Route path="/logistics" element={<PermissionLayout module={Module.ANALYTICS} ><Logistics /></PermissionLayout>} />

                            {/* Orders module */}
                            <Route path="/orders" element={<PermissionLayout module={Module.ORDERS} ><Orders /></PermissionLayout>} />
                            <Route path="/incidents" element={<PermissionLayout module={Module.ORDERS} ><Incidents /></PermissionLayout>} />

                            {/* Warehouse module */}
                            <Route path="/warehouse" element={<PermissionLayout module={Module.WAREHOUSE} ><Warehouse /></PermissionLayout>} />
                            <Route path="/shipping" element={<PermissionLayout module={Module.WAREHOUSE} ><Shipping /></PermissionLayout>} />

                            {/* Returns module */}
                            <Route path="/returns" element={<PermissionLayout module={Module.RETURNS} ><Returns /></PermissionLayout>} />

                            {/* Products module */}
                            <Route path="/products" element={<PermissionLayout module={Module.PRODUCTS} ><Products /></PermissionLayout>} />
                            <Route path="/inventory" element={<PermissionLayout module={Module.PRODUCTS} ><InventoryMovements /></PermissionLayout>} />

                            {/* Merchandise module */}
                            <Route path="/merchandise" element={<PermissionLayout module={Module.MERCHANDISE} ><Merchandise /></PermissionLayout>} />

                            {/* Customers module */}
                            <Route path="/customers" element={<PermissionLayout module={Module.CUSTOMERS} ><Customers /></PermissionLayout>} />

                            {/* Campaigns module */}
                            <Route path="/ads" element={<PermissionLayout module={Module.CAMPAIGNS} ><Ads /></PermissionLayout>} />

                            {/* Analytics module */}
                            <Route path="/additional-values" element={<PermissionLayout module={Module.ANALYTICS} ><AdditionalValues /></PermissionLayout>} />

                            {/* Integrations module */}
                            <Route path="/integrations" element={<PermissionLayout module={Module.INTEGRATIONS} ><Integrations /></PermissionLayout>} />

                            {/* Suppliers module */}
                            <Route path="/suppliers" element={<PermissionLayout module={Module.SUPPLIERS} ><Suppliers /></PermissionLayout>} />

                            {/* Carriers module */}
                            <Route path="/carriers" element={<PermissionLayout module={Module.CARRIERS} ><Carriers /></PermissionLayout>} />
                            <Route path="/carriers/compare" element={<PermissionLayout module={Module.CARRIERS} ><CarrierCompare /></PermissionLayout>} />
                            <Route path="/carriers/:id" element={<PermissionLayout module={Module.CARRIERS} ><CarrierDetail /></PermissionLayout>} />
                            <Route path="/courier-performance" element={<PermissionLayout module={Module.CARRIERS} ><CourierPerformance /></PermissionLayout>} />
                            <Route path="/settlements" element={<PermissionLayout module={Module.CARRIERS} ><Settlements /></PermissionLayout>} />

                            {/* Support - no permission check, accessible to all authenticated users */}
                            <Route path="/support" element={<ProtectedLayout ><Support /></ProtectedLayout>} />

                            {/* Settings module */}
                            <Route path="/settings" element={<PermissionLayout module={Module.SETTINGS} ><Settings /></PermissionLayout>} />

                            {/* Invoicing module - Paraguay only */}
                            <Route path="/facturacion" element={<PermissionLayout module={Module.INVOICING} ><Invoicing /></PermissionLayout>} />

                            {/* Billing module - Owner only */}
                            <Route path="/billing" element={<PermissionLayout module={Module.BILLING} ><Billing /></PermissionLayout>} />
                          </Routes>
                        </OnboardingGuard>
                        </ErrorBoundary>
                        </DemoTourProvider>
                      </GlobalViewProvider>
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
