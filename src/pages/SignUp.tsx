import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Mail, Lock, Zap, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function SignUp() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    console.log('🚀 [SIGNUP] Form submitted');

    if (formData.password !== formData.confirmPassword) {
      console.warn('⚠️ [SIGNUP] Passwords do not match');
      setError('Las contraseñas no coinciden');
      return;
    }

    if (formData.password.length < 6) {
      console.warn('⚠️ [SIGNUP] Password too short');
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (!formData.name || !formData.email) {
      console.warn('⚠️ [SIGNUP] Missing required fields');
      setError('Por favor completa todos los campos');
      return;
    }

    setIsLoading(true);

    try {
      const result = await signUp(formData.email, formData.password, formData.name);

      if (result.error) {
        console.error('❌ [SIGNUP] Registration failed:', result.error);
        setError(result.error);
      } else {
        console.log('🎉 [SIGNUP] Registration successful, redirecting to onboarding...');
        // Redirect to onboarding instead of home - user needs to complete profile
        navigate('/onboarding', { replace: true });
      }
    } catch (err: any) {
      console.error('💥 [SIGNUP] Unexpected error:', err);
      setError('Error inesperado');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary/95 via-primary/80 to-primary/70 relative overflow-hidden">
        {/* Dark overlay for better text contrast */}
        <div className="absolute inset-0 bg-black/20"></div>

        {/* Pattern Overlay */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMwMDAiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItaDJWMzZoLTJ6bTAtNGgydjJoLTJ2LTJ6bTAtNGgydjJoLTJ2LTJ6bTAtNGgydjJoLTJ2LTJ6bS00IDBoMnYyaC0ydi0yem0tNCAwaC0ydjJoMnYtMnptMTIgMGgydjJoLTJ2LTJ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-20"></div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 shadow-lg">
                <Zap className="w-8 h-8 text-white drop-shadow-lg" />
              </div>
              <h1 className="text-5xl font-bold text-white drop-shadow-lg">Ordefy</h1>
            </div>
            <div className="h-1 w-20 bg-white rounded-full shadow-lg"></div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h2 className="text-3xl font-semibold mb-4 text-white drop-shadow-md">
              Comienza a optimizar tu negocio hoy
            </h2>
            <p className="text-xl text-white mb-8 leading-relaxed drop-shadow-md">
              Únete a cientos de comercios que ya están usando Ordefy para gestionar sus operaciones de manera inteligente.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="space-y-4"
          >
            {[
              { title: 'Configuración Rápida', desc: 'Comienza en menos de 5 minutos' },
              { title: 'Sin Tarjeta de Crédito', desc: 'Prueba gratis sin compromiso' },
              { title: 'Soporte 24/7', desc: 'Estamos aquí para ayudarte' },
            ].map((feature, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="mt-1 rounded-full bg-white/20 backdrop-blur-sm p-2 shadow-md">
                  <div className="w-2 h-2 bg-white rounded-full shadow-sm" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-white drop-shadow-md">{feature.title}</h3>
                  <p className="text-white drop-shadow-sm">{feature.desc}</p>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Right Side - Sign Up Form */}
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
            <h2 className="text-3xl font-bold mb-2">Crear Cuenta</h2>
            <p className="text-muted-foreground">
              Ingresa tus datos para comenzar tu prueba gratuita
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name Field */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-base font-medium">
                Nombre completo
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder="Juan Pérez"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="pl-10 h-12 text-base"
                  disabled={isLoading}
                />
              </div>
            </div>

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
                  placeholder="Mínimo 6 caracteres"
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
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-base font-medium">
                Confirmar Contraseña
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Repite tu contraseña"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="pl-10 pr-10 h-12 text-base"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Creando cuenta...
                </div>
              ) : (
                'Crear Cuenta'
              )}
            </Button>
          </form>

          {/* Terms */}
          <p className="mt-4 text-xs text-center text-muted-foreground">
            Al crear una cuenta, aceptas nuestros{' '}
            <a href="#" className="text-primary hover:underline">
              Términos de Servicio
            </a>{' '}
            y{' '}
            <a href="#" className="text-primary hover:underline">
              Política de Privacidad
            </a>
          </p>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              ¿Ya tienes cuenta?{' '}
              <Link
                to="/login"
                className="text-primary hover:underline font-medium"
              >
                Iniciar sesión
              </Link>
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
