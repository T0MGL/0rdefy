import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Lock, Eye, EyeOff, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import AuthIllustration from '@/components/AuthIllustration';
import { config } from '@/config';

const resetSchema = z.object({
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Las contrasenas no coinciden',
  path: ['confirmPassword'],
});

type ResetState = 'form' | 'success' | 'error';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const token = searchParams.get('token') || '';

  const [formData, setFormData] = useState({ password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [state, setState] = useState<ResetState>(token ? 'form' : 'error');
  const [errorMessage, setErrorMessage] = useState(
    token ? '' : 'Enlace invalido. No se encontro un token de restablecimiento.'
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const parsed = resetSchema.safeParse(formData);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${config.api.baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password: formData.password,
        }),
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

      if (data.success) {
        setState('success');
      } else {
        const code = data.code as string;
        if (code === 'TOKEN_EXPIRED') {
          setErrorMessage('El enlace ha expirado. Solicita uno nuevo desde la pagina de recuperacion.');
          setState('error');
        } else if (code === 'TOKEN_USED') {
          setErrorMessage('Este enlace ya fue utilizado. Si necesitas restablecer tu contrasena, solicita uno nuevo.');
          setState('error');
        } else {
          setErrorMessage(data.error || 'No se pudo restablecer la contrasena. Intenta nuevamente.');
          setState('error');
        }
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
        subtitle="Crea una nueva contrasena segura"
      />

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 0% 50%, rgba(132, 204, 22, 0.06) 0%, transparent 50%)'
          }}
        />

        <AnimatePresence mode="wait">
          {state === 'form' && (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4 }}
              className="w-full max-w-md relative z-10"
            >
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
                  Nueva contrasena
                </h2>
                <p className="text-slate-400">
                  Ingresa tu nueva contrasena. Debe tener al menos 8 caracteres.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-base font-medium text-slate-200">
                    Nueva contrasena
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Minimo 8 caracteres"
                      value={formData.password}
                      onChange={(e) => {
                        setFormData({ ...formData, password: e.target.value });
                        setErrors({});
                      }}
                      className="pl-10 pr-10 h-12 text-base"
                      disabled={isLoading}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      disabled={isLoading}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-sm text-destructive"
                    >
                      {errors.password}
                    </motion.p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-base font-medium text-slate-200">
                    Confirmar contrasena
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Repite tu contrasena"
                      value={formData.confirmPassword}
                      onChange={(e) => {
                        setFormData({ ...formData, confirmPassword: e.target.value });
                        setErrors({});
                      }}
                      className="pl-10 pr-10 h-12 text-base"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      disabled={isLoading}
                    >
                      {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-sm text-destructive"
                    >
                      {errors.confirmPassword}
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
                      Restableciendo...
                    </div>
                  ) : (
                    'Restablecer contrasena'
                  )}
                </Button>
              </form>

              <div className="mt-8 pt-6 border-t border-slate-800 text-center">
                <p className="text-xs text-slate-600">
                  &copy; 2025 Bright Idea. Ordefy. Todos los derechos reservados.
                </p>
              </div>
            </motion.div>
          )}

          {state === 'success' && (
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
                Contrasena restablecida
              </h2>
              <p className="text-slate-400 mb-8 leading-relaxed">
                Tu contrasena fue actualizada exitosamente. Ya puedes iniciar sesion con tu nueva contrasena.
              </p>

              <Button
                onClick={() => navigate('/login')}
                className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Iniciar sesion
              </Button>

              <div className="mt-8 pt-6 border-t border-slate-800">
                <p className="text-xs text-slate-600">
                  &copy; 2025 Bright Idea. Ordefy. Todos los derechos reservados.
                </p>
              </div>
            </motion.div>
          )}

          {state === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="w-full max-w-md relative z-10 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 15 }}
                className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6"
              >
                <XCircle className="w-8 h-8 text-destructive" />
              </motion.div>

              <h2 className="text-2xl font-bold mb-3 text-white">
                Enlace no valido
              </h2>
              <p className="text-slate-400 mb-8 leading-relaxed">
                {errorMessage}
              </p>

              <div className="space-y-3">
                <Button
                  onClick={() => navigate('/forgot-password')}
                  className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Solicitar nuevo enlace
                </Button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors mx-auto"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Volver a iniciar sesion
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-800">
                <p className="text-xs text-slate-600">
                  &copy; 2025 Bright Idea. Ordefy. Todos los derechos reservados.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
