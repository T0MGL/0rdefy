import { useState, useEffect } from 'react';
import { Plus, Package, Truck, Calendar, Search, Filter, CheckCircle2, AlertCircle, Clock, PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import { merchandiseService } from '@/services/merchandise.service';
import { productsService } from '@/services/products.service';
import { suppliersService } from '@/services/suppliers.service';
import { getCurrencySymbol } from '@/utils/currency';
import type { InboundShipment, InboundShipmentItem, CreateShipmentDTO, CreateShipmentItemDTO, ReceiveShipmentItemDTO, Product } from '@/types';

export default function Merchandise() {
  const { toast } = useToast();
  const { hasFeature } = useSubscription();
  const [shipments, setShipments] = useState<InboundShipment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'partial' | 'received'>('all');

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  // Receive modal state
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [selectedShipment, setSelectedShipment] = useState<InboundShipment | null>(null);
  const [receiveLoading, setReceiveLoading] = useState(false);

  const hasMerchandiseFeature = hasFeature('merchandise');

  // Load initial data
  useEffect(() => {
    if (!hasMerchandiseFeature) return;
    loadData();
  }, [statusFilter, hasMerchandiseFeature]);

  // Plan-based feature check - merchandise requires Starter+ plan (AFTER all hooks)
  if (!hasMerchandiseFeature) {
    return <FeatureBlockedPage feature="merchandise" />;
  }

  const loadData = async () => {
    setLoading(true);
    try {
      // Use Promise.allSettled to handle partial failures gracefully
      const results = await Promise.allSettled([
        merchandiseService.getAll(statusFilter === 'all' ? {} : { status: statusFilter }),
        productsService.getAll('local'), // Only load local products (not from Shopify)
        suppliersService.getAll(),
      ]);

      const [shipmentsResult, productsResult, suppliersResult] = results;
      const errors: string[] = [];

      // Handle each result independently
      if (shipmentsResult.status === 'fulfilled') {
        setShipments(shipmentsResult.value);
      } else {
        errors.push('envíos');
        console.error('Error loading shipments:', shipmentsResult.reason);
      }

      if (productsResult.status === 'fulfilled') {
        setProducts(productsResult.value);
      } else {
        errors.push('productos');
        console.error('Error loading products:', productsResult.reason);
      }

      if (suppliersResult.status === 'fulfilled') {
        setSuppliers(suppliersResult.value);
      } else {
        errors.push('proveedores');
        console.error('Error loading suppliers:', suppliersResult.reason);
      }

      // Show error only if something failed
      if (errors.length > 0) {
        toast({
          title: 'Error parcial',
          description: `No se pudo cargar: ${errors.join(', ')}`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      // This catch is for unexpected errors in the settlement handling itself
      toast({
        title: 'Error',
        description: 'Error inesperado al cargar datos',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShipment = async (data: CreateShipmentDTO) => {
    setCreateLoading(true);
    try {
      await merchandiseService.create(data);
      toast({
        title: 'Éxito',
        description: 'Mercadería creada correctamente',
      });
      setShowCreateModal(false);
      loadData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create shipment',
        variant: 'destructive',
      });
    } finally {
      setCreateLoading(false);
    }
  };

  const handleReceiveShipment = async (shipmentId: string, items: ReceiveShipmentItemDTO[]) => {
    setReceiveLoading(true);
    try {
      const result = await merchandiseService.receive(shipmentId, { items });
      toast({
        title: 'Éxito',
        description: `Mercadería recibida: ${result.status === 'received' ? 'Completa' : 'Parcial'}`,
      });
      setShowReceiveModal(false);
      setSelectedShipment(null);
      loadData();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to receive shipment',
        variant: 'destructive',
      });
    } finally {
      setReceiveLoading(false);
    }
  };

  const openReceiveModal = async (shipmentId: string) => {
    try {
      const shipment = await merchandiseService.getById(shipmentId);
      if (shipment) {
        setSelectedShipment(shipment);
        setShowReceiveModal(true);
      } else {
        toast({
          title: 'Error',
          description: 'No se pudo cargar el envío',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Error loading shipment:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo cargar los detalles del envío',
        variant: 'destructive',
      });
    }
  };

  // Filter shipments
  const filteredShipments = shipments.filter(shipment => {
    const matchesSearch =
      shipment.internal_reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shipment.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shipment.tracking_code?.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesSearch;
  });

  // Status badge helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/20 dark:text-yellow-400 dark:border-yellow-900">
          <Clock className="h-3 w-3 mr-1" />
          Pendiente
        </Badge>;
      case 'partial':
        return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900">
          <AlertCircle className="h-3 w-3 mr-1" />
          Parcial
        </Badge>;
      case 'received':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-900">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Recibida
        </Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mercadería</h1>
          <p className="text-muted-foreground">Gestiona los envíos de tus proveedores</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Mercadería
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por referencia, proveedor o tracking..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="pending">Pendiente</SelectItem>
              <SelectItem value="partial">Parcial</SelectItem>
              <SelectItem value="received">Recibida</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Shipments List */}
      {loading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      ) : filteredShipments.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No hay mercadería</h3>
          <p className="text-muted-foreground mb-4">
            {searchTerm ? 'No se encontraron resultados' : 'Crea tu primer envío de mercadería'}
          </p>
          {!searchTerm && (
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva Mercadería
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredShipments.map((shipment) => (
            <Card key={shipment.id} className="p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-3">
                  {/* Header Row */}
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-lg">{shipment.internal_reference}</h3>
                    {getStatusBadge(shipment.status)}
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {shipment.supplier_name && (
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Proveedor:</span>
                        <span className="font-medium">{shipment.supplier_name}</span>
                      </div>
                    )}
                    {shipment.carrier_name && (
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Transportadora:</span>
                        <span className="font-medium">{shipment.carrier_name}</span>
                      </div>
                    )}
                    {shipment.estimated_arrival_date && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">ETA:</span>
                        <span className="font-medium">
                          {new Date(shipment.estimated_arrival_date).toLocaleDateString('es-ES')}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Productos:</span>
                      <span className="font-medium">{shipment.total_items || 0}</span>
                    </div>
                  </div>

                  {/* Summary */}
                  {shipment.status !== 'pending' && (
                    <div className="flex gap-6 text-sm">
                      <div>
                        <span className="text-muted-foreground">Ordenado: </span>
                        <span className="font-medium">{shipment.total_qty_ordered || 0}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Recibido: </span>
                        <span className="font-medium text-green-600 dark:text-green-400">
                          {shipment.total_qty_received || 0}
                        </span>
                      </div>
                      {(shipment.total_qty_rejected || 0) > 0 && (
                        <div>
                          <span className="text-muted-foreground">Rechazado: </span>
                          <span className="font-medium text-red-600 dark:text-red-400">
                            {shipment.total_qty_rejected}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  {(shipment.status === 'pending' || shipment.status === 'partial') && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => openReceiveModal(shipment.id)}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Recibir
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <CreateShipmentModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateShipment}
        products={products}
        suppliers={suppliers}
        loading={createLoading}
        onProductCreated={loadData}
      />

      {/* Receive Modal */}
      {selectedShipment && (
        <ReceiveShipmentModal
          open={showReceiveModal}
          onClose={() => {
            setShowReceiveModal(false);
            setSelectedShipment(null);
          }}
          shipment={selectedShipment}
          onSubmit={handleReceiveShipment}
          loading={receiveLoading}
        />
      )}
    </div>
  );
}

// ================================================================
// CREATE SHIPMENT MODAL
// ================================================================
interface CreateShipmentModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateShipmentDTO) => void;
  products: Product[];
  suppliers: Supplier[];
  loading: boolean;
  onProductCreated: () => void; // Callback to refresh products list
}

function CreateShipmentModal({ open, onClose, onSubmit, products, suppliers, loading, onProductCreated }: CreateShipmentModalProps) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [eta, setEta] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<CreateShipmentItemDTO[]>([{
    product_id: '',
    qty_ordered: 1,
    unit_cost: '',
  } as any]);

  // New product creation state
  const [creatingProductIndex, setCreatingProductIndex] = useState<number | null>(null);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductCost, setNewProductCost] = useState('');
  const [newProductImage, setNewProductImage] = useState('');
  const [createProductLoading, setCreateProductLoading] = useState(false);

  const handleAddItem = () => {
    setItems([...items, { product_id: '', qty_ordered: 1, unit_cost: '' } as any]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof CreateShipmentItemDTO, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const handleCreateProduct = async (itemIndex: number) => {
    // Validation
    if (!newProductName.trim()) {
      toast({
        title: 'Error',
        description: 'El nombre del producto es requerido',
        variant: 'destructive',
      });
      return;
    }

    setCreateProductLoading(true);
    try {
      const newProduct = await productsService.create({
        name: newProductName.trim(),
        price: parseFloat(newProductPrice) || 0,
        cost: parseFloat(newProductCost) || 0,
        stock: 0, // Initial stock is 0, will be updated on reception
        image: newProductImage.trim() || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30',
        profitability: 0,
        sales: 0,
      });

      toast({
        title: 'Éxito',
        description: `Producto "${newProductName}" creado correctamente`,
      });

      // Auto-select the new product in this item row
      handleItemChange(itemIndex, 'product_id', newProduct.id);

      // Auto-fill the cost from the product
      handleItemChange(itemIndex, 'unit_cost', newProduct.cost);

      // Clear form and close
      setNewProductName('');
      setNewProductPrice('');
      setNewProductCost('');
      setNewProductImage('');
      setCreatingProductIndex(null);

      // Refresh products list
      onProductCreated();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Error al crear el producto',
        variant: 'destructive',
      });
    } finally {
      setCreateProductLoading(false);
    }
  };

  const handleCancelCreateProduct = () => {
    setNewProductName('');
    setNewProductPrice('');
    setNewProductCost('');
    setNewProductImage('');
    setCreatingProductIndex(null);
  };

  const generateTrackingCode = () => {
    // Generate tracking code in format: TRACK-YYYYMMDD-XXXX
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const trackingCode = `TRACK-${dateStr}-${random}`;
    setTrackingCode(trackingCode);
  };

  const handleSubmit = () => {
    // Validation
    const validItems = items
      .filter(item => {
        const cost = typeof item.unit_cost === 'string' ? parseFloat(item.unit_cost) : item.unit_cost;
        return item.product_id && item.qty_ordered > 0 && !isNaN(cost) && cost >= 0;
      })
      .map(item => ({
        product_id: item.product_id,
        qty_ordered: item.qty_ordered,
        unit_cost: typeof item.unit_cost === 'string' ? parseFloat(item.unit_cost) : item.unit_cost,
      }));

    if (validItems.length === 0) {
      toast({
        title: 'Error',
        description: 'Debes agregar al menos un producto válido con cantidad y costo',
        variant: 'destructive',
      });
      return;
    }

    onSubmit({
      supplier_id: supplierId || undefined,
      carrier_id: carrierId || undefined,
      tracking_code: trackingCode || undefined,
      estimated_arrival_date: eta || undefined,
      shipping_cost: 0, // No longer needed - cost is in unit_cost
      notes: notes || undefined,
      items: validItems,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Mercadería</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Header Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Proveedor (Opcional)</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin proveedor (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(supplier => (
                    <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Fecha Estimada de Llegada</Label>
              <Input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Código de Seguimiento</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="TRACK-20251128-XXXX"
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={generateTrackingCode}
                  title="Generar código automático"
                >
                  Generar
                </Button>
              </div>
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base">Productos</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleAddItem}>
                <Plus className="h-4 w-4 mr-2" />
                Agregar Producto
              </Button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={index} className="space-y-3">
                  <div className="flex gap-3 items-end">
                    <div className="flex-1 space-y-2">
                      <Label>Producto</Label>
                      <div className="flex gap-2">
                        <Select
                          value={item.product_id}
                          onValueChange={(value) => handleItemChange(index, 'product_id', value)}
                          disabled={creatingProductIndex === index}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Selecciona un producto" />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map(product => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setCreatingProductIndex(index)}
                          disabled={creatingProductIndex !== null}
                          title="Crear nuevo producto"
                        >
                          <PackagePlus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="w-32 space-y-2">
                      <Label>Cantidad</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.qty_ordered}
                        onChange={(e) => handleItemChange(index, 'qty_ordered', parseInt(e.target.value) || 0)}
                      />
                    </div>

                    <div className="w-40 space-y-2">
                      <Label>Costo Total Unit. ({getCurrencySymbol()})</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={item.unit_cost}
                        onChange={(e) => handleItemChange(index, 'unit_cost', e.target.value)}
                      />
                    </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveItem(index)}
                    disabled={items.length === 1}
                  >
                    ×
                  </Button>
                </div>

                {/* Inline Create Product Form */}
                {creatingProductIndex === index && (
                  <Card className="p-4 border-2 border-primary/20 bg-primary/5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium flex items-center gap-2">
                          <PackagePlus className="h-4 w-4" />
                          Crear Nuevo Producto
                        </h4>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelCreateProduct}
                        >
                          Cancelar
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Nombre del Producto *</Label>
                          <Input
                            placeholder="Ej: Laptop Dell XPS 15"
                            value={newProductName}
                            onChange={(e) => setNewProductName(e.target.value)}
                            autoFocus
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Precio de Venta ({getCurrencySymbol()})</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0"
                            value={newProductPrice}
                            onChange={(e) => setNewProductPrice(e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Costo Total Unit. ({getCurrencySymbol()}) *</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Incluye producto + envío"
                            value={newProductCost}
                            onChange={(e) => setNewProductCost(e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>URL de Imagen (Opcional)</Label>
                          <Input
                            placeholder="https://..."
                            value={newProductImage}
                            onChange={(e) => setNewProductImage(e.target.value)}
                          />
                        </div>
                      </div>

                      <Button
                        type="button"
                        onClick={() => handleCreateProduct(index)}
                        disabled={createProductLoading}
                        className="w-full"
                      >
                        {createProductLoading ? 'Creando...' : 'Crear y Seleccionar Producto'}
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notas (Opcional)</Label>
            <Textarea
              placeholder="Notas adicionales..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creando...' : 'Crear Mercadería'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================
// RECEIVE SHIPMENT MODAL
// ================================================================
interface ReceiveShipmentModalProps {
  open: boolean;
  onClose: () => void;
  shipment: InboundShipment;
  onSubmit: (shipmentId: string, items: ReceiveShipmentItemDTO[]) => void;
  loading: boolean;
}

function ReceiveShipmentModal({ open, onClose, shipment, onSubmit, loading }: ReceiveShipmentModalProps) {
  const [receivedData, setReceivedData] = useState<Record<string, {
    qty_received: number;
    qty_rejected: number;
    discrepancy_notes: string;
  }>>({});

  // Initialize received data when shipment changes
  useEffect(() => {
    if (shipment.items) {
      const initial: typeof receivedData = {};
      shipment.items.forEach(item => {
        initial[item.id] = {
          qty_received: item.qty_ordered - (item.qty_received || 0), // Remaining to receive
          qty_rejected: 0,
          discrepancy_notes: '',
        };
      });
      setReceivedData(initial);
    }
  }, [shipment]);

  const handleItemChange = (itemId: string, field: 'qty_received' | 'qty_rejected' | 'discrepancy_notes', value: any) => {
    setReceivedData(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value,
      },
    }));
  };

  const handleSubmit = () => {
    const items: ReceiveShipmentItemDTO[] = Object.entries(receivedData).map(([itemId, data]) => ({
      item_id: itemId,
      qty_received: data.qty_received,
      qty_rejected: data.qty_rejected,
      discrepancy_notes: data.discrepancy_notes || undefined,
    }));

    onSubmit(shipment.id, items);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recibir Mercadería - {shipment.internal_reference}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Ingresa las cantidades realmente recibidas. Si hay discrepancias, agrega una descripción.
          </p>

          <div className="space-y-4">
            {shipment.items?.map((item) => {
              const remaining = item.qty_ordered - (item.qty_received || 0);
              const data = receivedData[item.id] || { qty_received: remaining, qty_rejected: 0, discrepancy_notes: '' };
              const hasDiscrepancy = data.qty_received + data.qty_rejected < remaining;

              return (
                <Card key={item.id} className="p-4">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{item.product_name}</h4>
                        <p className="text-sm text-muted-foreground">
                          Ordenado: {item.qty_ordered} | Ya recibido: {item.qty_received || 0} | Restante: {remaining}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">Costo: ${item.unit_cost.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Cantidad Aceptada</Label>
                        <Input
                          type="number"
                          min="0"
                          max={remaining}
                          value={data.qty_received}
                          onChange={(e) => handleItemChange(item.id, 'qty_received', parseInt(e.target.value) || 0)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Cantidad Rechazada</Label>
                        <Input
                          type="number"
                          min="0"
                          max={remaining - data.qty_received}
                          value={data.qty_rejected}
                          onChange={(e) => handleItemChange(item.id, 'qty_rejected', parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    {hasDiscrepancy && (
                      <div className="space-y-2">
                        <Label className="text-orange-600 dark:text-orange-400">
                          Motivo de Discrepancia (Requerido)
                        </Label>
                        <Textarea
                          placeholder="Ej: Productos dañados en tránsito, faltantes, etc..."
                          value={data.discrepancy_notes}
                          onChange={(e) => handleItemChange(item.id, 'discrepancy_notes', e.target.value)}
                          rows={2}
                          className="border-orange-200 dark:border-orange-900"
                        />
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Procesando...' : 'Confirmar Recepción'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
