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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { productsService } from '@/services/products.service';
import { carriersService, Carrier } from '@/services/carriers.service';
import { useState, useEffect } from 'react';
import { Product } from '@/types';

const orderSchema = z.object({
  customer: z.string().trim().min(1, 'El nombre del cliente es requerido').max(100),
  countryCode: z.string().min(1, 'Selecciona un código de país'),
  phone: z.string().trim().regex(/^[0-9]{6,15}$/, 'Formato de teléfono inválido (solo números)'),
  address: z.string().trim().min(1, 'La dirección es requerida').max(300),
  product: z.string().min(1, 'Selecciona un producto'),
  quantity: z.number().int().positive('La cantidad debe ser mayor a 0'),
  carrier: z.string().min(1, 'Selecciona un repartidor'),
  paymentMethod: z.enum(['paid', 'cod'], {
    errorMap: () => ({ message: 'Selecciona un método de pago' })
  }),
});

type OrderFormValues = z.infer<typeof orderSchema>;

interface OrderFormProps {
  onSubmit: (data: OrderFormValues) => void;
  onCancel: () => void;
  initialData?: Partial<OrderFormValues>;
}

export function OrderForm({ onSubmit, onCancel, initialData }: OrderFormProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [isLoadingCarriers, setIsLoadingCarriers] = useState(true);

  useEffect(() => {
    const loadProducts = async () => {
      const data = await productsService.getAll();
      setProducts(data);
      setIsLoadingProducts(false);
    };
    loadProducts();
  }, []);

  useEffect(() => {
    const loadCarriers = async () => {
      const data = await carriersService.getAll();
      // Filter only active carriers
      const activeCarriers = data.filter(carrier => carrier.is_active);
      setCarriers(activeCarriers);
      setIsLoadingCarriers(false);
    };
    loadCarriers();
  }, []);

  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customer: initialData?.customer || '',
      countryCode: '+595', // Default to Paraguay
      phone: initialData?.phone?.replace(/^\+\d+\s*/, '') || '', // Remove country code if present
      address: initialData?.address || '',
      product: initialData?.product || '',
      quantity: initialData?.quantity || 1,
      carrier: initialData?.carrier || '',
      paymentMethod: initialData?.paymentMethod || 'cod',
    },
  });

  const handleSubmit = (data: OrderFormValues) => {
    // Combine country code and phone number
    const fullPhone = `${data.countryCode}${data.phone}`;
    onSubmit({ ...data, phone: fullPhone });
    form.reset({
      customer: '',
      countryCode: '+595',
      phone: '',
      address: '',
      product: '',
      quantity: 1,
      carrier: '',
      paymentMethod: 'cod',
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="customer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre del Cliente</FormLabel>
              <FormControl>
                <Input placeholder="Juan Pérez" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-3 gap-2">
          <FormField
            control={form.control}
            name="countryCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>País</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Código" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="+595">🇵🇾 +595</SelectItem>
                    <SelectItem value="+54">🇦🇷 +54</SelectItem>
                    <SelectItem value="+55">🇧🇷 +55</SelectItem>
                    <SelectItem value="+598">🇺🇾 +598</SelectItem>
                    <SelectItem value="+56">🇨🇱 +56</SelectItem>
                    <SelectItem value="+51">🇵🇪 +51</SelectItem>
                    <SelectItem value="+57">🇨🇴 +57</SelectItem>
                    <SelectItem value="+52">🇲🇽 +52</SelectItem>
                    <SelectItem value="+34">🇪🇸 +34</SelectItem>
                    <SelectItem value="+1">🇺🇸 +1</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Teléfono</FormLabel>
                <FormControl>
                  <Input placeholder="981234567" type="tel" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dirección</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Calle, número, barrio, ciudad..."
                  className="resize-none"
                  rows={2}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="product"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Producto</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un producto" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {isLoadingProducts ? (
                    <SelectItem value="loading" disabled>
                      Cargando productos...
                    </SelectItem>
                  ) : products.length === 0 ? (
                    <SelectItem value="empty" disabled>
                      No hay productos disponibles
                    </SelectItem>
                  ) : (
                    products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} - Gs. {product.price.toLocaleString()}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="quantity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cantidad</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="1"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="carrier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repartidor</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un repartidor" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {isLoadingCarriers ? (
                    <SelectItem value="loading" disabled>
                      Cargando repartidores...
                    </SelectItem>
                  ) : carriers.length === 0 ? (
                    <SelectItem value="empty" disabled>
                      No hay repartidores disponibles
                    </SelectItem>
                  ) : (
                    carriers.map((carrier) => (
                      <SelectItem key={carrier.id} value={carrier.id}>
                        {carrier.name}
                        {carrier.phone && ` - ${carrier.phone}`}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="paymentMethod"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Método de Pago</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el método de pago" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="cod">Contra Entrega (COD)</SelectItem>
                  <SelectItem value="paid">Pagado</SelectItem>
                </SelectContent>
              </Select>
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
                {initialData ? 'Actualizando...' : 'Creando...'}
              </>
            ) : (
              initialData ? 'Actualizar Pedido' : 'Crear Pedido'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
