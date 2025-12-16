import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProfitabilityCalculator } from '@/components/ProfitabilityCalculator';
import { ProductForm } from '@/components/forms/ProductForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ExportButton } from '@/components/ExportButton';
import { productsService } from '@/services/products.service';
import { useToast } from '@/hooks/use-toast';
import { useHighlight } from '@/hooks/useHighlight';
import { Plus, Edit, Trash2, PackageOpen, PackagePlus, Upload, ShoppingBag, ChevronDown, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Product } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { productsExportColumns } from '@/utils/exportConfigs';
import { formatCurrency } from '@/utils/currency';

export default function Products() {
  const [showCalculator, setShowCalculator] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState<number>(0);
  const [hasShopifyIntegration, setHasShopifyIntegration] = useState(false);
  const [isPublishing, setIsPublishing] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'manual' | 'shopify'>('manual');
  const { toast } = useToast();
  const { isHighlighted } = useHighlight();

  useEffect(() => {
    const loadProducts = async () => {
      const data = await productsService.getAll();
      setProducts(data);
      setIsLoading(false);
    };
    const checkShopify = async () => {
      const hasIntegration = await productsService.checkShopifyIntegration();
      setHasShopifyIntegration(hasIntegration);
    };
    loadProducts();
    checkShopify();
  }, []);

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
    setFormMode('manual'); // Editing is always manual form for now
    setDialogOpen(true);
  };

  const handleDelete = (product: Product) => {
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  const handlePublishToShopify = async (productId: string) => {
    setIsPublishing(productId);
    try {
      await productsService.publishToShopify(productId);

      // Recargar productos para obtener el shopify_product_id actualizado
      const updatedProducts = await productsService.getAll();
      setProducts(updatedProducts);

      toast({
        title: 'Producto publicado',
        description: 'El producto ha sido publicado exitosamente en Shopify.',
      });
    } catch (error: any) {
      console.error('Error al publicar producto:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo publicar el producto en Shopify',
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(null);
    }
  };

  const handleAdjustStock = (product: Product) => {
    setSelectedProduct(product);
    setStockAdjustment(0);
    setStockDialogOpen(true);
  };

  const confirmStockAdjustment = async () => {
    if (!selectedProduct || stockAdjustment === 0) return;

    try {
      const newStock = selectedProduct.stock + stockAdjustment;
      if (newStock < 0) {
        toast({
          title: 'Error',
          description: 'El stock no puede ser negativo',
          variant: 'destructive',
        });
        return;
      }

      await productsService.update(selectedProduct.id, {
        stock: newStock,
      });

      const updatedProducts = await productsService.getAll();
      setProducts(updatedProducts);
      setStockDialogOpen(false);
      setStockAdjustment(0);

      toast({
        title: 'Stock actualizado',
        description: `${stockAdjustment > 0 ? 'Se agregaron' : 'Se restaron'} ${Math.abs(stockAdjustment)} unidades`,
      });
    } catch (error) {
      console.error('Error al ajustar stock:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el stock',
        variant: 'destructive',
      });
    }
  };

  const confirmDelete = async (deleteFromShopify: boolean = false) => {
    if (!productToDelete) return;

    try {
      const success = await productsService.delete(productToDelete.id, deleteFromShopify);

      if (!success) {
        throw new Error('Failed to delete product');
      }

      // Only update UI after successful server response
      setProducts(prev => prev.filter(p => p.id !== productToDelete.id));

      setDeleteDialogOpen(false);
      setProductToDelete(null);

      const deletionMessage = deleteFromShopify
        ? 'El producto ha sido eliminado de tu inventario local y de Shopify.'
        : 'El producto ha sido eliminado de tu inventario local. Permanece en Shopify.';

      toast({
        title: 'Producto eliminado',
        description: deletionMessage,
      });
    } catch (error) {
      console.error('Error al eliminar producto:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el producto. Por favor intenta de nuevo.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      if (selectedProduct) {
        const updatedProduct = await productsService.update(selectedProduct.id, {
          ...data,
          profitability: ((data.price - data.cost) / data.price * 100).toFixed(1),
          sales: selectedProduct.sales,
        });

        if (updatedProduct) {
          // Optimistic update: update in local state
          setProducts(prev =>
            prev.map(p => (p.id === selectedProduct.id ? updatedProduct : p))
          );
        }

        toast({
          title: 'Producto actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        const newProduct = await productsService.create({
          ...data,
          profitability: ((data.price - data.cost) / data.price * 100).toFixed(1),
          sales: 0,
        });

        // Optimistic update: add to local state
        setProducts(prev => [newProduct, ...prev]);

        toast({
          title: 'Producto creado',
          description: 'El producto ha sido agregado al catálogo.',
        });
      }

      setDialogOpen(false);
    } catch (error) {
      console.error('Error al guardar producto:', error);
      toast({
        title: 'Error',
        description: 'No se pudo guardar el producto',
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

  if (products.length === 0) {
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
      {/* Profitability Calculator */}
      {showCalculator && (
        <ProfitabilityCalculator />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Productos</h2>
          <p className="text-muted-foreground">Gestiona tu catálogo de productos</p>
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

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product, index) => (
          <motion.div
            key={product.id}
            id={`item-${product.id}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => handleAdjustStock(product)}
                  >
                    <PackagePlus size={16} />
                    Ajustar Stock
                  </Button>
                  {hasShopifyIntegration && !product.shopify_product_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                      onClick={() => handlePublishToShopify(product.id)}
                      disabled={isPublishing === product.id}
                    >
                      {isPublishing === product.id ? (
                        <>Publicando...</>
                      ) : (
                        <>
                          <Upload size={16} />
                          Publicar a Shopify
                        </>
                      )}
                    </Button>
                  )}
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(product)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
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
            <DialogTitle>¿Eliminar producto?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {productToDelete?.shopify_product_id ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Este producto está vinculado con Shopify. Elige cómo deseas eliminarlo:
                  </p>
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-400">
                      ⚠️ <strong>Importante:</strong> Esta acción no se puede deshacer.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    onClick={() => confirmDelete(false)}
                    className="w-full justify-start text-left"
                  >
                    <div className="flex flex-col items-start">
                      <span className="font-semibold">Solo de Ordefy</span>
                      <span className="text-xs text-muted-foreground">El producto permanecerá en Shopify</span>
                    </div>
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => confirmDelete(true)}
                    className="w-full justify-start text-left"
                  >
                    <div className="flex flex-col items-start">
                      <span className="font-semibold">De Ordefy y Shopify</span>
                      <span className="text-xs opacity-90">El producto será eliminado de ambas plataformas</span>
                    </div>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDeleteDialogOpen(false)}
                    className="w-full"
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
                <div className="flex gap-2">
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
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmStockAdjustment}
                disabled={stockAdjustment === 0}
                className="flex-1"
              >
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
