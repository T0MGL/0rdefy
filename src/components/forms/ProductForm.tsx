import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { InfoTooltip } from '@/components/InfoTooltip';
import { logger } from '@/utils/logger';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Product } from '@/types';
import { Loader2, Package, Search, AlertCircle, CheckCircle2 } from 'lucide-react';
import { productsService } from '@/services/products.service';
import { Badge } from '@/components/ui/badge';

// Schema para modo manual (sin Shopify)
const manualProductSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(100, 'Máximo 100 caracteres'),
  description: z.string().optional(),
  sku: z.string().trim().min(1, 'El SKU es requerido').max(100, 'Máximo 100 caracteres'),
  category: z.string().optional(),
  image: z.string().url('URL inválida').or(z.literal('')),
  price: z.number({ required_error: 'El precio es requerido' }).positive('El precio debe ser mayor a 0'),
  cost: z.number().optional().nullable(),
  packaging_cost: z.number().nonnegative().optional().default(0),
  additional_costs: z.number().nonnegative().optional().default(0),
  is_service: z.boolean().default(false),
  stock: z.number({ required_error: 'El stock es requerido' }).int().min(0, 'El stock no puede ser negativo'),
}).refine((data) => {
  // Si NO es un servicio, el costo es requerido
  if (!data.is_service && (data.cost === null || data.cost === undefined || data.cost <= 0)) {
    return false;
  }
  return true;
}, {
  message: 'El costo es requerido para productos físicos',
  path: ['cost'],
});

type ManualProductFormValues = z.infer<typeof manualProductSchema>;

interface ProductFormProps {
  product?: Product;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  initialMode?: 'shopify' | 'manual';
}

interface ShopifyProduct {
  id: string;
  title: string;
  image: string;
  variants: Array<{
    id: string;
    title: string;
    sku: string;
    price: number;
    inventory_quantity: number;
    is_imported?: boolean;
  }>;
}

