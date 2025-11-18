import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { calculateBusinessHealth } from '@/utils/healthCalculator';
import { AlertCircle, CheckCircle, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { analyticsService } from '@/services/analytics.service';
import { productsService } from '@/services/products.service';
import type { DashboardOverview, Product } from '@/types';

export function BusinessHealth() {
  const [expanded, setExpanded] = useState(false);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [overviewData, productsData] = await Promise.all([
          analyticsService.getOverview(),
          productsService.getAll(),
        ]);
        setOverview(overviewData);
        setProducts(productsData);
      } catch (error) {
        console.error('Error loading business health data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  if (isLoading || !overview) {
    return (
      <Card className="p-6 bg-gradient-to-br from-card to-muted/20">
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 rounded-full bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-6 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-32 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </Card>
    );
  }

  const health = calculateBusinessHealth(overview, products);

  const statusConfig = {
    excellent: {
      color: 'text-primary',
      bgColor: 'bg-primary',
      label: 'Excelente',
      icon: CheckCircle,
    },
    good: {
      color: 'text-green-600',
      bgColor: 'bg-green-600',
      label: 'Bueno',
      icon: CheckCircle,
    },
    warning: {
      color: 'text-orange-600',
      bgColor: 'bg-orange-600',
      label: 'Atención',
      icon: AlertCircle,
    },
    critical: {
      color: 'text-red-600',
      bgColor: 'bg-red-600',
      label: 'Crítico',
      icon: AlertCircle,
    },
  };

  const config = statusConfig[health.status];
  const StatusIcon = config.icon;

  return (
    <Card className="p-6 bg-gradient-to-br from-card to-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Score Circle */}
          <div className="relative">
            <svg className="w-24 h-24 transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="40"
                stroke="currentColor"
                strokeWidth="8"
                fill="none"
                className="text-muted"
              />
              <circle
                cx="48"
                cy="48"
                r="40"
                stroke="currentColor"
                strokeWidth="8"
                fill="none"
                strokeDasharray={`${(health.score / 100) * 251.2} 251.2`}
                className={config.color}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className={`text-2xl font-bold ${config.color}`}>{health.score}</p>
                <p className="text-[10px] text-muted-foreground">/ 100</p>
              </div>
            </div>
          </div>

          {/* Info */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <StatusIcon className={config.color} size={20} />
              <h3 className="text-xl font-bold">Estado del Negocio</h3>
            </div>
            <Badge variant="outline" className={`${config.color} border-current`}>
              {config.label}
            </Badge>
            {health.issues.length > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                {health.issues.length} área{health.issues.length > 1 ? 's' : ''} requiere
                {health.issues.length > 1 ? 'n' : ''} atención
              </p>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="gap-2"
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          {expanded ? 'Ocultar' : 'Ver'} detalles
        </Button>
      </div>

      {/* Expanded Details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="mt-6 pt-6 border-t space-y-4">
              {health.issues.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <AlertCircle size={16} className="text-orange-600" />
                    Problemas Detectados
                  </h4>
                  <ul className="space-y-2">
                    {health.issues.map((issue, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-orange-600 mt-0.5">•</span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {health.suggestions.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <TrendingUp size={16} className="text-primary" />
                    Sugerencias de Mejora
                  </h4>
                  <ul className="space-y-2">
                    {health.suggestions.map((suggestion, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-primary mt-0.5">→</span>
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
