import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShopifyIntegrationModal } from '@/components/ShopifyIntegrationModal';
import { ShopifyConnectionMethodDialog } from '@/components/ShopifyConnectionMethodDialog';
import { ShopifyManualConnectDialog } from '@/components/ShopifyManualConnectDialog';
import { ShopifyConnectDialog } from '@/components/ShopifyConnectDialog';
import { ExternalWebhookSetupDialog } from '@/components/ExternalWebhookSetupDialog';
import { ExternalWebhookManagementModal } from '@/components/ExternalWebhookManagementModal';
import { OutboundWebhookManager } from '@/components/OutboundWebhookManager';
import { Store, Package, Clock, CheckCircle2, Settings, Webhook, Zap, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { shopifyService } from '@/services/shopify.service';
import { externalWebhookService } from '@/services/external-webhook.service';
import { outboundWebhookService } from '@/services/outbound-webhook.service';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { onboardingService } from '@/services/onboarding.service';
import { logger } from '@/utils/logger';
import { useAuth } from '@/contexts/AuthContext';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: any;
  status: 'connected' | 'available' | 'coming_soon';
  category: string;
}

const integrations: Integration[] = [
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Sincroniza productos y clientes. Las nuevas órdenes se cargan automáticamente vía webhook',
    icon: Store,
    status: 'available',
    category: 'ecommerce',
  },
  {
    id: 'dropi',
    name: 'Dropi',
    description: 'Plataforma de dropshipping para América Latina. Importa productos y gestiona órdenes automáticamente',
    icon: Package,
    status: 'coming_soon',
    category: 'dropshipping',
  },
  {
    id: 'external-webhook',
    name: 'Webhook Externo',
    description: 'Recibe pedidos desde landing pages, tiendas personalizadas o cualquier sistema externo via API',
    icon: Webhook,
    status: 'available',
    category: 'custom',
  },
  {
    id: 'outbound-webhook',
    name: 'Webhooks de Salida',
    description: 'Envía notificaciones automáticas a n8n, Zapier o cualquier sistema cuando cambia el estado de un pedido',
    icon: Zap,
    status: 'available',
    category: 'automation',
  },
];

