/**
 * Phone Verification Component
 * WhatsApp-based phone number verification UI
 */

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, AlertCircle, Smartphone, Clock, Send } from 'lucide-react';
import api from '@/services/api';

interface PhoneVerificationProps {
  onVerified?: () => void;
  onSkip?: () => void;
  allowSkip?: boolean;
}

export function PhoneVerification({ onVerified, onSkip, allowSkip = false }: PhoneVerificationProps) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(600); // 10 minutes
  const [canResend, setCanResend] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoCode, setDemoCode] = useState('');

  // Countdown timer
  useEffect(() => {
    if (step === 'code' && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setError('El código ha expirado. Solicita uno nuevo.');
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [step, timeRemaining]);

  // Enable resend after 60 seconds
  useEffect(() => {
    if (step === 'code' && !canResend) {
      const timer = setTimeout(() => {
        setCanResend(true);
      }, 60000); // 60 seconds

      return () => clearTimeout(timer);
    }
  }, [step, canResend]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatPhone = (value: string) => {
    // Remove non-numeric characters except +
    const cleaned = value.replace(/[^\d+]/g, '');
    return cleaned;
  };

  const handleRequestCode = async () => {
    setError('');
    setSuccess('');

    // Validate phone
    if (!phone || phone.length < 10) {
      setError('Ingresa un número de teléfono válido');
      return;
    }

    setLoading(true);

    try {
      const response = await api.post('/phone-verification/request', { phone });

      setSuccess('Código enviado por WhatsApp');
      setStep('code');
      setTimeRemaining(600);
      setCanResend(false);

      // Check if demo mode
      if (response.data.demoMode) {
        setDemoMode(true);
        setDemoCode(response.data.code);
      }

    } catch (err: any) {
      if (err.response?.status === 409) {
        // Phone already registered
        setError(err.response.data.error || 'Este número ya está registrado');
      } else if (err.response?.status === 429) {
        // Rate limited
        setError(err.response.data.error || 'Debes esperar antes de solicitar otro código');
      } else {
        setError('Error al enviar código. Intenta nuevamente.');
      }
      logger.error('Error requesting code:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setError('');
    setSuccess('');

    if (!code || code.length !== 6) {
      setError('Ingresa el código de 6 dígitos');
      return;
    }

    setLoading(true);

    try {
      await api.post('/phone-verification/verify', { code });

      setSuccess('¡Teléfono verificado exitosamente!');

      // Call onVerified callback after a short delay
      setTimeout(() => {
        onVerified?.();
      }, 1500);

    } catch (err: any) {
      setError(err.response?.data?.error || 'Código inválido. Intenta nuevamente.');
      logger.error('Error verifying code:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setCode('');
    setError('');
    setSuccess('');
    await handleRequestCode();
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
          <Smartphone className="w-6 h-6 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Verificación por WhatsApp
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {step === 'phone' ? 'Ingresa tu número de teléfono' : 'Ingresa el código recibido'}
          </p>
        </div>
      </div>

      {/* Phone Input Step */}
      {step === 'phone' && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="phone">Número de teléfono</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+54 9 11 1234 5678"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              disabled={loading}
              className="mt-1"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Incluye el código de país (ej: +54 para Argentina)
            </p>
          </div>

          <Button
            onClick={handleRequestCode}
            disabled={loading || !phone}
            className="w-full"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Enviar código por WhatsApp
              </>
            )}
          </Button>

          {allowSkip && (
            <Button
              variant="ghost"
              onClick={onSkip}
              className="w-full"
            >
              Verificar después
            </Button>
          )}
        </div>
      )}

      {/* Code Input Step */}
      {step === 'code' && (
        <div className="space-y-4">
          {demoMode && (
            <Alert className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
              <AlertDescription className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Modo Demo:</strong> El código es <strong>{demoCode}</strong>
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="code">Código de verificación</Label>
            <Input
              id="code"
              type="text"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={loading}
              maxLength={6}
              className="mt-1 text-center text-2xl tracking-widest font-mono"
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <Clock className="w-4 h-4" />
              <span>Expira en {formatTime(timeRemaining)}</span>
            </div>
            {canResend && (
              <button
                onClick={handleResend}
                className="text-blue-600 dark:text-blue-400 hover:underline"
                disabled={loading}
              >
                Reenviar código
              </button>
            )}
          </div>

          <Button
            onClick={handleVerifyCode}
            disabled={loading || code.length !== 6}
            className="w-full"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Verificando...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Verificar teléfono
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={() => {
              setStep('phone');
              setCode('');
              setError('');
              setSuccess('');
            }}
            className="w-full"
          >
            Cambiar número
          </Button>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {success && (
        <Alert className="mt-4 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {/* Info */}
      <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          <strong>¿Por qué verificar tu teléfono?</strong>
          <br />
          La verificación por WhatsApp nos ayuda a mantener tu cuenta segura y evitar cuentas duplicadas.
        </p>
      </div>
    </div>
  );
}
