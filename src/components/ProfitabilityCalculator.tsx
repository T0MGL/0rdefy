import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { TrendingUp, DollarSign, Percent } from 'lucide-react';
import { useState, useEffect } from 'react';
import { formatCurrency, getCurrencySymbol } from '@/utils/currency';

export function ProfitabilityCalculator() {
  const [cost, setCost] = useState<number>(0);
  const [sellingPrice, setSellingPrice] = useState<number>(0);
  const [marketingPerUnit, setMarketingPerUnit] = useState<number>(0);
  const [shippingCost, setShippingCost] = useState<number>(0);

  const [netProfit, setNetProfit] = useState<number>(0);
  const [profitMargin, setProfitMargin] = useState<number>(0);
  const [suggestedPrice, setSuggestedPrice] = useState<number>(0);

  useEffect(() => {
    // Calcular ganancia neta
    const totalCosts = cost + marketingPerUnit + shippingCost;
    const profit = sellingPrice - totalCosts;
    setNetProfit(profit);

    // Calcular margen
    const margin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;
    setProfitMargin(margin);

    // Calcular precio sugerido para 40% de margen
    const targetMargin = 0.4;
    const suggested = totalCosts / (1 - targetMargin);
    setSuggestedPrice(suggested);
  }, [cost, sellingPrice, marketingPerUnit, shippingCost]);

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
        <TrendingUp className="text-primary" size={20} />
        Calculadora de Rentabilidad
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="cost">Costo del Producto</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                {getCurrencySymbol()}
              </span>
              <Input
                id="cost"
                type="number"
                value={cost || ''}
                onChange={(e) => setCost(Number(e.target.value))}
                className="pl-12"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="price">Precio de Venta</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                {getCurrencySymbol()}
              </span>
              <Input
                id="price"
                type="number"
                value={sellingPrice || ''}
                onChange={(e) => setSellingPrice(Number(e.target.value))}
                className="pl-12"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="marketing">CPA (Costo por Adquisición)</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                {getCurrencySymbol()}
              </span>
              <Input
                id="marketing"
                type="number"
                value={marketingPerUnit || ''}
                onChange={(e) => setMarketingPerUnit(Number(e.target.value))}
                className="pl-12"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="shipping">Costo de Envío</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                {getCurrencySymbol()}
              </span>
              <Input
                id="shipping"
                type="number"
                value={shippingCost || ''}
                onChange={(e) => setShippingCost(Number(e.target.value))}
                className="pl-12"
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <DollarSign size={14} />
              Ganancia Neta
            </div>
            <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-primary' : 'text-red-600'}`}>
              {formatCurrency(netProfit)}
            </p>
          </div>

          <div className="p-4 bg-muted rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Percent size={14} />
              Margen de Beneficio
            </div>
            <p className={`text-2xl font-bold ${profitMargin >= 30 ? 'text-primary' : profitMargin >= 15 ? 'text-orange-600' : 'text-red-600'}`}>
              {profitMargin.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {profitMargin >= 30 ? 'Excelente margen' : profitMargin >= 15 ? 'Margen bajo' : 'Margen crítico'}
            </p>
          </div>

          <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-primary mb-1">
              <TrendingUp size={14} />
              Precio Sugerido (40% margen)
            </div>
            <p className="text-2xl font-bold text-primary">
              {formatCurrency(suggestedPrice)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Para obtener un margen de beneficio del 40%
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
