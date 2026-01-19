import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateRecommendations } from '@/utils/recommendationEngine';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  DollarSign,
  Package,
  Truck,
  Lightbulb,
  ArrowRight
} from 'lucide-react';
import { Recommendation, Product, Ad, DashboardOverview } from '@/types';
import type { Carrier } from '@/services/carriers.service';
import { productsService } from '@/services/products.service';
import { adsService } from '@/services/ads.service';
import { carriersService } from '@/services/carriers.service';
import { analyticsService } from '@/services/analytics.service';

const typeConfig = {
  pricing: { icon: DollarSign, color: 'text-green-600', label: 'Precios' },
  inventory: { icon: Package, color: 'text-blue-600', label: 'Inventario' },
  gasto_publicitario: { icon: TrendingUp, color: 'text-purple-600', label: 'Gasto Publicitario' },
  carrier: { icon: Truck, color: 'text-orange-600', label: 'Logística' },
};

export function RecommendedActions() {
  const navigate = useNavigate();
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [productsData, adsData, carriersData, overviewData] = await Promise.all([
          productsService.getAll(),
          adsService.getAll(),
          carriersService.getAll(),
          analyticsService.getOverview(),
        ]);
        setProducts(productsData);
        setAds(adsData);
        setCarriers(carriersData);
        setOverview(overviewData);
      } catch (error) {
        logger.error('Error loading recommendation data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const recommendations = overview
    ? generateRecommendations({ products, ads, overview, carriers })
    : [];
  
  const handleApply = (rec: Recommendation) => {
    if (rec.actionUrl) {
      navigate(rec.actionUrl);
      setSelectedRec(null);
    }
  };
  
  if (isLoading) {
    return (
      <Card className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="text-primary" size={24} />
          <h3 className="text-lg font-semibold">Acciones Recomendadas</h3>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 bg-card rounded-lg border">
              <div className="h-16 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="text-primary" size={24} />
          <h3 className="text-lg font-semibold">Acciones Recomendadas</h3>
        </div>

        <div className="space-y-3">
          {recommendations.map((rec) => {
            const config = typeConfig[rec.type];
            const Icon = config.icon;
            
            return (
              <div
                key={rec.id}
                className="p-4 bg-card rounded-lg border cursor-pointer hover:shadow-md transition-all"
                onClick={() => setSelectedRec(rec)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    <Icon className={config.color} size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-sm">{rec.title}</h4>
                      <Badge variant="outline" className="text-xs">
                        {config.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {rec.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-primary">
                        {rec.impact}
                      </span>
                      <ArrowRight size={16} className="text-muted-foreground" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      
      <Dialog open={!!selectedRec} onOpenChange={(open) => !open && setSelectedRec(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedRec?.title}</DialogTitle>
            <DialogDescription>
              {selectedRec?.description}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-primary/10 rounded-lg">
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Impacto Estimado
              </p>
              <p className="text-xl font-bold text-primary">
                {selectedRec?.impact}
              </p>
            </div>
            
            <Button
              className="w-full gap-2"
              onClick={() => selectedRec && handleApply(selectedRec)}
            >
              {selectedRec?.actionLabel}
              <ArrowRight size={16} />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
