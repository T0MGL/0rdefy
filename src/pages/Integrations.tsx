import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShopifyIntegrationModal } from '@/components/ShopifyIntegrationModal';
import { ShopifyConnectionMethodDialog } from '@/components/ShopifyConnectionMethodDialog';
import { ShopifyManualConnectDialog } from '@/components/ShopifyManualConnectDialog';
import { ShopifyConnectDialog } from '@/components/ShopifyConnectDialog';
import { Store, Package, Clock, CheckCircle2, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { shopifyService } from '@/services/shopify.service';

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
];

export default function Integrations() {
  const { toast } = useToast();
  const [shopifyModalOpen, setShopifyModalOpen] = useState(false);
  const [shopifyMethodDialogOpen, setShopifyMethodDialogOpen] = useState(false);
  const [shopifyOAuthDialogOpen, setShopifyOAuthDialogOpen] = useState(false);
  const [shopifyManualDialogOpen, setShopifyManualDialogOpen] = useState(false);
  const [connectedIntegrations, setConnectedIntegrations] = useState<string[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);

  // Check for existing Shopify integration on mount
  useEffect(() => {
    const checkExistingIntegration = async () => {
      setIsLoadingIntegrations(true);
      try {
        const response = await shopifyService.getIntegration();
        if (response.success && response.integration) {
          setConnectedIntegrations(prev =>
            prev.includes('shopify') ? prev : [...prev, 'shopify']
          );
        }
      } catch (error) {
        console.error('Error checking existing integration:', error);
      } finally {
        setIsLoadingIntegrations(false);
      }
    };

    checkExistingIntegration();
  }, []);

  const handleShopifySuccess = () => {
    setConnectedIntegrations(prev =>
      prev.includes('shopify') ? prev : [...prev, 'shopify']
    );
  };

  const handleShopifyDisconnect = () => {
    setConnectedIntegrations(prev => prev.filter(id => id !== 'shopify'));
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
                  <Store size={16} />
                  Conectar tienda
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
    </div>
  );
}
