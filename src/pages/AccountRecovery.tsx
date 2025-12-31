/**
 * Account Recovery Page
 * Allows users to recover their account when phone number is already registered
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function AccountRecovery() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showSuccess, setShowSuccess] = useState(false);

  // Get email from location state
  const email = (location.state as any)?.email || '';
  const phone = (location.state as any)?.phone || '';

  const handleGoToLogin = () => {
    navigate('/login');
  };

  const handleContactSupport = () => {
    // Open WhatsApp with pre-filled message
    const message = encodeURIComponent(
      `Hola, necesito ayuda para recuperar mi cuenta de Ordefy.\n\n` +
      `Teléfono: ${phone}\n` +
      `Email asociado: ${email}`
    );
    window.open(`https://wa.me/595981123456?text=${message}`, '_blank');
    setShowSuccess(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-8">
          {/* Icon */}
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-center mb-2 text-gray-900 dark:text-gray-100">
            Cuenta Existente
          </h1>

          {/* Description */}
          <p className="text-center text-gray-600 dark:text-gray-400 mb-6">
            Este número de teléfono ya está registrado en Ordefy
          </p>

          {/* Account Info */}
          {email && (
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Cuenta asociada:
                </p>
              </div>
              <p className="text-base font-mono text-gray-900 dark:text-gray-100">
                {email}
              </p>
            </div>
          )}

          {/* Options */}
          <div className="space-y-3">
            <Button
              onClick={handleGoToLogin}
              className="w-full"
              size="lg"
            >
              Iniciar sesión
            </Button>

            <Button
              onClick={handleContactSupport}
              variant="outline"
              className="w-full"
              size="lg"
            >
              Contactar soporte
            </Button>

            <Button
              onClick={() => navigate(-1)}
              variant="ghost"
              className="w-full"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Volver
            </Button>
          </div>

          {/* Success message */}
          {showSuccess && (
            <Alert className="mt-6 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                Te contactaremos pronto para ayudarte a recuperar tu cuenta.
              </AlertDescription>
            </Alert>
          )}

          {/* Info */}
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>¿Olvidaste tu contraseña?</strong>
              <br />
              Puedes recuperarla desde la pantalla de inicio de sesión.
            </p>
          </div>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Si no reconoces esta cuenta, contacta inmediatamente a soporte.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
