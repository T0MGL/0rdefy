import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ExportButton } from '@/components/ExportButton';
import { adsService } from '@/services/ads.service';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { Ad } from '@/types';
import { Plus, TrendingUp, Edit, Trash2 } from 'lucide-react';
import { campaignsExportColumns } from '@/utils/exportConfigs';

const statusColors = {
  active: 'bg-primary/20 text-primary border-primary/30',
  paused: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30',
  ended: 'bg-red-500/20 text-red-700 border-red-500/30',
};

const statusLabels = {
  active: 'Activo',
  paused: 'Pausado',
  ended: 'Finalizado',
};

// Form Component
function AdForm({ ad, onSubmit, onCancel }: { ad?: Ad; onSubmit: (data: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    platform: ad?.platform || 'Facebook',
    campaign_name: ad?.campaign_name || '',
    investment: ad?.investment || 0,
    clicks: ad?.clicks || 0,
    conversions: ad?.conversions || 0,
    roas: ad?.roas || 0,
    status: ad?.status || 'active',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      platform: formData.platform,
      campaign_name: formData.campaign_name,
      investment: formData.investment,
      clicks: formData.clicks,
      conversions: formData.conversions,
      roas: formData.roas,
      status: formData.status,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Plataforma *</label>
          <Select value={formData.platform} onValueChange={(val) => setFormData({ ...formData, platform: val })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Facebook">Facebook</SelectItem>
              <SelectItem value="Instagram">Instagram</SelectItem>
              <SelectItem value="TikTok">TikTok</SelectItem>
              <SelectItem value="Google Ads">Google Ads</SelectItem>
              <SelectItem value="YouTube">YouTube</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Estado *</label>
          <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="paused">Pausado</SelectItem>
              <SelectItem value="ended">Finalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Nombre de Campaña *</label>
        <Input
          placeholder="Ej: Black Friday 2024"
          value={formData.campaign_name}
          onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Inversión (Gs.) *</label>
        <Input
          type="number"
          placeholder="0"
          value={formData.investment}
          onChange={(e) => setFormData({ ...formData, investment: parseFloat(e.target.value) })}
          required
          min="0"
          step="0.01"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Clicks</label>
          <Input
            type="number"
            placeholder="0"
            value={formData.clicks}
            onChange={(e) => setFormData({ ...formData, clicks: parseInt(e.target.value) })}
            min="0"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Conversiones</label>
          <Input
            type="number"
            placeholder="0"
            value={formData.conversions}
            onChange={(e) => setFormData({ ...formData, conversions: parseInt(e.target.value) })}
            min="0"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">ROAS</label>
          <Input
            type="number"
            placeholder="0"
            value={formData.roas}
            onChange={(e) => setFormData({ ...formData, roas: parseFloat(e.target.value) })}
            min="0"
            step="0.01"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90">
          {ad ? 'Actualizar' : 'Crear'}
        </Button>
      </div>
    </form>
  );
}

export default function Ads() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [adToDelete, setAdToDelete] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadAds();
  }, []);

  const loadAds = async () => {
    const data = await adsService.getAll();
    setAds(data);
    setIsLoading(false);
  };

  const handleCreate = () => {
    setSelectedAd(null);
    setDialogOpen(true);
  };

  const handleEdit = (ad: Ad) => {
    setSelectedAd(ad);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setAdToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!adToDelete) return;

    try {
      await adsService.delete(adToDelete);
      await loadAds();
      toast({
        title: 'Anuncio eliminado',
        description: 'El anuncio ha sido eliminado exitosamente.',
      });
    } catch (error: any) {
      toast({
        title: 'Error al eliminar',
        description: error.message || 'No se pudo eliminar el anuncio.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (data: any) => {
    try {
      if (selectedAd) {
        await adsService.update(selectedAd.id, data);
        toast({
          title: 'Anuncio actualizado',
          description: 'Los cambios han sido guardados exitosamente.',
        });
      } else {
        await adsService.create(data);
        toast({
          title: 'Anuncio creado',
          description: 'El anuncio ha sido registrado exitosamente.',
        });
      }
      await loadAds();
      setDialogOpen(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Ocurrió un error al guardar el anuncio.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <div className="space-y-6"><div className="text-center py-8">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Anuncios</h2>
          <p className="text-muted-foreground">Gestiona tus campañas publicitarias</p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={ads}
            filename="campanas-publicitarias"
            columns={campaignsExportColumns}
            title="Campañas Publicitarias - Ordefy"
            variant="outline"
          />
          <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={handleCreate}>
            <Plus size={18} />
            Registrar Anuncio
          </Button>
        </div>
      </div>

      {/* Ads Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Plataforma
                </th>
                <th className="text-left py-4 px-6 text-sm font-medium text-muted-foreground">
                  Campaña
                </th>
                <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">
                  Inversión
                </th>
                <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">
                  Clicks
                </th>
                <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">
                  Conversiones
                </th>
                <th className="text-right py-4 px-6 text-sm font-medium text-muted-foreground">
                  ROAS
                </th>
                <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                  Estado
                </th>
                <th className="text-center py-4 px-6 text-sm font-medium text-muted-foreground">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {ads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    No hay anuncios registrados. Haz clic en "Registrar Anuncio" para comenzar.
                  </td>
                </tr>
              ) : (
                ads.map((ad) => (
                  <tr key={ad.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                    <td className="py-4 px-6 text-sm font-medium">{ad.platform}</td>
                    <td className="py-4 px-6 text-sm">{ad.campaign_name}</td>
                    <td className="py-4 px-6 text-right text-sm">
                      Gs. {ad.investment.toLocaleString()}
                    </td>
                    <td className="py-4 px-6 text-right text-sm">{ad.clicks.toLocaleString()}</td>
                    <td className="py-4 px-6 text-right text-sm">{ad.conversions}</td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <TrendingUp className="text-primary" size={16} />
                        <span className="text-sm font-semibold text-primary">{ad.roas}x</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <Badge variant="outline" className={statusColors[ad.status]}>
                        {statusLabels[ad.status]}
                      </Badge>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(ad)}
                        >
                          <Edit size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(ad.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedAd ? 'Editar Anuncio' : 'Registrar Nuevo Anuncio'}
            </DialogTitle>
          </DialogHeader>
          <AdForm
            ad={selectedAd || undefined}
            onSubmit={handleSubmit}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="¿Eliminar anuncio?"
        description="Esta acción no se puede deshacer. El anuncio será eliminado permanentemente."
        onConfirm={confirmDelete}
        variant="destructive"
        confirmText="Eliminar"
      />
    </div>
  );
}
