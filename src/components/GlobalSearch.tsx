import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Search, ShoppingBag, Package, Megaphone, Truck, X, Maximize2, Minimize2, Users, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Order, Product, Ad, Customer } from '@/types';
import type { Carrier } from '@/services/carriers.service';

const RECENT_SEARCHES_KEY = 'neonflow_recent_searches';
const MAX_RECENT_SEARCHES = 5;
const FREQUENT_ITEMS_KEY = 'neonflow_frequent_items';
const MAX_FREQUENT_ITEMS = 10;

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

export function GlobalSearch() {
  const { currentStore } = useAuth();
  const [open, setOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [frequentItems, setFrequentItems] = useState<FrequentItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const navigate = useNavigate();

  // Debounce search query
  const debouncedQuery = useDebounce(query, 300);

  // Load recent searches and frequent items from localStorage
  useEffect(() => {
    if (open) {
      const storedRecent = localStorage.getItem(RECENT_SEARCHES_KEY);
      const storedFrequent = localStorage.getItem(FREQUENT_ITEMS_KEY);

      if (storedRecent) {
        try {
          setRecentSearches(JSON.parse(storedRecent));
        } catch (error) {
          console.error('Error loading recent searches:', error);
        }
      }

      if (storedFrequent) {
        try {
          const items: FrequentItem[] = JSON.parse(storedFrequent);
          // Sort by access count and last accessed
          const sorted = items.sort((a, b) => {
            if (b.accessCount !== a.accessCount) {
              return b.accessCount - a.accessCount;
            }
            return b.lastAccessed - a.lastAccessed;
          });
          setFrequentItems(sorted.slice(0, MAX_FREQUENT_ITEMS));
        } catch (error) {
          console.error('Error loading frequent items:', error);
        }
      }
    }
  }, [open]);

  // Load data when dialog opens
  useEffect(() => {
    if (open && (orders.length === 0 || products.length === 0)) {
      loadSearchData();
    }
  }, [open]);

  const loadSearchData = async () => {
    setIsLoading(true);
    try {
      const [ordersData, productsData, adsData, carriersData, customersData] = await Promise.all([
        ordersService.getAll(),
        productsService.getAll(),
        adsService.getAll(),
        carriersService.getAll(),
        customersService.getAll(),
      ]);
      setOrders(ordersData);
      setProducts(productsData);
      setAds(adsData);
      setCarriers(carriersData);
      setCustomers(customersData);
    } catch (error) {
      console.error('Error loading search data:', error);
      toast.error('Error al cargar datos de búsqueda', {
        description: 'Intenta nuevamente más tarde'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Save recent search
  const saveRecentSearch = (search: Omit<RecentSearch, 'timestamp'>) => {
    const newSearch: RecentSearch = {
      ...search,
      timestamp: Date.now(),
    };

    const updated = [
      newSearch,
      ...recentSearches.filter(s => s.id !== search.id || s.type !== search.type)
    ].slice(0, MAX_RECENT_SEARCHES);

    setRecentSearches(updated);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  };

  // Track frequent items
  const trackFrequentItem = (item: Omit<FrequentItem, 'accessCount' | 'lastAccessed'>) => {
    const existing = frequentItems.find(f => f.id === item.id && f.type === item.type);

    let updated: FrequentItem[];
    if (existing) {
      // Increment access count
      updated = frequentItems.map(f =>
        f.id === item.id && f.type === item.type
          ? { ...f, accessCount: f.accessCount + 1, lastAccessed: Date.now() }
          : f
      );
    } else {
      // Add new frequent item
      updated = [
        { ...item, accessCount: 1, lastAccessed: Date.now() },
        ...frequentItems,
      ];
    }

    // Sort and limit
    updated = updated
      .sort((a, b) => {
        if (b.accessCount !== a.accessCount) {
          return b.accessCount - a.accessCount;
        }
        return b.lastAccessed - a.lastAccessed;
      })
      .slice(0, MAX_FREQUENT_ITEMS);

    setFrequentItems(updated);
    localStorage.setItem(FREQUENT_ITEMS_KEY, JSON.stringify(updated));
  };

  // Generate auto-complete suggestions based on query (now uses 'includes' for better matching)
  useEffect(() => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const allSuggestions: string[] = [];

    // Get suggestions from products (now matches anywhere in the name)
    products.forEach(p => {
      if (p.name?.toLowerCase().includes(lowerQuery)) {
        allSuggestions.push(p.name);
      }
    });

    // Get suggestions from customers
    customers.forEach(c => {
      const fullName = `${c.first_name} ${c.last_name}`;
      if (fullName.toLowerCase().includes(lowerQuery)) {
        allSuggestions.push(fullName);
      }
    });

    // Get suggestions from carriers
    carriers.forEach(c => {
      if (c.carrier_name?.toLowerCase().includes(lowerQuery)) {
        allSuggestions.push(c.carrier_name);
      }
    });

    // Get suggestions from campaigns
    ads.forEach(a => {
      if (a.campaign_name?.toLowerCase().includes(lowerQuery)) {
        allSuggestions.push(a.campaign_name);
      }
    });

    // Remove duplicates and limit
    const unique = Array.from(new Set(allSuggestions)).slice(0, 5);
    setSuggestions(unique);
  }, [query, products, customers, carriers, ads]);

  // Filter results based on query
  const filteredOrders = useMemo(() => {
    if (!debouncedQuery) return orders.slice(0, 5);
    const lowerQuery = debouncedQuery.toLowerCase();
    return orders.filter(order =>
      order.id?.toLowerCase().includes(lowerQuery) ||
      order.customer?.toLowerCase().includes(lowerQuery) ||
      order.phone?.toLowerCase().includes(lowerQuery)
    ).slice(0, 5);
  }, [orders, debouncedQuery]);

  const filteredProducts = useMemo(() => {
    if (!debouncedQuery) return products.slice(0, 5);
    const lowerQuery = debouncedQuery.toLowerCase();
    return products.filter(product =>
      product.name?.toLowerCase().includes(lowerQuery) ||
      product.id?.toLowerCase().includes(lowerQuery)
    ).slice(0, 5);
  }, [products, debouncedQuery]);

  const filteredAds = useMemo(() => {
    if (!debouncedQuery) return ads.slice(0, 5);
    const lowerQuery = debouncedQuery.toLowerCase();
    return ads.filter(ad =>
      ad.campaign_name?.toLowerCase().includes(lowerQuery) ||
      ad.platform?.toLowerCase().includes(lowerQuery)
    ).slice(0, 5);
  }, [ads, debouncedQuery]);

  const filteredCarriers = useMemo(() => {
    if (!debouncedQuery) return carriers.slice(0, 5);
    const lowerQuery = debouncedQuery.toLowerCase();
    return carriers.filter(carrier =>
      carrier.carrier_name?.toLowerCase().includes(lowerQuery)
    ).slice(0, 5);
  }, [carriers, debouncedQuery]);

  const filteredCustomers = useMemo(() => {
    if (!debouncedQuery) return customers.slice(0, 5);
    const lowerQuery = debouncedQuery.toLowerCase();
    return customers.filter(customer =>
      customer.first_name?.toLowerCase().includes(lowerQuery) ||
      customer.last_name?.toLowerCase().includes(lowerQuery) ||
      customer.email?.toLowerCase().includes(lowerQuery) ||
      customer.phone?.toLowerCase().includes(lowerQuery)
    ).slice(0, 5);
  }, [customers, debouncedQuery]);

  // Highlight matching text
  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="bg-yellow-200 dark:bg-yellow-900/50 text-foreground font-semibold">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending_confirmation':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'confirmed':
      case 'prepared':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'delivered_to_courier':
      case 'in_transit':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'delivered':
      case 'reconciled':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'cancelled':
      case 'rejected':
      case 'not_delivered':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  // Format currency - uses store's currency
  const formatCurrency = (amount: number) => {
    const currency = currentStore?.currency || 'USD';
    const locale = currency === 'PYG' ? 'es-PY' : currency === 'EUR' ? 'es-ES' : currency === 'ARS' ? 'es-AR' : 'en-US';

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: currency === 'PYG' ? 0 : 2,
    }).format(amount);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleSelect = (
    callback: () => void,
    item?: { id: string; type: 'order' | 'product' | 'ad' | 'carrier' | 'customer'; label: string }
  ) => {
    if (item) {
      saveRecentSearch(item);
      trackFrequentItem(item);
    }
    setOpen(false);
    setIsFullscreen(false);
    setQuery('');
    callback();
  };

  const handleClose = () => {
    setOpen(false);
    setIsFullscreen(false);
    setQuery('');
  };

  // Apply fullscreen styles to dialog
  useEffect(() => {
    if (open) {
      const dialogContent = document.querySelector('[role="dialog"]');
      if (dialogContent && isFullscreen) {
        dialogContent.classList.add('!max-w-5xl', '!h-[90vh]');
      } else if (dialogContent) {
        dialogContent.classList.remove('!max-w-5xl', '!h-[90vh]');
      }
    }
  }, [isFullscreen, open]);

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

      <CommandDialog open={open} onOpenChange={handleClose}>
        <DialogTitle className="sr-only">Búsqueda Global</DialogTitle>

        {/* Custom Header with action buttons */}
        <div className="relative">
          <CommandInput
            placeholder="Buscar pedidos, productos, clientes, campañas..."
            value={query}
            onValueChange={setQuery}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 hover:bg-muted"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? "Ventana normal" : "Pantalla completa"}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 hover:bg-muted"
              onClick={handleClose}
              title="Cerrar (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <CommandList className={cn(isFullscreen && 'max-h-[calc(90vh-100px)]')}>
          <CommandEmpty>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Cargando resultados...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Search className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">No se encontraron resultados</p>
                <p className="text-xs text-muted-foreground">Intenta con otros términos de búsqueda</p>
              </div>
            )}
          </CommandEmpty>

          {/* Auto-complete Suggestions */}
          {query && query.length >= 2 && suggestions.length > 0 && (
            <CommandGroup heading="Sugerencias">
              {suggestions.map((suggestion, index) => (
                <CommandItem
                  key={`suggestion-${index}`}
                  onSelect={() => setQuery(suggestion)}
                  className="text-sm text-muted-foreground italic"
                >
                  <Search className="mr-2 h-3.5 w-3.5" />
                  <span>{suggestion}</span>
                  <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
                    Tab
                  </kbd>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Frequent Items */}
          {!query && frequentItems.length > 0 && (
            <CommandGroup heading="Accedidos frecuentemente">
              {frequentItems.map((item) => (
                <CommandItem
                  key={`frequent-${item.type}-${item.id}`}
                  onSelect={() => {
                    if (item.type === 'carrier') {
                      handleSelect(() => navigate(`/carriers/${item.id}`));
                    } else {
                      const routes = {
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
                    <span>{item.label}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {item.accessCount}x
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Recent Searches */}
          {!query && recentSearches.length > 0 && (
            <CommandGroup heading="Búsquedas recientes">
              {recentSearches.map((search) => (
                <CommandItem
                  key={`${search.type}-${search.id}`}
                  onSelect={() => {
                    if (search.type === 'carrier') {
                      handleSelect(() => navigate(`/carriers/${search.id}`));
                    } else {
                      const routes = {
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
                  <span className="text-muted-foreground">{search.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Orders */}
          {!isLoading && filteredOrders.length > 0 && (
            <CommandGroup heading="Pedidos">
              {filteredOrders.map((order) => (
                <CommandItem
                  key={order.id}
                  onSelect={() => handleSelect(
                    () => navigate('/orders', { state: { highlightId: order.id } }),
                    { id: order.id, type: 'order', label: `Pedido ${order.id} - ${order.customer}` }
                  )}
                  className="flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ShoppingBag className="h-4 w-4 shrink-0 text-blue-500" />
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {highlightText(order.id, debouncedQuery)} - {highlightText(order.customer || '', debouncedQuery)}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {order.product} • {formatCurrency(order.total)}
                      </span>
                    </div>
                  </div>
                  <Badge variant="secondary" className={cn("text-xs shrink-0", getStatusColor(order.status))}>
                    {order.status === 'pending_confirmation' && 'Pendiente'}
                    {order.status === 'confirmed' && 'Confirmado'}
                    {order.status === 'prepared' && 'Preparado'}
                    {order.status === 'delivered_to_courier' && 'En Courier'}
                    {order.status === 'in_transit' && 'En Tránsito'}
                    {order.status === 'delivered' && 'Entregado'}
                    {order.status === 'reconciled' && 'Conciliado'}
                    {order.status === 'not_delivered' && 'No Entregado'}
                    {order.status === 'rejected' && 'Rechazado'}
                    {order.status === 'cancelled' && 'Cancelado'}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Products */}
          {!isLoading && filteredProducts.length > 0 && (
            <CommandGroup heading="Productos">
              {filteredProducts.map((product) => (
                <CommandItem
                  key={product.id}
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
                        {highlightText(product.name || '', debouncedQuery)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Stock: {product.stock} • {formatCurrency(product.price)}
                      </span>
                    </div>
                  </div>
                  {product.stock <= 10 && (
                    <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 shrink-0">
                      Bajo stock
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Customers */}
          {!isLoading && filteredCustomers.length > 0 && (
            <CommandGroup heading="Clientes">
              {filteredCustomers.map((customer) => (
                <CommandItem
                  key={customer.id}
                  onSelect={() => handleSelect(
                    () => navigate('/customers', { state: { highlightId: customer.id } }),
                    { id: customer.id, type: 'customer', label: `Cliente ${customer.first_name} ${customer.last_name}` }
                  )}
                  className="flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Users className="h-4 w-4 shrink-0 text-purple-500" />
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {highlightText(`${customer.first_name} ${customer.last_name}`, debouncedQuery)}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {customer.email || customer.phone}
                      </span>
                    </div>
                  </div>
                  {customer.total_orders > 0 && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {customer.total_orders} pedidos
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Campaigns */}
          {!isLoading && filteredAds.length > 0 && (
            <CommandGroup heading="Campañas">
              {filteredAds.map((ad) => (
                <CommandItem
                  key={ad.id}
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
                        {highlightText(ad.campaign_name || 'Sin nombre', debouncedQuery)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {ad.platform} • {formatCurrency(ad.investment)}
                      </span>
                    </div>
                  </div>
                  <Badge variant="secondary" className={cn(
                    "text-xs shrink-0",
                    ad.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                  )}>
                    {ad.status === 'active' ? 'Activa' : 'Pausada'}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Carriers */}
          {!isLoading && filteredCarriers.length > 0 && (
            <CommandGroup heading="Transportadoras">
              {filteredCarriers.map((carrier) => (
                <CommandItem
                  key={carrier.id}
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
                        {highlightText(carrier.carrier_name || '', debouncedQuery)}
                      </span>
                      {carrier.coverage_zones && (
                        <span className="text-xs text-muted-foreground truncate">
                          Cobertura: {carrier.coverage_zones}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className={cn(
                    "text-xs shrink-0",
                    carrier.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                  )}>
                    {carrier.is_active ? 'Activa' : 'Inactiva'}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