export function ProductForm({ product, onSubmit, onCancel, initialMode = 'manual' }: ProductFormProps) {
  const [mode, setMode] = useState<'shopify' | 'manual' | 'loading'>('loading');
  const [loading, setLoading] = useState(false);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [selectedVariant, setSelectedVariant] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shopifyCost, setShopifyCost] = useState<number | undefined>(undefined);
  const [shopifyPackagingCost, setShopifyPackagingCost] = useState<number>(0);
  const [shopifyAdditionalCosts, setShopifyAdditionalCosts] = useState<number>(0);
  const [shopifyIsService, setShopifyIsService] = useState<boolean>(false);

  // Initialize mode
  useEffect(() => {
    // If we have an initial mode passed (e.g. from parent based on user choice), use it
    // If not, explicit manual default or based on editing product
    if (product) {
      setMode('manual'); // Editing is always manual form for now, even if it has shopify_id
    } else {
      setMode(initialMode);
    }

    // If mode is shopify, load products
    if (initialMode === 'shopify' && !product) {
      loadShopifyProducts();
    }
  }, [initialMode, product]);

  // Form para modo manual
  const form = useForm<ManualProductFormValues>({
    resolver: zodResolver(manualProductSchema),
    defaultValues: {
      name: product?.name || '',
      description: product?.description || '',
      sku: product?.sku || '',
      category: product?.category || '',
      image: product?.image || '',
      price: product?.price || undefined,
      cost: product?.cost || undefined,
      packaging_cost: product?.packaging_cost || 0,
      additional_costs: product?.additional_costs || 0,
      is_service: product?.is_service || false,
      stock: product?.stock || undefined,
    },
  });

  const isService = form.watch('is_service');

  useEffect(() => {
    if (isService) {
      form.setValue('packaging_cost', 0);
    }
  }, [isService, form]);

  const loadShopifyProducts = async (search?: string) => {
    setLoading(true);
    try {
      const products = await productsService.getShopifyProducts(search);
      setShopifyProducts(products);
    } catch (error) {
      logger.error('Error loading Shopify products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadShopifyProducts(searchQuery);
  };

  const handleShopifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProduct || !selectedVariant) {
      return;
    }

    setIsSubmitting(true);
    try {
      const product = await productsService.createFromShopify(
        selectedProduct,
        selectedVariant,
        {
          cost: shopifyCost,
          packaging_cost: shopifyPackagingCost,
          additional_costs: shopifyAdditionalCosts,
          is_service: shopifyIsService
        }
      );
      onSubmit(product);
      // Reset only on success
      setSelectedProduct('');
      setSelectedVariant('');
      setShopifyCost(undefined);
      setShopifyPackagingCost(0);
      setShopifyAdditionalCosts(0);
      setShopifyIsService(false);
    } catch (error: any) {
      logger.error('Error creating product:', error);
      // Error is thrown back to parent - don't reset form state
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSubmit = async (data: ManualProductFormValues) => {
    try {
      await onSubmit(data);
      // Only reset form after successful submission
      form.reset();
    } catch (error) {
      // Error handled by parent, form state preserved for retry
      logger.error('Error submitting product form:', error);
    }
  };

  const selectedProductData = shopifyProducts.find(p => p.id === selectedProduct);
  const selectedVariantData = selectedProductData?.variants.find(v => v.id === selectedVariant);

  // Modo de carga
  if (mode === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Modo Shopify
  if (mode === 'shopify') {
    return (
      <form onSubmit={handleShopifySubmit} className="space-y-6">
        {/* Search */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Buscar Producto de Shopify</label>
          <div className="flex gap-2">
            <Input
              placeholder="Buscar por nombre o SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleSearch}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Product Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Producto *</label>
          <Select value={selectedProduct} onValueChange={(value) => {
            setSelectedProduct(value);
            setSelectedVariant('');
          }}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un producto de Shopify" />
            </SelectTrigger>
            <SelectContent>
              {shopifyProducts.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {loading ? 'Cargando productos...' : 'No hay productos disponibles'}
                </div>
              ) : (
                shopifyProducts.map((product) => {
                  const hasImportedVariants = product.variants.some(v => v.is_imported);
                  return (
                    <SelectItem key={product.id} value={product.id}>
                      <div className="flex items-center gap-2 w-full">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.title}
                            className="w-8 h-8 object-cover rounded"
                          />
                        ) : (
                          <div className="w-8 h-8 bg-muted rounded flex items-center justify-center">
                            <Package className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <span className="flex-1">{product.title}</span>
                        {hasImportedVariants && (
                          <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 text-xs gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Importado
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  );
                })
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Variant Selector */}
        {selectedProduct && selectedProductData && selectedProductData.variants.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Variante *</label>
            <Select value={selectedVariant} onValueChange={setSelectedVariant}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una variante" />
              </SelectTrigger>
              <SelectContent>
                {selectedProductData.variants.map((variant) => (
                  <SelectItem key={variant.id} value={variant.id}>
                    <div className="flex items-start gap-2 w-full">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{variant.title}</span>
                          {variant.is_imported && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 text-xs gap-1 shrink-0">
                              <CheckCircle2 className="h-3 w-3" />
                              Ya importado
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          SKU: {variant.sku || 'N/A'} | Stock: {variant.inventory_quantity} | {formatCurrency(variant.price)}
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Preview */}
        {selectedVariantData && (
          <div className="border rounded-lg p-4 bg-muted/50">
            <h3 className="text-sm font-medium mb-3">Vista Previa</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Producto:</span>
                <p className="font-medium">{selectedProductData?.title}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Variante:</span>
                <p className="font-medium">{selectedVariantData.title}</p>
              </div>
              <div>
                <span className="text-muted-foreground">SKU:</span>
                <p className="font-medium">{selectedVariantData.sku || 'N/A'}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Precio:</span>
                <p className="font-medium">{formatCurrency(selectedVariantData.price)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Stock:</span>
                <p className="font-medium">{selectedVariantData.inventory_quantity}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tipo de Producto y Costos */}
        {selectedVariant && (
          <div className="space-y-4 border-t pt-4">
            {/* Checkbox: Es un Servicio */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="shopify-is-service"
                checked={shopifyIsService}
                onCheckedChange={(checked) => {
                  setShopifyIsService(checked as boolean);
                  // Si es servicio, limpiar costos de packaging
                  if (checked) {
                    setShopifyPackagingCost(0);
                  }
                }}
              />
              <label
                htmlFor="shopify-is-service"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Es un servicio (no requiere inventario físico)
              </label>
            </div>

            {/* Costos del Producto */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Configurar Costos</h3>
                <span className="text-xs text-muted-foreground">(Opcional)</span>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-sm font-medium">Costo del Producto ({getCurrencySymbol()})</label>
                    <InfoTooltip content="Costo de adquisición o producción del producto" />
                  </div>
                  <Input
                    type="number"
                    placeholder="Ej: 21500"
                    value={shopifyCost ?? ''}
                    onChange={(e) => setShopifyCost(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                  />
                </div>

                {!shopifyIsService && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <label className="text-sm font-medium">Packaging ({getCurrencySymbol()})</label>
                        <InfoTooltip content="Costo del empaque y materiales de envío" />
                      </div>
                      <Input
                        type="number"
                        placeholder="Ej: 1500"
                        value={shopifyPackagingCost}
                        onChange={(e) => setShopifyPackagingCost(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <label className="text-sm font-medium">Adicionales ({getCurrencySymbol()})</label>
                        <InfoTooltip content="Otros costos (etiquetas, comisiones, etc.)" />
                      </div>
                      <Input
                        type="number"
                        placeholder="Ej: 500"
                        value={shopifyAdditionalCosts}
                        onChange={(e) => setShopifyAdditionalCosts(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Info Message */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          <p className="font-medium mb-1">ℹ️ Sincronización Automática</p>
          <p className="text-xs">
            Al seleccionar un producto de Shopify, toda la información (nombre, SKU, precio, stock, imágenes)
            se sincronizará automáticamente. No necesitas ingresar nada manualmente.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={!selectedProduct || !selectedVariant || isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Agregando...
              </>
            ) : (
              'Agregar Producto'
            )}
          </Button>
        </div>
      </form>
    );
  }

  // Modo Manual (sin Shopify)
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleManualSubmit)} className="space-y-4">
        {/* Info Message */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium mb-1">Modo Manual</p>
              <p className="text-xs">
                Crea un producto ingresando manualmente toda su información. Este producto se guardará en tu inventario local.
              </p>
            </div>
          </div>
        </div>

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre del Producto *</FormLabel>
              <FormControl>
                <Input placeholder="Ej: Zapatillas Deportivas" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea placeholder="Descripción del producto..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="sku"
            render={({ field }) => (
              <FormItem>
                <FormLabel>SKU * <span className="text-xs text-muted-foreground">(Código único)</span></FormLabel>
                <FormControl>
                  <Input placeholder="PROD-001" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Categoría</FormLabel>
                <FormControl>
                  <Input placeholder="Ej: Calzado, Ropa, etc." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="image"
          render={({ field }) => (
            <FormItem>
              <FormLabel>URL de Imagen</FormLabel>
              <FormControl>
                <Input placeholder="https://..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Precio de Venta ({getCurrencySymbol()}) *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="0"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="cost"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Costo Producto ({getCurrencySymbol()}) {!isService && '*'}
                  {isService && <span className="text-xs text-muted-foreground ml-1">(Opcional)</span>}
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder={isService ? "0 (opcional)" : "0"}
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="is_service"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel className="flex items-center">
                  Es un Servicio / Intangible (Upsell)
                  <InfoTooltip
                    content="Activa esta opción para productos intangibles (Delivery, Seguros, Propinas). Esto elimina automáticamente los costos de empaque del cálculo de rentabilidad."
                  />
                </FormLabel>
                <p className="text-sm text-muted-foreground">
                  Activar para ítems como Delivery Rápido, Seguros o Propinas que no requieren empaque físico.
                </p>
              </div>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          {!isService && (
            <FormField
              control={form.control}
              name="packaging_cost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Costo Empaque ({getCurrencySymbol()}) <span className="text-xs text-muted-foreground">(Opcional)</span></FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="0"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="additional_costs"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Costos Adicionales ({getCurrencySymbol()}) <span className="text-xs text-muted-foreground">(Opcional)</span></FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="0"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="stock"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center">
                {product ? 'Stock Actual' : 'Stock Inicial'} *
                <InfoTooltip
                  content="Físico: Todo lo que hay en el almacén. Disponible: Físico menos las unidades reservadas en pedidos pendientes de despacho."
                />
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="0"
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseInt(e.target.value))}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting} className="flex-1">
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : product ? (
              'Actualizar'
            ) : (
              'Crear Producto'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
