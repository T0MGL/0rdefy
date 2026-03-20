import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import AuthIllustration from '@/components/AuthIllustration';
import { config } from '@/config';

const emailSchema = z.object({
  email: z.string().email('Ingresa un email valido'),
});

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const parsed = emailSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message || 'Email invalido');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${config.api.baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await response.json();

      if (response.status === 429) {
        toast({
          title: 'Demasiados intentos',
          description: 'Por favor espera unos minutos antes de intentar nuevamente.',
          variant: 'destructive',
        });
        return;
      }

      // Always show success (backend never reveals if email exists)
      if (data.success) {
        setSubmitted(true);
      }
    } catch {
      toast({
        title: 'Error de conexion',
        description: 'No pudimos procesar tu solicitud. Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#0a0a0a]">
      <AuthIllustration
        title="Ordefy"
        subtitle="Recupera el acceso a tu cuenta"
      />

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 0% 50%, rgba(132, 204, 22, 0.06) 0%, transparent 50%)'
          }}
        />

        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4 }}
              className="w-full max-w-md relative z-10"
            >
              {/* Mobile Logo */}
              <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
                <img
                  src="/favicon.ico"
                  alt="Ordefy Logo"
                  className="w-10 h-10 object-contain"
                />
                <h1 className="text-2xl font-bold text-white">Ordefy</h1>
              </div>

              <div className="mb-8">
                <h2 className="text-3xl font-bold mb-2 text-white">
                  Recuperar contrasena
                </h2>
                <p className="text-slate-400">
                  Ingresa tu email y te enviaremos instrucciones para restablecer tu contrasena.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-base font-medium text-slate-200">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="tu@email.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError('');
                      }}
                      className="pl-10 h-12 text-base"
                      disabled={isLoading}
                      autoFocus
                    />
                  </div>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-sm text-destructive"
                    >
                      {error}
                    </motion.p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Enviando...
                    </div>
                  ) : (
                    'Enviar instrucciones'
                  )}
                </Button>
              </form>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Volver a iniciar sesion
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-800 text-center">
                <p className="text-xs text-slate-600">
                  &copy; 2025 Bright Idea. Ordefy. Todos los derechos reservados.
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="w-full max-w-md relative z-10 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 15 }}
                className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6"
              >
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </motion.div>

              <h2 className="text-2xl font-bold mb-3 text-white">
                Revisa tu bandeja de entrada
              </h2>
              <p className="text-slate-400 mb-8 leading-relaxed">
                Si el email <span className="text-slate-200 font-medium">{email}</span> esta
                registrado en Ordefy, recibiras un enlace para restablecer tu contrasena.
                El enlace expira en 30 minutos.
              </p>

              <div className="space-y-3">
                <Button
                  onClick={() => navigate('/login')}
                  className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Ir a iniciar sesion
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setEmail('');
                  }}
                  className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Enviar a otro email
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-800">
                <p className="text-xs text-slate-600">
                  No olvides revisar la carpeta de spam si no ves el correo.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
