import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Product } from '@/types';
import { Loader2 } from 'lucide-react';

const productSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(100, 'Máximo 100 caracteres'),
  description: z.string().optional(),
  sku: z.string().trim().min(1, 'El SKU es requerido para mapeo con Shopify').max(100, 'Máximo 100 caracteres'),
  category: z.string().optional(),
  image: z.string().url('URL inválida').or(z.literal('')),
  price: z.number({ required_error: 'El precio es requerido' }).positive('El precio debe ser mayor a 0'),
  cost: z.number({ required_error: 'El costo es requerido' }).positive('El costo debe ser mayor a 0'),
  stock: z.number({ required_error: 'El stock es requerido' }).int().min(0, 'El stock no puede ser negativo'),
  shopify_product_id: z.string().optional(),
  shopify_variant_id: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormProps {
  product?: Product;
  onSubmit: (data: ProductFormValues) => void;
  onCancel: () => void;
}

export function ProductForm({ product, onSubmit, onCancel }: ProductFormProps) {
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name || '',
      description: product?.description || '',
      sku: product?.sku || '',
      category: product?.category || '',
      image: product?.image || '',
      price: product?.price || undefined,
      cost: product?.cost || undefined,
      stock: product?.stock || undefined,
      shopify_product_id: product?.shopify_product_id || '',
      shopify_variant_id: product?.shopify_variant_id || '',
    },
  });

  const handleSubmit = (data: ProductFormValues) => {
    onSubmit(data);
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
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
                <FormLabel>Precio de Venta (Gs.)</FormLabel>
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
                <FormLabel>Costo (Gs.)</FormLabel>
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
              <FormLabel>{product ? 'Stock Actual' : 'Stock Inicial'}</FormLabel>
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

        {/* Shopify Integration Section */}
        <div className="border-t pt-4 mt-4">
          <div className="text-sm font-medium mb-3">
            Integración con Shopify (Opcional)
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            Si este producto ya existe en Shopify, ingresa los IDs para vincularlo y sincronizar inventario automáticamente.
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="shopify_product_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Shopify Product ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: 7234567890123"
                      {...field}
                      className="text-sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="shopify_variant_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Shopify Variant ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: 4234567890123"
                      {...field}
                      className="text-sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            💡 Tip: Puedes encontrar estos IDs en la URL del producto en Shopify Admin o usar la función de importación automática.
          </div>
        </div>

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
