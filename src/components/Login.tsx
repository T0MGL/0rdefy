import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Eye, EyeOff, Mail, Lock, Zap } from 'lucide-react';
import { z } from 'zod';
import { preserveShopifyParams } from '@/utils/shopifyNavigation';
import { logger } from '@/utils/logger';
import AuthIllustration from '@/components/AuthIllustration';

const loginSchema = z.object({
  email: z.string().email('Ingresa un email válido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
});

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { signIn } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setErrors({});
      setIsLoading(true);

      logger.log('🔐 [LOGIN] Form submitted');

      // Validate form
      loginSchema.parse(formData);

      // Sign in with API
      const result = await signIn(formData.email, formData.password);

      if (result.error) {
        logger.error('❌ [LOGIN] Failed:', result.error);

        // Check if access was revoked (user was removed from all stores)
        const isAccessRevoked = result.error.toLowerCase().includes('acceso ha sido revocado') ||
                               result.error.toLowerCase().includes('access revoked');

        if (isAccessRevoked) {
          toast({
            title: "Acceso Revocado",
            description: result.error,
            variant: "destructive",
            duration: 10000,
          });
          return;
        }

        // Check if it's an email not found error
        const isEmailNotFound = result.error.toLowerCase().includes('no encontramos') ||
                               result.error.toLowerCase().includes('email') ||
                               result.error.toLowerCase().includes('crear una cuenta');

        if (isEmailNotFound) {
          toast({
            title: "Email no registrado",
            description: "No encontramos una cuenta con este email. Contacta al administrador para obtener acceso.",
            variant: "destructive",
            duration: 7000,
          });
        } else {
          // For password errors or other auth errors
          const isPasswordError = result.error.toLowerCase().includes('contraseña') ||
                                 result.error.toLowerCase().includes('password');

          toast({
            title: isPasswordError ? "Contraseña incorrecta" : "Error de autenticación",
            description: result.error,
            variant: "destructive",
            duration: 5000,
          });
        }
        return;
      }

      logger.log('✅ [LOGIN] Successful, redirecting...');

      toast({
        title: "¡Bienvenido!",
        description: "Has iniciado sesión exitosamente.",
      });

      // Redirect to the page user was trying to access, or dashboard
      // Preserve Shopify query parameters (shop, host, embedded) for App Bridge
      const from = (location.state as any)?.from?.pathname || '/';
      const pathWithShopifyParams = preserveShopifyParams(from);
      navigate(pathWithShopifyParams, { replace: true });

    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
        toast({
          title: "Error de validación",
          description: "Por favor verifica los campos del formulario.",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Illustration */}
      <AuthIllustration
        title="Ordefy"
        subtitle="Gestiona tu comercio electrónico con inteligencia"
      />

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <div className="bg-primary/10 rounded-xl p-2">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Ordefy</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2">Iniciar Sesión</h2>
            <p className="text-muted-foreground">
              Ingresa tus credenciales para acceder a tu cuenta
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-base font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@email.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="pl-10 h-12 text-base"
                  disabled={isLoading}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-base font-medium">
                Contraseña
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="pl-10 pr-10 h-12 text-base"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  id="remember"
                  type="checkbox"
                  className="w-4 h-4 rounded border-input cursor-pointer"
                />
                <label
                  htmlFor="remember"
                  className="text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Recordarme
                </label>
              </div>
              <button
                type="button"
                className="text-sm text-primary hover:underline font-medium"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Iniciando sesión...
                </div>
              ) : (
                'Iniciar Sesión'
              )}
            </Button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              ¿No tienes cuenta? Contacta al administrador para obtener acceso.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground">
              © 2025 Bright Idea - Ordefy. Todos los derechos reservados.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
