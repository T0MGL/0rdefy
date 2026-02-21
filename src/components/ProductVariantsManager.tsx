import { useState, useEffect, useCallback } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, Package, Loader2, Box, HelpCircle, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { VariantType, isBundle } from '@/types';

interface Variant {
  id: string;
  product_id: string;
  sku: string | null;
  variant_title: string;
  variant_type?: VariantType;
  option1_name?: string | null;
  option1_value?: string | null;
  option2_name?: string | null;
  option2_value?: string | null;
  option3_name?: string | null;
  option3_value?: string | null;
  price: number;
  cost: number | null;
  stock: number;
  is_active: boolean;
  position: number;
  uses_shared_stock?: boolean;
  units_per_pack?: number;
  available_packs?: number;
  available_stock?: number;
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
  const [bundles, setBundles] = useState<Variant[]>([]);
  const [variations, setVariations] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [parentStock, setParentStock] = useState(productStock);
  const [activeTab, setActiveTab] = useState<'bundles' | 'variations'>('bundles');

  // Bundle form state
  const [bundleForm, setBundleForm] = useState({
    variant_title: '',
    sku: '',
    price: '',
    cost: '',
    units_per_pack: '1'
  });

  // Variation form state
  const [variationForm, setVariationForm] = useState({
    variant_title: '',
    sku: '',
    price: '',
    cost: '',
    stock: '0',
    option1_name: '',
    option1_value: ''
  });

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/products/${productId}/variants`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Error al cargar variantes');
      }

      const data = await response.json();
      setBundles(data.bundles || []);
      setVariations(data.variations || []);
      setParentStock(data.parent_stock || 0);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Error al cargar variantes',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [productId, toast]);

  // Fetch variants when dialog opens
  useEffect(() => {
    if (open && productId) {
      fetchVariants();
    }
  }, [open, productId, fetchVariants]);

  const resetBundleForm = () => {
    setBundleForm({
      variant_title: '',
      sku: '',
      price: '',
      cost: '',
      units_per_pack: '1'
    });
    setEditingVariant(null);
    setShowAddForm(false);
  };

  const resetVariationForm = () => {
    setVariationForm({
      variant_title: '',
      sku: '',
      price: '',
      cost: '',
      stock: '0',
      option1_name: '',
      option1_value: ''
    });
    setEditingVariant(null);
    setShowAddForm(false);
  };

  const handleEditBundle = (variant: Variant) => {
    setBundleForm({
      variant_title: variant.variant_title,
      sku: variant.sku || '',
      price: variant.price.toString(),
      cost: variant.cost?.toString() || '',
      units_per_pack: (variant.units_per_pack || 1).toString()
    });
    setEditingVariant(variant);
    setShowAddForm(true);
    setActiveTab('bundles');
  };

  const handleEditVariation = (variant: Variant) => {
    setVariationForm({
      variant_title: variant.variant_title,
      sku: variant.sku || '',
      price: variant.price.toString(),
      cost: variant.cost?.toString() || '',
      stock: variant.stock.toString(),
      option1_name: variant.option1_name || '',
      option1_value: variant.option1_value || ''
    });
    setEditingVariant(variant);
    setShowAddForm(true);
    setActiveTab('variations');
  };

  const handleSaveBundle = async () => {
    if (!bundleForm.variant_title || !bundleForm.price) {
      toast({
        title: 'Error',
        description: 'Nombre del pack y precio son requeridos',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        variant_title: bundleForm.variant_title,
        sku: bundleForm.sku || null,
        price: parseFloat(bundleForm.price),
        cost: bundleForm.cost ? parseFloat(bundleForm.cost) : null,
        units_per_pack: parseInt(bundleForm.units_per_pack, 10) || 1,
        image_url: productImageUrl
      };

      let response;
      if (editingVariant) {
        // Update existing - use generic endpoint with variant_type
        response = await fetch(`${API_BASE}/api/products/${productId}/variants/${editingVariant.id}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ ...payload, variant_type: 'bundle', uses_shared_stock: true, stock: 0 })
        });
      } else {
        // Create new bundle
        response = await fetch(`${API_BASE}/api/products/${productId}/bundles`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload)
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al guardar pack');
      }

      toast({
        title: editingVariant ? 'Pack actualizado' : 'Pack creado',
        description: `El pack "${bundleForm.variant_title}" se ha guardado correctamente`
      });

      resetBundleForm();
      fetchVariants();
      onVariantsUpdated?.();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Error al guardar pack',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveVariation = async () => {
    if (!variationForm.variant_title || !variationForm.price) {
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
        variant_title: variationForm.variant_title,
        sku: variationForm.sku || null,
        price: parseFloat(variationForm.price),
        cost: variationForm.cost ? parseFloat(variationForm.cost) : null,
        stock: parseInt(variationForm.stock, 10) || 0,
        option1_name: variationForm.option1_name || null,
        option1_value: variationForm.option1_value || null,
        image_url: productImageUrl
      };

      let response;
      if (editingVariant) {
        // Update existing
        response = await fetch(`${API_BASE}/api/products/${productId}/variants/${editingVariant.id}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ ...payload, variant_type: 'variation', uses_shared_stock: false, units_per_pack: 1 })
        });
      } else {
        // Create new variation
        response = await fetch(`${API_BASE}/api/products/${productId}/variations`, {
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
        description: `La variante "${variationForm.variant_title}" se ha guardado correctamente`
      });

      resetVariationForm();
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
    const typeLabel = variant.variant_type === 'bundle' ? 'pack' : 'variante';
    if (!confirm(`Eliminar ${typeLabel} "${variant.variant_title}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/products/${productId}/variants/${variant.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Error al eliminar');
      }

      toast({
        title: `${variant.variant_type === 'bundle' ? 'Pack' : 'Variante'} eliminado`,
        description: `"${variant.variant_title}" se ha eliminado`
      });

      fetchVariants();
      onVariantsUpdated?.();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Error al eliminar',
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

  const currentUnitsPerPack = parseInt(bundleForm.units_per_pack, 10) || 1;
  const calculatedPacks = Math.floor(parentStock / currentUnitsPerPack);

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Gestionar Producto - {productName}
            </DialogTitle>
            <DialogDescription>
              Configura packs (cantidades con descuento) y variantes (tallas, colores) para este producto.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as typeof activeTab); setShowAddForm(false); }} className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="bundles" className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Packs ({bundles.length})
              </TabsTrigger>
              <TabsTrigger value="variations" className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Variantes ({variations.length})
              </TabsTrigger>
            </TabsList>

            {/* BUNDLES TAB */}
            <TabsContent value="bundles" className="flex-1 overflow-y-auto space-y-4 mt-4">
              {/* Stock Summary Card for Bundles */}
              <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/30 dark:to-indigo-950/30 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
                    <Box className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-purple-900 dark:text-purple-100">Stock Compartido</h3>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-4 w-4 text-purple-500" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Los packs comparten el stock del producto padre. Al vender un pack de 2, se descuentan 2 unidades del stock total.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="mt-1">
                      <span className="text-3xl font-bold text-purple-700 dark:text-purple-300">{parentStock}</span>
                      <span className="text-purple-600 dark:text-purple-400 ml-2">unidades fisicas</span>
                    </div>
                    {bundles.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {bundles.map(b => {
                          const packs = b.available_packs ?? Math.floor(parentStock / (b.units_per_pack || 1));
                          return (
                            <div key={b.id} className="text-sm bg-white dark:bg-gray-800 px-3 py-1 rounded-full border border-purple-200 dark:border-purple-700">
                              <span className="font-medium">{b.variant_title}:</span>{' '}
                              <span className="text-purple-600 dark:text-purple-400">{packs} packs</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bundle Add/Edit Form */}
              {showAddForm && activeTab === 'bundles' && (
                <div className="border rounded-lg p-4 space-y-4 bg-purple-50/50 dark:bg-purple-950/20">
                  <h4 className="font-medium flex items-center gap-2">
                    <Package className="h-4 w-4 text-purple-600" />
                    {editingVariant ? 'Editar pack' : 'Nuevo pack'}
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bundle_title" className="flex items-center gap-1">
                        Nombre del pack *
                        <Tooltip>
                          <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent><p>Ej: "Personal", "Pareja", "Familiar", "Oficina"</p></TooltipContent>
                        </Tooltip>
                      </Label>
                      <Input
                        id="bundle_title"
                        value={bundleForm.variant_title}
                        onChange={(e) => setBundleForm({ ...bundleForm, variant_title: e.target.value })}
                        placeholder="Ej: Pareja"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bundle_units" className="flex items-center gap-1">
                        Unidades por pack *
                        <Tooltip>
                          <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent><p>Cuantas unidades fisicas contiene este pack</p></TooltipContent>
                        </Tooltip>
                      </Label>
                      <Input
                        id="bundle_units"
                        type="number"
                        min="1"
                        value={bundleForm.units_per_pack}
                        onChange={(e) => setBundleForm({ ...bundleForm, units_per_pack: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Disponibles: {calculatedPacks} packs
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bundle_sku">SKU (opcional)</Label>
                      <Input
                        id="bundle_sku"
                        value={bundleForm.sku}
                        onChange={(e) => setBundleForm({ ...bundleForm, sku: e.target.value.toUpperCase() })}
                        placeholder="Ej: NOCTE-PAREJA"
                        className="font-mono text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bundle_price">Precio de venta *</Label>
                      <Input
                        id="bundle_price"
                        type="number"
                        value={bundleForm.price}
                        onChange={(e) => setBundleForm({ ...bundleForm, price: e.target.value })}
                        placeholder="350000"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bundle_cost">Costo (opcional)</Label>
                      <Input
                        id="bundle_cost"
                        type="number"
                        value={bundleForm.cost}
                        onChange={(e) => setBundleForm({ ...bundleForm, cost: e.target.value })}
                      />
                    </div>

                    <div className="md:col-span-2 p-3 rounded-lg bg-purple-100 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700">
                      <p className="text-sm text-purple-800 dark:text-purple-200">
                        <strong>Vista previa:</strong> Pack "{bundleForm.variant_title || '...'}" con {currentUnitsPerPack} unidad{currentUnitsPerPack > 1 ? 'es' : ''}.
                        {bundleForm.price && ` Precio: ${formatPrice(parseFloat(bundleForm.price))}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-2 border-t">
                    <Button variant="outline" onClick={resetBundleForm}>Cancelar</Button>
                    <Button onClick={handleSaveBundle} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {editingVariant ? 'Guardar cambios' : 'Crear pack'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Bundles Table */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : bundles.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-50 text-purple-400" />
                  <p className="text-lg font-medium">No hay packs configurados</p>
                  <p className="text-sm mt-1 max-w-md mx-auto">
                    Los packs son cantidades del mismo producto (1x, 2x, 3x) con precios diferenciados. Comparten el stock del producto padre.
                  </p>
                  <Button onClick={() => setShowAddForm(true)} className="mt-4 bg-purple-600 hover:bg-purple-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primer pack
                  </Button>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-purple-50 dark:bg-purple-950/30">
                        <TableHead>Pack</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-center">Unidades</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead className="text-right">Disponible</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bundles.map((bundle) => {
                        const packs = bundle.available_packs ?? Math.floor(parentStock / (bundle.units_per_pack || 1));
                        return (
                          <TableRow key={bundle.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                                  <Package className="h-3 w-3 mr-1" />
                                  PACK
                                </Badge>
                                <span className="font-medium">{bundle.variant_title}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {bundle.sku ? (
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{bundle.sku}</code>
                              ) : (
                                <span className="text-muted-foreground text-xs italic">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary" className="font-mono">
                                {bundle.units_per_pack || 1}x
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatPrice(bundle.price)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={packs === 0 ? 'destructive' : packs <= 10 ? 'secondary' : 'default'}>
                                {packs} packs
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleEditBundle(bundle)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteVariant(bundle)}>
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

              {bundles.length > 0 && !showAddForm && (
                <div className="flex justify-end">
                  <Button onClick={() => setShowAddForm(true)} className="bg-purple-600 hover:bg-purple-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar pack
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* VARIATIONS TAB */}
            <TabsContent value="variations" className="flex-1 overflow-y-auto space-y-4 mt-4">
              {/* Variation Info Card */}
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg">
                    <Tag className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">Stock Independiente</h3>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="h-4 w-4 text-emerald-500" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Cada variante tiene su propio inventario. Ideal para tallas, colores, o materiales diferentes.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                      Las variantes son versiones diferentes del producto con stock separado.
                    </p>
                    {variations.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {variations.map(v => (
                          <div key={v.id} className="text-sm bg-white dark:bg-gray-800 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-700">
                            <span className="font-medium">{v.variant_title}:</span>{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">{v.stock} uds</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Variation Add/Edit Form */}
              {showAddForm && activeTab === 'variations' && (
                <div className="border rounded-lg p-4 space-y-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <h4 className="font-medium flex items-center gap-2">
                    <Tag className="h-4 w-4 text-emerald-600" />
                    {editingVariant ? 'Editar variante' : 'Nueva variante'}
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="var_title" className="flex items-center gap-1">
                        Nombre de variante *
                        <Tooltip>
                          <TooltipTrigger><HelpCircle className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent><p>Ej: "Talla M", "Color Azul", "Material Acero"</p></TooltipContent>
                        </Tooltip>
                      </Label>
                      <Input
                        id="var_title"
                        value={variationForm.variant_title}
                        onChange={(e) => setVariationForm({ ...variationForm, variant_title: e.target.value })}
                        placeholder="Ej: Talla M"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="var_stock">Stock *</Label>
                      <Input
                        id="var_stock"
                        type="number"
                        min="0"
                        value={variationForm.stock}
                        onChange={(e) => setVariationForm({ ...variationForm, stock: e.target.value })}
                        placeholder="0"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="var_option_name">Atributo (opcional)</Label>
                      <Input
                        id="var_option_name"
                        value={variationForm.option1_name}
                        onChange={(e) => setVariationForm({ ...variationForm, option1_name: e.target.value })}
                        placeholder="Ej: Talla, Color"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="var_option_value">Valor del atributo</Label>
                      <Input
                        id="var_option_value"
                        value={variationForm.option1_value}
                        onChange={(e) => setVariationForm({ ...variationForm, option1_value: e.target.value })}
                        placeholder="Ej: M, Azul"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="var_sku">SKU (opcional)</Label>
                      <Input
                        id="var_sku"
                        value={variationForm.sku}
                        onChange={(e) => setVariationForm({ ...variationForm, sku: e.target.value.toUpperCase() })}
                        placeholder="Ej: SHIRT-M-BLUE"
                        className="font-mono text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="var_price">Precio de venta *</Label>
                      <Input
                        id="var_price"
                        type="number"
                        value={variationForm.price}
                        onChange={(e) => setVariationForm({ ...variationForm, price: e.target.value })}
                        placeholder="99000"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="var_cost">Costo (opcional)</Label>
                      <Input
                        id="var_cost"
                        type="number"
                        value={variationForm.cost}
                        onChange={(e) => setVariationForm({ ...variationForm, cost: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-2 border-t">
                    <Button variant="outline" onClick={resetVariationForm}>Cancelar</Button>
                    <Button onClick={handleSaveVariation} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {editingVariant ? 'Guardar cambios' : 'Crear variante'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Variations Table */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : variations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                  <Tag className="h-12 w-12 mx-auto mb-4 opacity-50 text-emerald-400" />
                  <p className="text-lg font-medium">No hay variantes configuradas</p>
                  <p className="text-sm mt-1 max-w-md mx-auto">
                    Las variantes son versiones del producto con stock independiente: tallas, colores, materiales, etc.
                  </p>
                  <Button onClick={() => setShowAddForm(true)} className="mt-4 bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Crear primera variante
                  </Button>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-emerald-50 dark:bg-emerald-950/30">
                        <TableHead>Variante</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Atributo</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {variations.map((variation) => (
                        <TableRow key={variation.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-300">
                                <Tag className="h-3 w-3 mr-1" />
                                VAR
                              </Badge>
                              <span className="font-medium">{variation.variant_title}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {variation.sku ? (
                              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{variation.sku}</code>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {variation.option1_name && variation.option1_value ? (
                              <span className="text-sm">{variation.option1_name}: {variation.option1_value}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatPrice(variation.price)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={variation.stock === 0 ? 'destructive' : variation.stock <= 10 ? 'secondary' : 'default'}>
                              {variation.stock} uds
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleEditVariation(variation)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteVariant(variation)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {variations.length > 0 && !showAddForm && (
                <div className="flex justify-end">
                  <Button onClick={() => setShowAddForm(true)} className="bg-emerald-600 hover:bg-emerald-700">
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar variante
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

export default ProductVariantsManager;
