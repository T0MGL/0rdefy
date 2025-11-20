import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProfitabilityCalculator } from '@/components/ProfitabilityCalculator';
import { ProductForm } from '@/components/forms/ProductForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSkeleton } from '@/components/skeletons/CardSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ExportButton } from '@/components/ExportButton';
import { productsService } from '@/services/products.service';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Trash2, PackageOpen, PackagePlus } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Product } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { productsExportColumns } from '@/utils/exportConfigs';

export default function Products() {
  const [showCalculator, setShowCalculator] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [stockAdjustment, setStockAdjustment] = useState<number>(0);
  const { toast } = useToast();

  useEffect(() => {
    const loadProducts = async () => {
      const data = await productsService.getAll();
      setProducts(data);
      setIsLoading(false);
    };
    loadProducts();
  }, []);

  const handleCreate = () => {
    setSelectedProduct(null);
    setDialogOpen(true);
  };

  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setProductToDelete(id);
    setDeleteDialogOpen(true);
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

  const confirmDelete = async () => {
    if (!productToDelete) return;

    try {
      await productsService.delete(productToDelete);

      // Optimistic update: remove from local state instead of reloading
      setProducts(prev => prev.filter(p => p.id !== productToDelete));

      setDeleteDialogOpen(false);
      setProductToDelete(null);

      toast({
        title: 'Producto eliminado',
        description: 'El producto ha sido eliminado exitosamente.',
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
        <EmptyState
          icon={PackageOpen}
          title="No hay productos en tu catálogo"
          description="Comienza agregando tu primer producto para empezar a vender."
          action={{
            label: 'Agregar Primer Producto',
            onClick: handleCreate,
          }}
        />

        {/* Product Form Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {selectedProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </DialogTitle>
            </DialogHeader>
            <ProductForm
              product={selectedProduct || undefined}
              onSubmit={handleSubmit}
              onCancel={() => setDialogOpen(false)}
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
          <Button
            onClick={() => {
              console.log('🖱️ [PRODUCTS] Button clicked');
              handleCreate();
            }}
            className="gap-2"
          >
            <Plus size={18} />
            Agregar Producto
          </Button>
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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 hover:border-primary/50">
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
                  <div className="flex items-center gap-2">
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
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Precio:</span>
                    <span className="font-semibold">Gs. {product.price.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Costo:</span>
                    <span className="font-semibold">Gs. {product.cost.toLocaleString()}</span>
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
                      onClick={() => handleDelete(product.id)}
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
              {selectedProduct ? 'Editar Producto' : 'Nuevo Producto'}
            </DialogTitle>
          </DialogHeader>
          <ProductForm
            product={selectedProduct || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="¿Eliminar producto?"
        description="Esta acción no se puede deshacer. El producto será eliminado permanentemente."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />

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