export default function Integrations() {
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const { refreshStores } = useAuth();
  const [searchParams] = useSearchParams();
  const didRefreshAfterOAuth = useRef(false);
  const { toast } = useToast();
  const [shopifyModalOpen, setShopifyModalOpen] = useState(false);
  const [shopifyMethodDialogOpen, setShopifyMethodDialogOpen] = useState(false);
  const [shopifyOAuthDialogOpen, setShopifyOAuthDialogOpen] = useState(false);
  const [shopifyManualDialogOpen, setShopifyManualDialogOpen] = useState(false);
  const [externalWebhookSetupOpen, setExternalWebhookSetupOpen] = useState(false);
  const [externalWebhookManagementOpen, setExternalWebhookManagementOpen] = useState(false);
  const [outboundWebhookOpen, setOutboundWebhookOpen] = useState(false);
  const [connectedIntegrations, setConnectedIntegrations] = useState<string[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);

  // Memory leak prevention
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const hasShopifyImport = hasFeature('shopify_import');
  const hasCustomWebhooks = hasFeature('custom_webhooks');

  useEffect(() => {
    if (didRefreshAfterOAuth.current) return;

    const status = searchParams.get('status');
    const integration = searchParams.get('integration');

    if (status === 'success' && integration === 'shopify') {
      didRefreshAfterOAuth.current = true;
      refreshStores().then((result) => {
        if (result?.error) {
          logger.warn('Could not refresh stores after Shopify OAuth:', result.error);
        }
      });
    }
  }, [searchParams, refreshStores]);

  // Check for existing integrations on mount
  useEffect(() => {
    if (!hasShopifyImport) return;

    const checkExistingIntegrations = async () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoadingIntegrations(true);
      try {
        // Check Shopify
        const shopifyResponse = await shopifyService.getIntegration();
        if (!isMountedRef.current) return;
        if (shopifyResponse.success && shopifyResponse.integration) {
          setConnectedIntegrations(prev =>
            prev.includes('shopify') ? prev : [...prev, 'shopify']
          );
        }

        // Check External Webhook
        const webhookResponse = await externalWebhookService.getConfig();
        if (!isMountedRef.current) return;
        if (webhookResponse.success && webhookResponse.config) {
          setConnectedIntegrations(prev =>
            prev.includes('external-webhook') ? prev : [...prev, 'external-webhook']
          );
        }

        // Check Outbound Webhooks (only if plan supports it)
        if (hasCustomWebhooks) {
          try {
            const outboundRes = await outboundWebhookService.getConfigs();
            if (!isMountedRef.current) return;
            if (outboundRes.success && outboundRes.configs.length > 0) {
              setConnectedIntegrations(prev =>
                prev.includes('outbound-webhook') ? prev : [...prev, 'outbound-webhook']
              );
            }
          } catch {
            // Ignore - feature may not be available
          }
        }
      } catch (error) {
        if (!isMountedRef.current) return;
        logger.error('Error checking existing integrations:', error);
      } finally {
        if (isMountedRef.current) setIsLoadingIntegrations(false);
      }
    };

    checkExistingIntegrations();
  }, [hasShopifyImport, hasCustomWebhooks]);

  // Check shopify_import feature access - AFTER all hooks
  // Wait for subscription to load to prevent flash of upgrade modal
  if (subscriptionLoading) {
    return null;
  }
  if (!hasShopifyImport) {
    return <FeatureBlockedPage feature="shopify_import" />;
  }

  const handleShopifySuccess = () => {
    setConnectedIntegrations(prev =>
      prev.includes('shopify') ? prev : [...prev, 'shopify']
    );
    // Mark first action completed (hides the onboarding tip)
    onboardingService.markFirstActionCompleted('integrations');
  };

  const handleShopifyDisconnect = () => {
    setConnectedIntegrations(prev => prev.filter(id => id !== 'shopify'));
  };

  const handleExternalWebhookSuccess = () => {
    setConnectedIntegrations(prev =>
      prev.includes('external-webhook') ? prev : [...prev, 'external-webhook']
    );
  };

  const handleExternalWebhookDisconnect = () => {
    setConnectedIntegrations(prev => prev.filter(id => id !== 'external-webhook'));
  };

  const handleIntegrationClick = (integration: Integration) => {
    if (integration.id === 'shopify') {
      if (connectedIntegrations.includes('shopify')) {
        // If already connected, show management modal
        setShopifyModalOpen(true);
      } else {
        // If not connected, show method selector
        setShopifyMethodDialogOpen(true);
      }
    } else if (integration.id === 'external-webhook') {
      if (connectedIntegrations.includes('external-webhook')) {
        // If already connected, show management modal
        setExternalWebhookManagementOpen(true);
      } else {
        // If not connected, show setup dialog
        setExternalWebhookSetupOpen(true);
      }
    } else if (integration.id === 'outbound-webhook') {
      if (!hasCustomWebhooks) {
        toast({
          title: 'Plan Professional requerido',
          description: 'Los webhooks de salida están disponibles en el plan Professional.',
          variant: 'destructive',
        });
        return;
      }
      setOutboundWebhookOpen(true);
    } else if (integration.status === 'coming_soon') {
      toast({
        title: `${integration.name} - Próximamente`,
        description: 'Esta integración estará disponible pronto',
      });
    }
  };

  const handleSelectOAuth = () => {
    setShopifyMethodDialogOpen(false);
    setShopifyOAuthDialogOpen(true);
  };

  const handleSelectManual = () => {
    setShopifyMethodDialogOpen(false);
    setShopifyManualDialogOpen(true);
  };

  const handleBackToMethodSelector = () => {
    setShopifyOAuthDialogOpen(false);
    setShopifyManualDialogOpen(false);
    setShopifyMethodDialogOpen(true);
  };

  const handleOutboundWebhookClose = (open: boolean) => {
    setOutboundWebhookOpen(open);
    if (!open && hasCustomWebhooks) {
      // Re-check connected status after dialog closes
      outboundWebhookService.getConfigs().then(res => {
        if (!isMountedRef.current) return;
        if (res.success) {
          setConnectedIntegrations(prev => {
            const hasConfigs = res.configs.length > 0;
            const alreadyConnected = prev.includes('outbound-webhook');
            if (hasConfigs && !alreadyConnected) return [...prev, 'outbound-webhook'];
            if (!hasConfigs && alreadyConnected) return prev.filter(id => id !== 'outbound-webhook');
            return prev;
          });
        }
      }).catch(() => {});
    }
  };

  const IntegrationSkeleton = ({ index }: { index: number }) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-muted animate-pulse" />
              <div className="space-y-2">
                <div className="h-6 w-24 bg-muted animate-pulse rounded" />
                <div className="h-4 w-16 bg-muted animate-pulse rounded" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
            <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-10 w-full bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    </motion.div>
  );

  const IntegrationCard = ({ integration, index }: { integration: Integration; index: number }) => {
    const Icon = integration.icon;
    const isConnected = connectedIntegrations.includes(integration.id);
    const isLocked = integration.id === 'outbound-webhook' && !hasCustomWebhooks;
    const status = isConnected ? 'connected' : integration.status;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
      >
        <Card className="hover:shadow-lg transition-all duration-300 hover:border-primary/50 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                  status === 'connected'
                    ? 'bg-primary/20'
                    : status === 'coming_soon'
                    ? 'bg-muted'
                    : 'bg-primary/10'
                }`}>
                  <Icon className={
                    status === 'connected'
                      ? 'text-primary'
                      : status === 'coming_soon'
                      ? 'text-muted-foreground'
                      : 'text-primary/70'
                  } size={28} />
                </div>
                <div>
                  <CardTitle className="text-xl">{integration.name}</CardTitle>
                  {status === 'connected' && (
                    <div className="flex items-center gap-1 mt-1">
                      <CheckCircle2 size={14} className="text-green-600 dark:text-green-400" />
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">Conectado</span>
                    </div>
                  )}
                </div>
              </div>
              {status === 'coming_soon' && (
                <Badge variant="secondary" className="gap-1">
                  <Clock size={12} />
                  Próximamente
                </Badge>
              )}
              {isLocked && (
                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
                  <Lock size={12} />
                  Professional
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <CardDescription className="text-sm">
              {integration.description}
            </CardDescription>
            <Button
              variant={status === 'connected' ? 'outline' : 'default'}
              className="w-full gap-2"
              disabled={status === 'coming_soon'}
              onClick={() => handleIntegrationClick(integration)}
              data-integration={integration.id}
            >
              {status === 'connected' ? (
                <>
                  <Settings size={16} />
                  Configurar
                </>
              ) : status === 'coming_soon' ? (
                <>
                  <Clock size={16} />
                  Próximamente
                </>
              ) : (
                <>
                  {integration.category === 'automation' ? (
                    <Zap size={16} />
                  ) : (
                    <Store size={16} />
                  )}
                  {integration.category === 'automation' ? 'Configurar' : 'Conectar tienda'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="space-y-8">
      <FirstTimeWelcomeBanner
        moduleId="integrations"
        title="¡Bienvenido a Integraciones!"
        description="Conecta tu tienda online para sincronizar productos, clientes y pedidos automáticamente."
        tips={['Conecta Shopify', 'Importa productos', 'Recibe pedidos automáticos']}
      />

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold mb-2">Integraciones</h2>
        <p className="text-muted-foreground">
          Conecta tus plataformas de e-commerce y herramientas favoritas
        </p>
      </div>

      {/* E-commerce Platforms Category */}
      <div className="space-y-4">
        <div className="border-l-4 border-primary pl-4">
          <h3 className="text-lg font-semibold">Plataformas de E-commerce</h3>
          <p className="text-sm text-muted-foreground">
            Integra tu tienda online para sincronizar productos, clientes y órdenes automáticamente
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoadingIntegrations ? (
            // Show skeleton loaders while checking integration status
            integrations
              .filter(int => int.category === 'ecommerce')
              .map((integration, index) => (
                <IntegrationSkeleton key={integration.id} index={index} />
              ))
          ) : (
            // Show actual integration cards once loaded
            integrations
              .filter(int => int.category === 'ecommerce')
              .map((integration, index) => (
                <IntegrationCard key={integration.id} integration={integration} index={index} />
              ))
          )}
        </div>
      </div>

      {/* Dropshipping Category */}
      <div className="space-y-4">
        <div className="border-l-4 border-orange-500 pl-4">
          <h3 className="text-lg font-semibold">Dropshipping</h3>
          <p className="text-sm text-muted-foreground">
            Conecta plataformas de dropshipping para importar productos y gestionar fulfillment automáticamente
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoadingIntegrations ? (
            // Show skeleton loaders while checking integration status
            integrations
              .filter(int => int.category === 'dropshipping')
              .map((integration, index) => (
                <IntegrationSkeleton key={integration.id} index={index} />
              ))
          ) : (
            // Show actual integration cards once loaded
            integrations
              .filter(int => int.category === 'dropshipping')
              .map((integration, index) => (
                <IntegrationCard key={integration.id} integration={integration} index={index} />
              ))
          )}
        </div>
      </div>

      {/* Automation Category */}
      <div className="space-y-4">
        <div className="border-l-4 border-amber-500 pl-4">
          <h3 className="text-lg font-semibold">Automatización</h3>
          <p className="text-sm text-muted-foreground">
            Envía notificaciones automáticas a sistemas externos cuando ocurren eventos en tus pedidos
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoadingIntegrations ? (
            integrations
              .filter(int => int.category === 'automation')
              .map((integration, index) => (
                <IntegrationSkeleton key={integration.id} index={index} />
              ))
          ) : (
            integrations
              .filter(int => int.category === 'automation')
              .map((integration, index) => (
                <IntegrationCard key={integration.id} integration={integration} index={index} />
              ))
          )}
        </div>
      </div>

      {/* Custom Integrations Category */}
      <div className="space-y-4">
        <div className="border-l-4 border-purple-500 pl-4">
          <h3 className="text-lg font-semibold">Integraciones Personalizadas</h3>
          <p className="text-sm text-muted-foreground">
            Conecta landing pages, tiendas personalizadas o cualquier sistema externo para recibir pedidos automáticamente
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoadingIntegrations ? (
            // Show skeleton loaders while checking integration status
            integrations
              .filter(int => int.category === 'custom')
              .map((integration, index) => (
                <IntegrationSkeleton key={integration.id} index={index} />
              ))
          ) : (
            // Show actual integration cards once loaded
            integrations
              .filter(int => int.category === 'custom')
              .map((integration, index) => (
                <IntegrationCard key={integration.id} integration={integration} index={index} />
              ))
          )}
        </div>
      </div>

      {/* Shopify Integration Modal (for managing existing connection) */}
      <ShopifyIntegrationModal
        open={shopifyModalOpen}
        onOpenChange={setShopifyModalOpen}
        onSuccess={handleShopifySuccess}
        onDisconnect={handleShopifyDisconnect}
      />

      {/* Shopify Connection Method Selector */}
      <ShopifyConnectionMethodDialog
        open={shopifyMethodDialogOpen}
        onOpenChange={setShopifyMethodDialogOpen}
        onSelectOAuth={handleSelectOAuth}
        onSelectManual={handleSelectManual}
      />

      {/* Shopify OAuth Connect Dialog (recommended) */}
      <ShopifyConnectDialog
        open={shopifyOAuthDialogOpen}
        onOpenChange={setShopifyOAuthDialogOpen}
        onBack={handleBackToMethodSelector}
      />

      {/* Shopify Manual Connect Dialog (custom app) */}
      <ShopifyManualConnectDialog
        open={shopifyManualDialogOpen}
        onOpenChange={setShopifyManualDialogOpen}
        onSuccess={handleShopifySuccess}
        onBack={handleBackToMethodSelector}
      />

      {/* External Webhook Setup Dialog */}
      <ExternalWebhookSetupDialog
        open={externalWebhookSetupOpen}
        onOpenChange={setExternalWebhookSetupOpen}
        onSuccess={handleExternalWebhookSuccess}
      />

      {/* External Webhook Management Modal */}
      <ExternalWebhookManagementModal
        open={externalWebhookManagementOpen}
        onOpenChange={setExternalWebhookManagementOpen}
        onDisconnect={handleExternalWebhookDisconnect}
      />

      {/* Outbound Webhook Manager */}
      <OutboundWebhookManager
        open={outboundWebhookOpen}
        onOpenChange={handleOutboundWebhookClose}
      />
    </div>
  );
}
