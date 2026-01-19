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
import { Plus, Pencil, Trash2, Package, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
}

interface ProductVariantsManagerProps {
  productId: string;
  productName: string;
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

  // Form state
  const [formData, setFormData] = useState({
    variant_title: '',
    sku: '',
    price: '',
    cost: '',
    stock: '0',
    option1_name: 'Cantidad',
    option1_value: ''
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
      const response = await fetch(`${API_BASE}/api/products/${productId}/variants`, {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Error al cargar variantes');
      }

      const data = await response.json();
      setVariants(data.variants || []);
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
      option1_value: ''
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
      option1_value: variant.option1_value || ''
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
        stock: parseInt(formData.stock, 10) || 0,
        option1_name: formData.option1_name || null,
        option1_value: formData.option1_value || null
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Variantes de {productName}
          </DialogTitle>
          <DialogDescription>
            Gestiona las variantes del producto (bundles, tallas, colores, etc.)
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Info Alert */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Las variantes permiten tener diferentes SKUs, precios y stock para un mismo producto.
              El stock se descuenta automáticamente cuando el SKU coincide con un pedido.
            </AlertDescription>
          </Alert>

          {/* Add/Edit Form */}
          {showAddForm && (
            <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
              <h4 className="font-medium">
                {editingVariant ? 'Editar variante' : 'Nueva variante'}
              </h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="variant_title">Nombre de la variante *</Label>
                  <Input
                    id="variant_title"
                    value={formData.variant_title}
                    onChange={(e) => setFormData({ ...formData, variant_title: e.target.value })}
                    placeholder="Ej: 1 unidad, 2 unidades, Talla M"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sku">SKU (para mapeo automático)</Label>
                  <Input
                    id="sku"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder="Ej: NOCTE-001, NOCTE-002"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="price">Precio *</Label>
                  <Input
                    id="price"
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cost">Costo</Label>
                  <Input
                    id="cost"
                    type="number"
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stock">Stock inicial</Label>
                  <Input
                    id="stock"
                    type="number"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="option1_value">Valor de opción</Label>
                  <Input
                    id="option1_value"
                    value={formData.option1_value}
                    onChange={(e) => setFormData({ ...formData, option1_value: e.target.value })}
                    placeholder="Ej: 1, 2, M, Rojo"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end">
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
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay variantes configuradas</p>
              <p className="text-sm">Agrega variantes para tener diferentes SKUs, precios y stock</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variante</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell className="font-medium">{variant.variant_title}</TableCell>
                    <TableCell>
                      {variant.sku ? (
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{variant.sku}</code>
                      ) : (
                        <span className="text-muted-foreground text-xs">Sin SKU</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatPrice(variant.price)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {variant.cost ? formatPrice(variant.cost) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={variant.stock === 0 ? 'destructive' : variant.stock <= 10 ? 'secondary' : 'default'}>
                        {variant.stock}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditVariant(variant)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteVariant(variant)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar variante
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProductVariantsManager;
