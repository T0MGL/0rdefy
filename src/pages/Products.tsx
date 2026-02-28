import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { logger } from '@/utils/logger';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ProfitabilityCalculator } from '@/components/ProfitabilityCalculator';
import { ProductForm } from '@/components/forms/ProductForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { ExportButton } from '@/components/ExportButton';
import { ProductVariantsManager } from '@/components/ProductVariantsManager';
import { productsService } from '@/services/products.service';
import { useToast } from '@/hooks/use-toast';
import { useHighlight } from '@/hooks/useHighlight';
import { Plus, Edit, Trash2, PackageOpen, PackagePlus, Upload, ShoppingBag, ChevronDown, Download, Layers, MoreVertical, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Product } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { productsExportColumns } from '@/utils/exportConfigs';
import { formatCurrency } from '@/utils/currency';
import { showErrorToast } from '@/utils/errorMessages';

const PAGE_SIZE = 50;

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCalculator, setShowCalculator] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmShopifyDeleteOpen, setConfirmShopifyDeleteOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState<number>(0);
  const [hasShopifyIntegration, setHasShopifyIntegration] = useState(false);
  const [isPublishing, setIsPublishing] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'manual' | 'shopify'>('manual');
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [productToPublish, setProductToPublish] = useState<Product | null>(null);
  const [stockAdjustLoading, setStockAdjustLoading] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'low-stock' | 'out-of-stock'>('all');
  const [variantsDialogOpen, setVariantsDialogOpen] = useState(false);
  const [variantsProduct, setVariantsProduct] = useState<Product | null>(null);

  // Search & pagination state
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { toast } = useToast();
  const { isHighlighted } = useHighlight();
  const queryClient = useQueryClient();

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0); // Reset to first page on search
    }, 300);
  }, []);

  // Reset page when stock filter changes
  useEffect(() => {
    setPage(0);
  }, [stockFilter]);

  // TanStack Query for products
  const { data: productsResponse, isLoading, isFetching } = useQuery({
    queryKey: ['products', { search: debouncedSearch, stockFilter, page }],
    queryFn: () => productsService.getAll({
      search: debouncedSearch || undefined,
      stockFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    staleTime: 30_000, // 30s
    placeholderData: (prev) => prev, // Keep previous data while fetching
  });

  const products = productsResponse?.data || [];
  const pagination = productsResponse?.pagination || { total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false };
  const totalPages = Math.ceil(pagination.total / PAGE_SIZE);

  // Reset page if current page is beyond available data (e.g., after deleting last product on a page)
  useEffect(() => {
    if (totalPages > 0 && page >= totalPages) {
      setPage(totalPages - 1);
    }
  }, [totalPages, page]);

  // Check Shopify integration once
  useEffect(() => {
    productsService.checkShopifyIntegration().then(setHasShopifyIntegration);
  }, []);

  // Process URL query parameters for filtering and navigation from notifications
  useEffect(() => {
    const filter = searchParams.get('filter');
    const highlightId = searchParams.get('highlight');

    // Apply filter from URL
    if (filter) {
      switch (filter) {
        case 'low-stock':
          setStockFilter('low-stock');
          break;
        case 'out-of-stock':
          setStockFilter('out-of-stock');
          break;
        default:
          setStockFilter('all');
          break;
      }

      // Clean up URL after applying filter (keep highlight if present)
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('filter');
      if (newParams.toString() !== searchParams.toString()) {
        setSearchParams(newParams, { replace: true });
      }
    }

    // Validate highlighted product exists after data loads
    if (highlightId && products.length > 0) {
      const productExists = products.some(p => p.id === highlightId);
      if (!productExists) {
        toast({
          title: 'Producto no encontrado',
          description: 'El producto al que intentas acceder ya no existe o fue eliminado.',
          variant: 'destructive',
        });
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('highlight');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, setSearchParams, products, toast]);

  const invalidateProducts = () => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const handleCreate = () => {
    setSelectedProduct(null);
    setFormMode('manual');
    setDialogOpen(true);
  };

  const handleImportShopify = () => {
    setSelectedProduct(null);
    setFormMode('shopify');
    setDialogOpen(true);
  };

  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setFormMode('manual');
    setDialogOpen(true);
  };

  const handleDelete = (product: Product) => {
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  const handlePublishToShopifyClick = (product: Product) => {
    setProductToPublish(product);
    setPublishConfirmOpen(true);
  };

  const handlePublishToShopify = async () => {
    if (!productToPublish) return;

    setPublishConfirmOpen(false);
    setIsPublishing(productToPublish.id);

    try {
      await productsService.publishToShopify(productToPublish.id);
      invalidateProducts();

      toast({
        title: 'Producto publicado',
        description: 'El producto ha sido publicado exitosamente en Shopify.',
      });
    } catch (error: any) {
      logger.error('Error al publicar producto:', error);
      showErrorToast(toast, error, {
        module: 'products',
        action: 'publish_to_shopify',
        entity: 'producto',
      });
    } finally {
      setIsPublishing(null);
      setProductToPublish(null);
    }
  };

  const handleAdjustStock = (product: Product) => {
    setSelectedProduct(product);
    setStockAdjustment(0);
    setStockDialogOpen(true);
  };

  const handleManageVariants = (product: Product) => {
    setVariantsProduct(product);
    setVariantsDialogOpen(true);
  };

  const handleVariantsUpdated = () => {
    invalidateProducts();
  };

  const confirmStockAdjustment = async () => {
    if (!selectedProduct || stockAdjustment === 0) return;

    const newStock = selectedProduct.stock + stockAdjustment;
    if (newStock < 0) {
      toast({
        title: 'Error',
        description: 'El stock no puede ser negativo',
        variant: 'destructive',
      });
      return;
    }

    setStockAdjustLoading(true);
    try {
      await productsService.update(selectedProduct.id, {
        stock: newStock,
      });

      invalidateProducts();
      setStockDialogOpen(false);
      setStockAdjustment(0);

      toast({
        title: 'Stock actualizado',
        description: `${stockAdjustment > 0 ? 'Se agregaron' : 'Se restaron'} ${Math.abs(stockAdjustment)} unidades`,
      });
    } catch (error) {
      logger.error('Error al ajustar stock:', error);
      showErrorToast(toast, error, {
        module: 'products',
        action: 'adjust_stock',
        entity: 'stock',
        details: { productName: selectedProduct.name, adjustment: stockAdjustment },
      });
    } finally {
      setStockAdjustLoading(false);
    }
  };

  const handleDeleteOptionClick = (deleteFromShopify: boolean) => {
    if (deleteFromShopify) {
      setDeleteDialogOpen(false);
      setConfirmShopifyDeleteOpen(true);
    } else {
      confirmDelete(false);
    }
  };

  const confirmDelete = async (deleteFromShopify: boolean = false) => {
    if (!productToDelete) return;

    try {
      const success = await productsService.delete(productToDelete.id, deleteFromShopify);

      if (!success) {
        throw new Error('Error al eliminar producto');
      }

      invalidateProducts();

      setDeleteDialogOpen(false);
      setConfirmShopifyDeleteOpen(false);
      setProductToDelete(null);

      const deletionMessage = deleteFromShopify
        ? 'El producto ha sido eliminado de tu inventario local y de Shopify.'
        : 'El producto ha sido eliminado de tu inventario local. Permanece en Shopify.';

      toast({
        title: 'Producto eliminado',
        description: deletionMessage,
      });
    } catch (error) {
      logger.error('Error al eliminar producto:', error);
      showErrorToast(toast, error, {
        module: 'products',
        action: 'delete',
        entity: 'producto',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      if (selectedProduct) {
        const totalCost = data.cost + (data.packaging_cost || 0) + (data.additional_costs || 0);

        await productsService.update(selectedProduct.id, {
          ...data,
          profitability: data.price > 0 ? ((data.price - totalCost) / data.price * 100).toFixed(1) : '0.0',
          sales: selectedProduct.sales,
        });

        invalidateProducts();

        toast({
          title: 'Producto actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else if (data.id) {
        // Product already created by ProductForm (e.g., from Shopify import)
        invalidateProducts();

        toast({
          title: 'Producto importado',
          description: 'El producto ha sido importado exitosamente desde Shopify.',
        });
      } else {
        const totalCost = data.cost + (data.packaging_cost || 0) + (data.additional_costs || 0);

        await productsService.create({
          ...data,
          profitability: data.price > 0 ? ((data.price - totalCost) / data.price * 100).toFixed(1) : '0.0',
          sales: 0,
        });

        invalidateProducts();

        toast({
          title: 'Producto creado',
          description: 'El producto ha sido agregado al catálogo.',
        });
      }

      setDialogOpen(false);
    } catch (error) {
      logger.error('Error al guardar producto:', error);

      showErrorToast(toast, error, {
        module: 'products',
        action: selectedProduct ? 'update' : 'create',
        entity: 'producto',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Productos</h2>
            <p className="text-muted-foreground">Gestiona tu catálogo de productos</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Show empty state only when no products AND no active search/filter
  const isEmptyStore = products.length === 0 && !debouncedSearch && stockFilter === 'all';

  if (isEmptyStore) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Productos</h2>
            <p className="text-muted-foreground">Gestiona tu catálogo de productos</p>
          </div>
        </div>

        {/* Custom Empty State with multiple options */}
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <PackageOpen className="h-12 w-12 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No hay productos en tu catálogo</h3>
          <p className="text-muted-foreground text-center mb-6 max-w-md">
            Comienza agregando tu primer producto manualmente o impórtalo desde Shopify.
          </p>
          <div className="flex gap-3">
            <Button onClick={handleCreate} variant="default">
              <Plus className="h-4 w-4 mr-2" />
              Crear Producto
            </Button>
            {hasShopifyIntegration && (
              <Button onClick={handleImportShopify} variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Importar desde Shopify
              </Button>
            )}
          </div>
        </div>

        {/* Product Form Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {selectedProduct ? 'Editar Producto' : formMode === 'shopify' ? 'Importar desde Shopify' : 'Nuevo Producto'}
              </DialogTitle>
            </DialogHeader>
            <ProductForm
              product={selectedProduct || undefined}
              onSubmit={handleSubmit}
              onCancel={() => setDialogOpen(false)}
              initialMode={formMode}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* First-time Welcome Banner */}
      <FirstTimeWelcomeBanner
        moduleId="products"
        title="¡Bienvenido a Productos!"
        description="Aquí gestionas tu catálogo completo. Define precios, costos y controla el stock de cada producto."
        tips={['Define costos para ver márgenes', 'Sincroniza con Shopify', 'Ajusta stock manualmente']}
      />

      {/* Profitability Calculator */}
      {showCalculator && (
        <ProfitabilityCalculator />
      )}

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Productos</h2>
            <p className="text-muted-foreground">
              {pagination.total > 0
                ? `${pagination.total} producto${pagination.total !== 1 ? 's' : ''}`
                : 'Gestiona tu catálogo de productos'}
            </p>
          </div>
          <div className="flex gap-2">
            <ExportButton
              data={products}
              filename="productos"
              columns={productsExportColumns}
              title="Catálogo de Productos - Ordefy"
              variant="outline"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2">
                  <Plus size={18} />
                  Agregar Producto
                  <ChevronDown size={14} className="ml-1 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleCreate} className="gap-2 cursor-pointer">
                  <Plus size={16} />
                  Crear Manualmente
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleImportShopify}
                  disabled={!hasShopifyIntegration}
                  className="gap-2 cursor-pointer"
                >
                  <Download size={16} />
                  Importar de Shopify
                  {!hasShopifyIntegration && <span className="ml-auto text-xs text-muted-foreground">(No conectado)</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setShowCalculator(!showCalculator)}
            >
              {showCalculator ? 'Ocultar' : 'Mostrar'} Calculadora
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Stock Filter Chips */}
      {stockFilter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtrando por:</span>
          <Badge
            variant="secondary"
            className="cursor-pointer hover:bg-destructive/20"
            onClick={() => setStockFilter('all')}
          >
            {stockFilter === 'low-stock' ? 'Stock bajo' : 'Sin stock'}
            <span className="ml-1">×</span>
          </Badge>
          <span className="text-sm text-muted-foreground">
            ({pagination.total} productos)
          </span>
        </div>
      )}

      {/* No search results */}
      {products.length === 0 && (debouncedSearch || stockFilter !== 'all') && (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <Search className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">Sin resultados</h3>
          <p className="text-muted-foreground text-center text-sm">
            {debouncedSearch
              ? `No se encontraron productos para "${debouncedSearch}"`
              : 'No hay productos con este filtro de stock'}
          </p>
          <Button
            variant="ghost"
            className="mt-4"
            onClick={() => {
              handleSearchChange('');
              setStockFilter('all');
            }}
          >
            Limpiar filtros
          </Button>
        </div>
      )}

      {/* Products Grid */}
      {products.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product, index) => (
            <motion.div
              key={product.id}
              id={`item-${product.id}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.05, 0.3) }}
            >
              <Card className={`overflow-hidden hover:shadow-lg transition-all duration-300 hover:border-primary/50 ${isHighlighted(product.id)
                ? 'ring-2 ring-yellow-400 dark:ring-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                : ''
                }`}>
                <div className="aspect-square bg-muted flex items-center justify-center">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg mb-2">{product.name}</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={
                          product.stock > 20
                            ? 'bg-primary/20 text-primary border-primary/30'
                            : 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30'
                        }
                      >
                        Stock: {product.stock}
                      </Badge>
                      {(product as any).has_variants && (
                        <Badge variant="outline" className="bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30 gap-1">
                          <Layers size={12} />
                          Variantes
                        </Badge>
                      )}
                      {product.shopify_product_id && (
                        <Badge variant="outline" className="bg-green-500/20 text-green-700 border-green-500/30 gap-1">
                          <ShoppingBag size={12} />
                          Shopify
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Precio:</span>
                      <span className="font-semibold">{formatCurrency(product.price)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Costo:</span>
                      <span className="font-semibold">{formatCurrency(product.cost)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Rentabilidad:</span>
                      <span className="font-semibold text-primary">
                        {product.profitability}%
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Ventas totales:</span>
                      <span className="font-semibold">{product.sales}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-2">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        onClick={() => handleEdit(product)}
                      >
                        <Edit size={16} />
                        Editar
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="px-2">
                            <MoreVertical size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleManageVariants(product)}
                            className="gap-2 cursor-pointer"
                          >
                            <Layers size={16} />
                            Variantes / SKUs
                            {(product as any).has_variants && (
                              <Badge variant="secondary" className="ml-auto text-xs">
                                Activo
                              </Badge>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleAdjustStock(product)}
                            className="gap-2 cursor-pointer"
                          >
                            <PackagePlus size={16} />
                            Ajustar Stock
                          </DropdownMenuItem>
                          {hasShopifyIntegration && !product.shopify_product_id && (
                            <DropdownMenuItem
                              onClick={() => handlePublishToShopifyClick(product)}
                              disabled={isPublishing === product.id}
                              className="gap-2 cursor-pointer text-green-700 dark:text-green-400"
                            >
                              <Upload size={16} />
                              {isPublishing === product.id ? 'Publicando...' : 'Publicar a Shopify'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(product)}
                            className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                          >
                            <Trash2 size={16} />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, pagination.total)} de {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft size={16} />
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Siguiente
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Product Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={formMode === 'shopify' ? 'max-w-2xl' : 'max-w-md'}>
          <DialogHeader>
            <DialogTitle>
              {selectedProduct ? 'Editar Producto' : formMode === 'shopify' ? 'Importar desde Shopify' : 'Nuevo Producto'}
            </DialogTitle>
          </DialogHeader>
          <ProductForm
            product={selectedProduct || undefined}
            initialMode={formMode}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar Producto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {productToDelete?.shopify_product_id ? (
              <>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Este producto está vinculado con Shopify. Elige cómo deseas eliminarlo:
                  </p>
                  <div className="bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/20 dark:border-amber-500/30 rounded-lg p-4">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <svg className="h-5 w-5 text-amber-600 dark:text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-500">
                          Importante
                        </p>
                        <p className="text-sm text-amber-700 dark:text-amber-600 mt-1">
                          Esta acción no se puede deshacer
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={() => handleDeleteOptionClick(false)}
                    className="w-full h-auto py-3 px-4 hover:bg-muted"
                  >
                    <div className="flex items-start gap-3 text-left w-full">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="h-4 w-4 rounded-full border-2 border-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground">Solo de Ordefy</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          El producto permanecerá en Shopify
                        </div>
                      </div>
                    </div>
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleDeleteOptionClick(true)}
                    className="w-full h-auto py-3 px-4 border-destructive/30 hover:bg-destructive/10 dark:hover:bg-destructive/20"
                  >
                    <div className="flex items-start gap-3 text-left w-full">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="h-4 w-4 rounded-full border-2 border-destructive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-destructive">De Ordefy y Shopify</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          El producto será eliminado de ambas plataformas
                        </div>
                      </div>
                    </div>
                  </Button>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => setDeleteDialogOpen(false)}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Esta acción no se puede deshacer. El producto será eliminado permanentemente de tu inventario.
                </p>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setDeleteDialogOpen(false)}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => confirmDelete(false)}
                    className="flex-1"
                  >
                    Eliminar
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Shopify Delete Confirmation Dialog */}
      <Dialog open={confirmShopifyDeleteOpen} onOpenChange={setConfirmShopifyDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Eliminación de Shopify</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-destructive/10 dark:bg-destructive/20 border border-destructive/20 dark:border-destructive/30 rounded-lg p-4">
              <div className="flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="h-5 w-5 text-destructive" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Advertencia final
                  </p>
                  <p className="text-sm text-destructive/90 dark:text-destructive/80 mt-1">
                    Estás a punto de eliminar este producto de Ordefy y Shopify. Esta acción es permanente y no se puede deshacer.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">
                Producto: <span className="text-muted-foreground">{productToDelete?.name}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                ¿Estás seguro de que deseas continuar?
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmShopifyDeleteOpen(false);
                  setDeleteDialogOpen(true);
                }}
                className="flex-1"
              >
                Volver
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDelete(true)}
                className="flex-1"
              >
                Eliminar de Ambas
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock Adjustment Dialog */}
      <Dialog open={stockDialogOpen} onOpenChange={setStockDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar Stock</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Producto: <span className="font-semibold text-foreground">{selectedProduct?.name}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Stock actual: <span className="font-semibold text-foreground">{selectedProduct?.stock}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock-adjustment">Cantidad a agregar/restar</Label>
              <Input
                id="stock-adjustment"
                type="number"
                placeholder="Ej: +10 o -5"
                value={stockAdjustment === 0 ? '' : stockAdjustment}
                onChange={(e) => setStockAdjustment(parseInt(e.target.value) || 0)}
                className="text-lg"
              />
              <div className="text-xs text-muted-foreground">
                Usa números positivos para agregar (+) o negativos para restar (-)
              </div>
            </div>

            {stockAdjustment !== 0 && selectedProduct && (
              <div className="bg-muted p-3 rounded-md">
                <div className="text-sm">
                  Stock nuevo: <span className="font-bold text-lg">
                    {selectedProduct.stock + stockAdjustment}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStockDialogOpen(false)}
                className="flex-1"
                disabled={stockAdjustLoading}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmStockAdjustment}
                disabled={stockAdjustment === 0 || stockAdjustLoading}
                className="flex-1"
              >
                {stockAdjustLoading ? 'Guardando...' : 'Confirmar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Publish to Shopify Confirmation Dialog */}
      <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Publicar en Shopify</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-green-500/10 dark:bg-green-500/20 border border-green-500/20 dark:border-green-500/30 rounded-lg p-4">
              <div className="flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <ShoppingBag className="h-5 w-5 text-green-600 dark:text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-500">
                    Confirmar publicación
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-600 mt-1">
                    El producto será publicado en tu tienda de Shopify y estará disponible para venta.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">
                Producto: <span className="text-muted-foreground">{productToPublish?.name}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Precio: {formatCurrency(productToPublish?.price || 0)}
              </p>
              <p className="text-sm text-muted-foreground">
                Stock: {productToPublish?.stock || 0} unidades
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPublishConfirmOpen(false);
                  setProductToPublish(null);
                }}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handlePublishToShopify}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                Publicar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Product Variants Manager */}
      {variantsProduct && (
        <ProductVariantsManager
          productId={variantsProduct.id}
          productName={variantsProduct.name}
          open={variantsDialogOpen}
          onOpenChange={setVariantsDialogOpen}
          onVariantsUpdated={handleVariantsUpdated}
        />
      )}
    </div>
  );
}
