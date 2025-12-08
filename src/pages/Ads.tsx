import { Card, CardContent } from '@/components/ui/card';
import { Megaphone, Target, BarChart3, Zap } from 'lucide-react';

export default function Ads() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
      <Card className="max-w-2xl w-full">
        <CardContent className="p-12 text-center">
          {/* Icono */}
          <div className="mb-6 flex justify-center">
            <div className="p-6 bg-primary/10 rounded-full">
              <Megaphone className="h-16 w-16 text-primary" />
            </div>
          </div>

          {/* Título */}
          <h1 className="text-4xl font-bold mb-4 text-card-foreground">
            Próximamente
          </h1>

          {/* Descripción */}
          <p className="text-lg text-muted-foreground mb-8">
            Estamos trabajando en una nueva experiencia para gestionar tus campañas publicitarias.
          </p>

          {/* Features que vendrán */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="p-4 bg-muted/50 rounded-lg">
              <Target className="h-8 w-8 mx-auto mb-2 text-primary" />
              <h3 className="font-semibold mb-1">Seguimiento ROI</h3>
              <p className="text-sm text-muted-foreground">
                Monitorea el retorno de inversión en tiempo real
              </p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 text-primary" />
              <h3 className="font-semibold mb-1">Analytics Avanzado</h3>
              <p className="text-sm text-muted-foreground">
                Insights profundos sobre tus campañas
              </p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <Zap className="h-8 w-8 mx-auto mb-2 text-primary" />
              <h3 className="font-semibold mb-1">Automatización</h3>
              <p className="text-sm text-muted-foreground">
                Optimiza tus anuncios automáticamente
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="pt-6 border-t">
            <p className="text-sm text-muted-foreground">
              ¿Tienes sugerencias? Contáctanos en{' '}
              <a href="mailto:support@ordefy.com" className="text-primary hover:underline">
                support@ordefy.com
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
