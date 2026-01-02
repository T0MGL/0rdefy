/**
 * Referral Landing Page
 *
 * Handles referral links (/r/:code) and redirects to signup with the code
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Gift, Sparkles, ArrowRight, Check } from 'lucide-react';
import { billingService } from '@/services/billing.service';

export default function Referral() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function validateCode() {
      if (!code) {
        setError('Código de referido no válido');
        setIsValidating(false);
        return;
      }

      try {
        const result = await billingService.validateReferralCode(code);
        if (result.valid) {
          setIsValid(true);
          setReferrerName(result.referrerName || null);
          // Store the referral code in sessionStorage for signup
          sessionStorage.setItem('referral_code', code);
        } else {
          setError(result.error || 'Código de referido no válido o expirado');
        }
      } catch (err: any) {
        setError('Error al validar el código de referido');
      } finally {
        setIsValidating(false);
      }
    }

    validateCode();
  }, [code]);

  const handleSignUp = () => {
    // Store referral code and redirect to signup
    localStorage.setItem('pending_referral_code', code || '');
    navigate(`/signup?ref=${code}`);
  };

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-red-500">Link Inválido</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => window.location.href = 'https://ordefy.io'}>
              Visitar Ordefy
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Gift className="h-8 w-8 text-primary" />
          </div>
          <div>
            <Badge variant="secondary" className="mb-2">
              <Sparkles className="h-3 w-3 mr-1" />
              Invitación Especial
            </Badge>
            <CardTitle className="text-3xl font-bold">
              {referrerName ? `${referrerName} te invita` : 'Has sido invitado'}
            </CardTitle>
            <CardDescription className="text-lg mt-2">
              a probar Ordefy con un descuento exclusivo
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Benefits */}
          <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-green-700 dark:text-green-400">
              Tu beneficio:
            </h3>
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-5 w-5" />
              <span className="font-medium">20% de descuento en tu primer mes</span>
            </div>
            <p className="text-sm text-muted-foreground">
              El descuento se aplicará automáticamente cuando elijas un plan de pago.
            </p>
          </div>

          {/* Features Preview */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground">
              Con Ordefy podrás:
            </h4>
            <ul className="text-sm space-y-1">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                Gestionar todos tus pedidos en un solo lugar
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                Sincronizar automáticamente con Shopify
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                Controlar tu inventario en tiempo real
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                Imprimir etiquetas de envío profesionales
              </li>
            </ul>
          </div>

          {/* CTA */}
          <Button
            size="lg"
            className="w-full"
            onClick={handleSignUp}
          >
            Comenzar ahora
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            El descuento se aplicará automáticamente a tu cuenta.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
