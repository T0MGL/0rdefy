import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { logger } from '@/utils/logger';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DialogTitle } from '@/components/ui/dialog';
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { adsService } from '@/services/ads.service';
import { carriersService } from '@/services/carriers.service';
import { customersService } from '@/services/customers.service';
import { Search, ShoppingBag, Package, Megaphone, Truck, Users, Clock, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { getOrderDisplayId } from '@/utils/orderDisplay';
import type { Order, Product, Ad, Customer } from '@/types';
import type { Carrier } from '@/services/carriers.service';

const RECENT_SEARCHES_KEY_PREFIX = 'neonflow_recent_searches';
const MAX_RECENT_SEARCHES = 5;
const FREQUENT_ITEMS_KEY_PREFIX = 'neonflow_frequent_items';
const MAX_FREQUENT_ITEMS = 10;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface RecentSearch {
  id: string;
  type: 'order' | 'product' | 'ad' | 'carrier' | 'customer';
  label: string;
  timestamp: number;
}

interface FrequentItem {
  id: string;
  type: 'order' | 'product' | 'ad' | 'carrier' | 'customer';
  label: string;
  accessCount: number;
  lastAccessed: number;
}

interface CachedData {
  orders: Order[];
  products: Product[];
  ads: Ad[];
  carriers: Carrier[];
  customers: Customer[];
  timestamp: number;
  storeId: string; // Track which store this cache belongs to
}

export function GlobalSearch() {
  const { currentStore } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [frequentItems, setFrequentItems] = useState<FrequentItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const navigate = useNavigate();

  // Store-scoped cache using useRef to persist across renders but clear on store change
  const dataCacheRef = useRef<CachedData | null>(null);
  const lastStoreIdRef = useRef<string | null>(null);
  // ✅ FIXED: Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef<boolean>(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Store-specific localStorage keys
  const recentSearchesKey = currentStore?.id
    ? `${RECENT_SEARCHES_KEY_PREFIX}_${currentStore.id}`
    : RECENT_SEARCHES_KEY_PREFIX;
  const frequentItemsKey = currentStore?.id
    ? `${FREQUENT_ITEMS_KEY_PREFIX}_${currentStore.id}`
    : FREQUENT_ITEMS_KEY_PREFIX;

  // Clear cache and state when store changes
  useEffect(() => {
    if (currentStore?.id && lastStoreIdRef.current !== currentStore.id) {
      // Store changed - clear all cached data
      dataCacheRef.current = null;
      setOrders([]);
      setProducts([]);
      setAds([]);
      setCarriers([]);
      setCustomers([]);
      setHasLoaded(false);
      setRecentSearches([]);
      setFrequentItems([]);
      lastStoreIdRef.current = currentStore.id;
      logger.info('GlobalSearch: Cache cleared due to store change', { storeId: currentStore.id });
    }
  }, [currentStore?.id]);

  // Load recent searches and frequent items from localStorage (store-specific)
  useEffect(() => {
    if (open && currentStore?.id) {
      const storedRecent = localStorage.getItem(recentSearchesKey);
      const storedFrequent = localStorage.getItem(frequentItemsKey);

      if (storedRecent) {
        try {
          setRecentSearches(JSON.parse(storedRecent));
        } catch (error) {
          logger.error('Error loading recent searches:', error);
        }
      } else {
        setRecentSearches([]);
      }

      if (storedFrequent) {
        try {
          const items: FrequentItem[] = JSON.parse(storedFrequent);
          const sorted = items.sort((a, b) => {
            if (b.accessCount !== a.accessCount) {
              return b.accessCount - a.accessCount;
            }
            return b.lastAccessed - a.lastAccessed;
          });
          setFrequentItems(sorted.slice(0, MAX_FREQUENT_ITEMS));
        } catch (error) {
          logger.error('Error loading frequent items:', error);
        }
      } else {
        setFrequentItems([]);
      }
    }
  }, [open, currentStore?.id, recentSearchesKey, frequentItemsKey]);

  // ✅ FIXED: Set mounted flag and cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any in-flight requests when component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const loadSearchData = useCallback(async () => {
    const storeId = currentStore?.id;
    if (!storeId) return;

    // Check cache first - must match current store and not be expired
    const cache = dataCacheRef.current;
    if (cache && cache.storeId === storeId && Date.now() - cache.timestamp < CACHE_DURATION) {
      setOrders(cache.orders);
      setProducts(cache.products);
      setAds(cache.ads);
      setCarriers(cache.carriers);
      setCustomers(cache.customers);
      setHasLoaded(true);
      return;
    }

    // Cancel previous in-flight load if a new one starts
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // ✅ FIXED: Create new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    try {
      // ✅ FIXED: Load only limited data for search (not all records)
      // Orders: 100 most recent (enough for search)
      // Products: 200 most popular/recent
      // Customers: 200 most recent
      // Ads: 50 most recent
      // Carriers: All (typically <50 carriers per store)
      const [ordersResponse, productsData, adsData, carriersData, customersData] = await Promise.all([
        ordersService.getAll({ limit: 100 }),
        productsService.getAll({ limit: 200 }),
        adsService.getAll({ limit: 50 }),
        carriersService.getAll({ limit: 50 }),
        customersService.getAll({ limit: 200 }),
      ]);

      // ✅ FIXED: Check if component is still mounted and request wasn't aborted
      if (!isMountedRef.current || abortController.signal.aborted) {
        return;
      }

      const ordersData = ordersResponse.data || [];

      // Update cache with store ID
      dataCacheRef.current = {
        orders: ordersData,
        products: productsData.data || [],
        ads: adsData,
        carriers: carriersData,
        customers: customersData,
        timestamp: Date.now(),
        storeId: storeId,
      };

      setOrders(ordersData);
      setProducts(productsData.data || []);
      setAds(adsData);
      setCarriers(carriersData);
      setCustomers(customersData);
      setHasLoaded(true);
    } catch (error: any) {
      // ✅ FIXED: Ignore abort errors - they're expected on cleanup
      if (error.name === 'AbortError') {
        return;
      }
      logger.error('Error loading search data:', error);
      // ✅ FIXED: Only show toast if component is still mounted
      if (isMountedRef.current) {
        toast.error('Error al cargar datos de búsqueda', {
          description: 'Intenta nuevamente más tarde'
        });
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      // ✅ FIXED: Only update loading state if component is still mounted
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentStore?.id]);

  // Load data when dialog opens - with caching
  useEffect(() => {
    if (open && !hasLoaded) {
      loadSearchData();
    }
  }, [open, hasLoaded, loadSearchData]);

  // Save recent search (store-specific)
  const saveRecentSearch = useCallback((search: Omit<RecentSearch, 'timestamp'>) => {
    if (!currentStore?.id) return;

    const newSearch: RecentSearch = {
      ...search,
      timestamp: Date.now(),
    };

    setRecentSearches(prev => {
      const updated = [
        newSearch,
        ...prev.filter(s => s.id !== search.id || s.type !== search.type)
      ].slice(0, MAX_RECENT_SEARCHES);
      localStorage.setItem(recentSearchesKey, JSON.stringify(updated));
      return updated;
    });
  }, [currentStore?.id, recentSearchesKey]);

  // Track frequent items (store-specific)
  const trackFrequentItem = useCallback((item: Omit<FrequentItem, 'accessCount' | 'lastAccessed'>) => {
    if (!currentStore?.id) return;

    setFrequentItems(prev => {
      const existing = prev.find(f => f.id === item.id && f.type === item.type);

      let updated: FrequentItem[];
      if (existing) {
        updated = prev.map(f =>
          f.id === item.id && f.type === item.type
            ? { ...f, accessCount: f.accessCount + 1, lastAccessed: Date.now() }
            : f
        );
      } else {
        updated = [
          { ...item, accessCount: 1, lastAccessed: Date.now() },
          ...prev,
        ];
      }

      updated = updated
        .sort((a, b) => {
          if (b.accessCount !== a.accessCount) {
            return b.accessCount - a.accessCount;
          }
          return b.lastAccessed - a.lastAccessed;
        })
        .slice(0, MAX_FREQUENT_ITEMS);

      localStorage.setItem(frequentItemsKey, JSON.stringify(updated));
      return updated;
    });
  }, [currentStore?.id, frequentItemsKey]);

  // Escape special regex characters for safe highlighting
  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Highlight matching text - safe version
  const highlightText = useCallback((text: string, searchQuery: string) => {
    if (!searchQuery || !text) return text;

    try {
      const escapedQuery = escapeRegex(searchQuery);
      const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
      return (
        <>
          {parts.map((part, i) =>
            part.toLowerCase() === searchQuery.toLowerCase() ? (
              <mark key={i} className="bg-yellow-200 dark:bg-yellow-900/50 text-foreground font-semibold rounded-sm px-0.5">
                {part}
              </mark>
            ) : (
              part
            )
          )}
        </>
      );
    } catch {
      return text;
    }
  }, []);

  // Get status badge color
  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'pending':
      case 'pending_confirmation':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'confirmed':
      case 'in_preparation':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'ready_to_ship':
      case 'shipped':
      case 'in_transit':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'delivered':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'cancelled':
      case 'rejected':
      case 'returned':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  }, []);

  // Get status label in Spanish
  const getStatusLabel = useCallback((status: string) => {
    const labels: Record<string, string> = {
      'pending': 'Pendiente',
      'pending_confirmation': 'Pendiente',
      'confirmed': 'Confirmado',
      'in_preparation': 'En Preparación',
      'ready_to_ship': 'Listo',
      'shipped': 'Enviado',
      'in_transit': 'En Tránsito',
      'delivered': 'Entregado',
      'cancelled': 'Cancelado',
      'rejected': 'Rechazado',
      'returned': 'Devuelto',
    };
    return labels[status] || status;
  }, []);

  // Format currency
  const formatCurrency = useCallback((amount: number) => {
    const currency = currentStore?.currency || 'USD';
    const locale = currency === 'PYG' ? 'es-PY' : currency === 'EUR' ? 'es-ES' : currency === 'ARS' ? 'es-AR' : 'en-US';

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: currency === 'PYG' ? 0 : 2,
    }).format(amount);
  }, [currentStore?.currency]);

  // Keyboard shortcut handler
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Handle selection
  const handleSelect = useCallback((
    callback: () => void,
    item?: { id: string; type: 'order' | 'product' | 'ad' | 'carrier' | 'customer'; label: string }
  ) => {
    if (item) {
      saveRecentSearch(item);
      trackFrequentItem(item);
    }
    setOpen(false);
    setQuery('');
    callback();
  }, [saveRecentSearch, trackFrequentItem]);

  // Handle dialog open/close
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Small delay to allow animation before clearing
      setTimeout(() => setQuery(''), 150);
    }
  }, []);

  // Create searchable value for cmdk filtering
  const createSearchValue = useCallback((item: {
    type: string;
    id?: string;
    name?: string;
    customer?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    campaign_name?: string;
    platform?: string;
    carrier_name?: string;
  }) => {
    const parts: string[] = [item.type];

    if (item.id) parts.push(item.id);
    if (item.name) parts.push(item.name);
    if (item.customer) parts.push(item.customer);
    if (item.phone) parts.push(item.phone);
    if (item.first_name) parts.push(item.first_name);
    if (item.last_name) parts.push(item.last_name);
    if (item.email) parts.push(item.email);
    if (item.campaign_name) parts.push(item.campaign_name);
    if (item.platform) parts.push(item.platform);
    if (item.carrier_name) parts.push(item.carrier_name);

    return parts.join(' ').toLowerCase();
  }, []);

  // Limited lists for display (cmdk handles filtering)
  const displayOrders = useMemo(() => orders.slice(0, 50), [orders]);
  const displayProducts = useMemo(() => products.slice(0, 50), [products]);
  const displayCustomers = useMemo(() => customers.slice(0, 50), [customers]);
  const displayAds = useMemo(() => ads.slice(0, 50), [ads]);
  const displayCarriers = useMemo(() => carriers.slice(0, 20), [carriers]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden lg:flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted rounded-md hover:bg-muted/80 transition-colors"
      >
        <Search size={14} />
        <span>Buscar...</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <DialogTitle className="sr-only">Búsqueda Global</DialogTitle>

        <CommandInput
          placeholder="Buscar pedidos, productos, clientes, campañas..."
          value={query}
          onValueChange={setQuery}
        />

        <CommandList className="max-h-[400px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Cargando resultados...</p>
            </div>
          ) : (
            <>
              <CommandEmpty>
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Search className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">No se encontraron resultados</p>
                  <p className="text-xs text-muted-foreground">Intenta con otros términos de búsqueda</p>
                </div>
              </CommandEmpty>

              {/* Frequent Items - only when no query */}
              {!query && frequentItems.length > 0 && (
                <CommandGroup heading="Accedidos frecuentemente">
                  {frequentItems.slice(0, 5).map((item) => (
                    <CommandItem
                      key={`frequent-${item.type}-${item.id}`}
                      value={`frequent ${item.type} ${item.label}`}
                      onSelect={() => {
                        if (item.type === 'carrier') {
                          handleSelect(() => navigate(`/carriers/${item.id}`));
                        } else {
                          const routes: Record<string, string> = {
                            order: '/orders',
                            product: '/products',
                            ad: '/ads',
                            customer: '/customers',
                          };
                          handleSelect(() => navigate(routes[item.type], { state: { highlightId: item.id } }));
                        }
                      }}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        {item.type === 'product' && <Package className="h-4 w-4 text-green-500" />}
                        {item.type === 'order' && <ShoppingBag className="h-4 w-4 text-blue-500" />}
                        {item.type === 'customer' && <Users className="h-4 w-4 text-purple-500" />}
                        {item.type === 'ad' && <Megaphone className="h-4 w-4 text-orange-500" />}
                        {item.type === 'carrier' && <Truck className="h-4 w-4 text-indigo-500" />}
                        <span className="truncate max-w-[300px]">{item.label}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {item.accessCount}x
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Recent Searches - only when no query */}
              {!query && recentSearches.length > 0 && (
                <CommandGroup heading="Búsquedas recientes">
                  {recentSearches.map((search) => (
                    <CommandItem
                      key={`recent-${search.type}-${search.id}`}
                      value={`recent ${search.type} ${search.label}`}
                      onSelect={() => {
                        if (search.type === 'carrier') {
                          handleSelect(() => navigate(`/carriers/${search.id}`));
                        } else {
                          const routes: Record<string, string> = {
                            order: '/orders',
                            product: '/products',
                            ad: '/ads',
                            customer: '/customers',
                          };
                          handleSelect(() => navigate(routes[search.type], { state: { highlightId: search.id } }));
                        }
                      }}
                    >
                      <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground truncate max-w-[350px]">{search.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* Orders */}
              {displayOrders.length > 0 && (
                <CommandGroup heading="Pedidos">
                  {displayOrders.map((order) => {
                    const displayId = getOrderDisplayId(order);
                    const searchableValue = createSearchValue({
                      type: 'order',
                      id: displayId,
                      customer: order.customer,
                      phone: order.phone,
                    });

                    return (
                      <CommandItem
                        key={`order-${order.id}`}
                        value={searchableValue}
                        onSelect={() => handleSelect(
                          () => navigate('/orders', { state: { highlightId: order.id } }),
                          { id: order.id, type: 'order', label: `Pedido ${displayId} - ${order.customer}` }
                        )}
                        className="flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <ShoppingBag className="h-4 w-4 shrink-0 text-blue-500" />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {query ? highlightText(displayId, query) : displayId} - {query ? highlightText(order.customer || '', query) : (order.customer || '')}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {order.product} • {formatCurrency(order.total || 0)}
                            </span>
                          </div>
                        </div>
                        <Badge variant="secondary" className={cn("text-xs shrink-0 ml-2", getStatusColor(order.status))}>
                          {getStatusLabel(order.status)}
                        </Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Products */}
              {displayProducts.length > 0 && (
                <CommandGroup heading="Productos">
                  {displayProducts.map((product) => {
                    const searchableValue = createSearchValue({
                      type: 'product',
                      id: product.id,
                      name: product.name,
                    });

                    return (
                      <CommandItem
                        key={`product-${product.id}`}
                        value={searchableValue}
                        onSelect={() => handleSelect(
                          () => navigate('/products', { state: { highlightId: product.id } }),
                          { id: product.id, type: 'product', label: `Producto ${product.name}` }
                        )}
                        className="flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Package className="h-4 w-4 shrink-0 text-green-500" />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {query ? highlightText(product.name || '', query) : (product.name || '')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Stock: {product.stock} • {formatCurrency(product.price || 0)}
                            </span>
                          </div>
                        </div>
                        {product.stock <= 10 && (
                          <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 shrink-0 ml-2">
                            Bajo stock
                          </Badge>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Customers */}
              {displayCustomers.length > 0 && (
                <CommandGroup heading="Clientes">
                  {displayCustomers.map((customer) => {
                    const fullName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
                    const searchableValue = createSearchValue({
                      type: 'customer',
                      id: customer.id,
                      first_name: customer.first_name,
                      last_name: customer.last_name,
                      email: customer.email,
                      phone: customer.phone,
                    });

                    return (
                      <CommandItem
                        key={`customer-${customer.id}`}
                        value={searchableValue}
                        onSelect={() => handleSelect(
                          () => navigate('/customers', { state: { highlightId: customer.id } }),
                          { id: customer.id, type: 'customer', label: `Cliente ${fullName}` }
                        )}
                        className="flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Users className="h-4 w-4 shrink-0 text-purple-500" />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {query ? highlightText(fullName, query) : fullName}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {customer.email || customer.phone || 'Sin contacto'}
                            </span>
                          </div>
                        </div>
                        {customer.total_orders > 0 && (
                          <Badge variant="secondary" className="text-xs shrink-0 ml-2">
                            {customer.total_orders} pedidos
                          </Badge>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Campaigns */}
              {displayAds.length > 0 && (
                <CommandGroup heading="Campañas">
                  {displayAds.map((ad) => {
                    const searchableValue = createSearchValue({
                      type: 'ad',
                      id: ad.id,
                      campaign_name: ad.campaign_name,
                      platform: ad.platform,
                    });

                    return (
                      <CommandItem
                        key={`ad-${ad.id}`}
                        value={searchableValue}
                        onSelect={() => handleSelect(
                          () => navigate('/ads', { state: { highlightId: ad.id } }),
                          { id: ad.id, type: 'ad', label: `Campaña ${ad.campaign_name || ad.platform}` }
                        )}
                        className="flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Megaphone className="h-4 w-4 shrink-0 text-orange-500" />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {query ? highlightText(ad.campaign_name || 'Sin nombre', query) : (ad.campaign_name || 'Sin nombre')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {ad.platform} • {formatCurrency(ad.investment || 0)}
                            </span>
                          </div>
                        </div>
                        <Badge variant="secondary" className={cn(
                          "text-xs shrink-0 ml-2",
                          ad.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                        )}>
                          {ad.status === 'active' ? 'Activa' : 'Pausada'}
                        </Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Carriers */}
              {displayCarriers.length > 0 && (
                <CommandGroup heading="Transportadoras">
                  {displayCarriers.map((carrier) => {
                    const searchableValue = createSearchValue({
                      type: 'carrier',
                      id: carrier.id,
                      carrier_name: carrier.carrier_name,
                    });

                    return (
                      <CommandItem
                        key={`carrier-${carrier.id}`}
                        value={searchableValue}
                        onSelect={() => handleSelect(
                          () => navigate(`/carriers/${carrier.id}`),
                          { id: carrier.id, type: 'carrier', label: `Transportadora ${carrier.carrier_name}` }
                        )}
                        className="flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Truck className="h-4 w-4 shrink-0 text-indigo-500" />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">
                              {query ? highlightText(carrier.carrier_name || '', query) : (carrier.carrier_name || '')}
                            </span>
                            {carrier.coverage_zones && (
                              <span className="text-xs text-muted-foreground truncate">
                                Cobertura: {carrier.coverage_zones}
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge variant="secondary" className={cn(
                          "text-xs shrink-0 ml-2",
                          carrier.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                        )}>
                          {carrier.is_active ? 'Activa' : 'Inactiva'}
                        </Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
