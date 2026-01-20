import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Package, Loader2, Box, HelpCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Variant {
  id: string;
  product_id: string;
  sku: string | null;
  variant_title: string;
  option1_name?: string | null;
  option1_value?: string | null;
  option2_name?: string | null;
  option2_value?: string | null;
  price: number;
  cost: number | null;
  stock: number;
  is_active: boolean;
  position: number;
  uses_shared_stock?: boolean;
  units_per_pack?: number;
}

interface ProductVariantsManagerProps {
  productId: string;
  productName: string;
  productStock?: number;
  productImageUrl?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVariantsUpdated?: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const getAuthHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
  'X-Store-ID': localStorage.getItem('current_store_id') || ''
});

export function ProductVariantsManager({
  productId,
  productName,
  productStock = 0,
  productImageUrl,
  open,
  onOpenChange,
  onVariantsUpdated
}: ProductVariantsManagerProps) {
  const { toast } = useToast();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [parentStock, setParentStock] = useState(productStock);

  // Form state
  const [formData, setFormData] = useState({
    variant_title: '',
    sku: '',
    price: '',
    cost: '',
    stock: '0',
    option1_name: 'Cantidad',
    option1_value: '',
    uses_shared_stock: true,
    units_per_pack: '1'
  });

  // Fetch variants when dialog opens
  useEffect(() => {
    if (open && productId) {
      fetchVariants();
    }
  }, [open, productId]);

  const fetchVariants = async () => {
    setLoading(true);
    try {
      // Fetch variants
      const response = await fetch(`${API_BASE}/api/products/${productId}/variants`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Error al cargar variantes');
      }

      const data = await response.json();
      setVariants(data.variants || []);

      // Also fetch parent product stock
      const productResponse = await fetch(`${API_BASE}/api/products/${productId}`, {
        headers: getAuthHeaders()
      });

      if (productResponse.ok) {
        const productData = await productResponse.json();
        setParentStock(productData.stock || 0);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Error al cargar variantes',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      variant_title: '',
      sku: '',
      price: '',
      cost: '',
      stock: '0',
      option1_name: 'Cantidad',
      option1_value: '',
      uses_shared_stock: true,
      units_per_pack: '1'
    });
    setEditingVariant(null);
    setShowAddForm(false);
  };

  const handleEditVariant = (variant: Variant) => {
    setFormData({
      variant_title: variant.variant_title,
      sku: variant.sku || '',
      price: variant.price.toString(),
      cost: variant.cost?.toString() || '',
      stock: variant.stock.toString(),
      option1_name: variant.option1_name || 'Cantidad',
      option1_value: variant.option1_value || '',
      uses_shared_stock: variant.uses_shared_stock ?? true,
      units_per_pack: (variant.units_per_pack || 1).toString()
    });
    setEditingVariant(variant);
    setShowAddForm(true);
  };

  const handleSaveVariant = async () => {
    if (!formData.variant_title || !formData.price) {
      toast({
        title: 'Error',
        description: 'Nombre de variante y precio son requeridos',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        variant_title: formData.variant_title,
        sku: formData.sku || null,
        price: parseFloat(formData.price),
        cost: formData.cost ? parseFloat(formData.cost) : null,
        stock: formData.uses_shared_stock ? 0 : (parseInt(formData.stock, 10) || 0),
        option1_name: formData.option1_name || null,
        option1_value: formData.option1_value || null,
        uses_shared_stock: formData.uses_shared_stock,
        units_per_pack: parseInt(formData.units_per_pack, 10) || 1,
        image_url: productImageUrl // Inherit from parent product
      };

      let response;
      if (editingVariant) {
        // Update existing
        response = await fetch(`${API_BASE}/api/products/${productId}/variants/${editingVariant.id}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
      } else {
        // Create new
        response = await fetch(`${API_BASE}/api/products/${productId}/variants`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al guardar variante');
      }

      toast({
        title: editingVariant ? 'Variante actualizada' : 'Variante creada',
        description: `La variante "${formData.variant_title}" se ha guardado correctamente`
      });

      resetForm();
      fetchVariants();
      onVariantsUpdated?.();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Error al guardar variante',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVariant = async (variant: Variant) => {
    if (!confirm(`¿Eliminar variante "${variant.variant_title}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/products/${productId}/variants/${variant.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Error al eliminar variante');
      }

      toast({
        title: 'Variante eliminada',
        description: `La variante "${variant.variant_title}" se ha eliminado`
      });

      fetchVariants();
      onVariantsUpdated?.();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Error al eliminar variante',
        variant: 'destructive'
      });
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('es-PY', {
      style: 'currency',
      currency: 'PYG',
      minimumFractionDigits: 0
    }).format(price);
  };

  const currentUnitsPerPack = parseInt(formData.units_per_pack, 10) || 1;
  const calculatedPacks = Math.floor(parentStock / currentUnitsPerPack);

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Packs y Variantes - {productName}
            </DialogTitle>
            <DialogDescription>
              Configura diferentes opciones de venta: packs de diferentes cantidades, tallas, colores, etc.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Stock Summary Card */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                  <Box className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-blue-900 dark:text-blue-100">Stock del Producto</h3>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-4 w-4 text-blue-500" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Este es el stock total de unidades fisicas. Las variantes calculan automaticamente cuantos packs se pueden vender basado en las unidades por pack.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="mt-1">
                    <span className="text-3xl font-bold text-blue-700 dark:text-blue-300">{parentStock}</span>
                    <span className="text-blue-600 dark:text-blue-400 ml-2">unidades fisicas</span>
                  </div>
                  {variants.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {variants.map(v => {
                        const units = v.units_per_pack || 1;
                        const packs = Math.floor(parentStock / units);
                        return (
                          <div key={v.id} className="text-sm bg-white dark:bg-gray-800 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-700">
                            <span className="font-medium">{v.variant_title}:</span>{' '}
                            <span className="text-blue-600 dark:text-blue-400">{packs} disponibles</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Add/Edit Form */}
            {showAddForm && (
              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <h4 className="font-medium flex items-center gap-2">
                  {editingVariant ? 'Editar variante' : 'Nueva variante'}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="variant_title" className="flex items-center gap-1">
                      Nombre del pack/variante *
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Ej: "Personal", "Pareja", "Familiar", "Talla M", "Color Azul"</p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <Input
                      id="variant_title"
                      value={formData.variant_title}
                      onChange={(e) => setFormData({ ...formData, variant_title: e.target.value })}
                      placeholder="Ej: Personal, Pareja, Oficina"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sku" className="flex items-center gap-1">
                      SKU
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Codigo unico para identificar esta variante. Si usas Shopify o un landing page, asegurate de que coincida con el SKU de alla.</p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <Input
                      id="sku"
                      value={formData.sku}
                      onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                      placeholder="Ej: NOCTE-GLASSES-PERSONAL"
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="units_per_pack" className="flex items-center gap-1">
                      Unidades por pack *
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Cuantas unidades fisicas contiene este pack. Si vendes "pack de 2", pon 2. Si es unitario, pon 1.</p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <Input
                      id="units_per_pack"
                      type="number"
                      min="1"
                      value={formData.units_per_pack}
                      onChange={(e) => setFormData({ ...formData, units_per_pack: e.target.value })}
                      placeholder="1"
                    />
                    <p className="text-xs text-muted-foreground">
                      Con {parentStock} unidades, podras vender {calculatedPacks} de este pack
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price">Precio de venta *</Label>
                    <Input
                      id="price"
                      type="number"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      placeholder="199000"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cost">Costo (opcional)</Label>
                    <Input
                      id="cost"
                      type="number"
                      value={formData.cost}
                      onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                      placeholder="0"
                    />
                    <p className="text-xs text-muted-foreground">Para calcular margen de ganancia</p>
                  </div>

                  {/* Visual preview */}
                  <div className="md:col-span-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                    <p className="text-sm text-green-800 dark:text-green-200">
                      <strong>Vista previa:</strong> Al vender 1 "{formData.variant_title || 'pack'}"
                      {currentUnitsPerPack > 1 ? ` se descontaran ${currentUnitsPerPack} unidades` : ' se descontara 1 unidad'} del stock.
                      {formData.price && ` Precio: ${formatPrice(parseFloat(formData.price))}`}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-2 border-t">
                  <Button variant="outline" onClick={resetForm}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSaveVariant} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingVariant ? 'Guardar cambios' : 'Crear variante'}
                  </Button>
                </div>
              </div>
            )}

            {/* Variants Table */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : variants.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No hay variantes configuradas</p>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  Crea variantes para vender el mismo producto en diferentes presentaciones:
                  packs de 1, 2, 3 unidades con diferentes precios, o variaciones de talla/color.
                </p>
                <Button onClick={() => setShowAddForm(true)} className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Crear primera variante
                </Button>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Variante</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          Uds/Pack
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Unidades que se descuentan por cada venta</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">Disponible</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variants.map((variant) => {
                      const unitsPerPack = variant.units_per_pack || 1;
                      const availablePacks = Math.floor(parentStock / unitsPerPack);

                      return (
                        <TableRow key={variant.id}>
                          <TableCell>
                            <span className="font-medium">{variant.variant_title}</span>
                          </TableCell>
                          <TableCell>
                            {variant.sku ? (
                              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{variant.sku}</code>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">Sin SKU</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="font-mono">
                              {unitsPerPack} {unitsPerPack === 1 ? 'ud' : 'uds'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatPrice(variant.price)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={availablePacks === 0 ? 'destructive' : availablePacks <= 10 ? 'secondary' : 'default'}
                              className="font-mono"
                            >
                              {availablePacks}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditVariant(variant)}
                                title="Editar"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteVariant(variant)}
                                title="Eliminar"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            {variants.length > 0 && !showAddForm && (
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Agregar variante
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

export default ProductVariantsManager;
