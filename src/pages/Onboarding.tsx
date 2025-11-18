import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Store, DollarSign, CheckCircle2, ArrowRight, ArrowLeft } from 'lucide-react';
import { z } from 'zod';

// Validation schemas
const step1Schema = z.object({
  userName: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
  userPhone: z.string().trim().min(8, 'El teléfono debe tener al menos 8 dígitos').max(20, 'Máximo 20 caracteres'),
  storeName: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
  storeCountry: z.string().min(1, 'Selecciona un país'),
});

const step2Schema = z.object({
  currency: z.string().min(1, 'Selecciona una moneda'),
});

const step3Schema = z.object({
  taxRate: z.number().min(0, 'Debe ser mayor o igual a 0').max(100, 'Máximo 100%'),
  adminFee: z.number().min(0, 'Debe ser mayor o igual a 0').max(100, 'Máximo 100%'),
});

export default function Onboarding() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    userName: user?.name || '',
    userPhone: '',
    storeName: '',
    storeCountry: '',
    currency: '',
    taxRate: 10,
    adminFee: 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = () => {
    try {
      setErrors({});
      
      if (currentStep === 1) {
        step1Schema.parse({
          userName: formData.userName,
          userPhone: formData.userPhone,
          storeName: formData.storeName,
          storeCountry: formData.storeCountry,
        });
      } else if (currentStep === 2) {
        step2Schema.parse({
          currency: formData.currency,
        });
      } else if (currentStep === 3) {
        step3Schema.parse({
          taxRate: formData.taxRate,
          adminFee: formData.adminFee,
        });
      }
      
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleNext = () => {
    if (!validateStep()) {
      toast({
        title: "Error de validación",
        description: "Por favor completa todos los campos correctamente.",
        variant: "destructive",
      });
      return;
    }

    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    try {
      setIsLoading(true);

      const token = localStorage.getItem('auth_token');

      if (!token) {
        toast({
          title: "Error",
          description: "Debes iniciar sesión para completar el onboarding",
          variant: "destructive",
        });
        navigate('/login');
        return;
      }

      // Call API endpoint to complete onboarding
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userName: formData.userName,
          userPhone: formData.userPhone,
          storeName: formData.storeName,
          storeCountry: formData.storeCountry,
          storeCurrency: formData.currency,
          taxRate: formData.taxRate,
          adminFee: formData.adminFee,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al completar onboarding');
      }

      // Update user and store info in localStorage
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('current_store_id', data.store.id);
      localStorage.setItem('onboarding_completed', 'true');

      toast({
        title: "¡Configuración completada!",
        description: "Tu tienda ha sido configurada exitosamente.",
      });

      // Small delay to ensure localStorage is written
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 500);

    } catch (error: any) {
      console.error('Error completing onboarding:', error);

      // Check if it's an auth error
      if (error.message?.includes('JWT') || error.message?.includes('auth') || error.message?.includes('token')) {
        toast({
          title: "Error de autenticación",
          description: "Tu sesión expiró. Por favor inicia sesión nuevamente.",
          variant: "destructive",
        });
        navigate('/login');
      } else {
        toast({
          title: "Error",
          description: error.message || "No se pudo completar la configuración",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('onboarding_completed', 'true');
    navigate('/');
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Background with Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary/95 via-primary/80 to-primary/70 relative overflow-hidden">
        {/* Dark overlay for better text contrast */}
        <div className="absolute inset-0 bg-black/20"></div>

        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMwMDAiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItaDJWMzZoLTJ6bTAtNGgydjJoLTJ2LTJ6bTAtNGgydjJoLTJ2LTJ6bTAtNGgydjJoLTJ2LTJ6bS00IDBoMnYyaC0ydi0yem0tNCAwaC0ydjJoMnYtMnptMTIgMGgydjJoLTJ2LTJ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-20"></div>

        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="mb-8">
            <h1 className="text-5xl font-bold mb-4 text-white drop-shadow-lg">Ordefy</h1>
            <div className="h-1 w-20 bg-white rounded-full shadow-lg"></div>
          </div>

          <h2 className="text-3xl font-semibold mb-6 text-white drop-shadow-md">Configuración Inicial</h2>
          <p className="text-xl text-white mb-8 drop-shadow-sm">
            Para comenzar, necesitamos configurar tu tienda y preferencias básicas.
          </p>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className={`mt-1 rounded-full p-2 shadow-md ${currentStep >= 1 ? 'bg-white text-primary' : 'bg-white/20 text-white'}`}>
                <Store size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-white drop-shadow-md">Información de tu tienda</h3>
                <p className="text-white drop-shadow-sm">Nombre y ubicación</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className={`mt-1 rounded-full p-2 shadow-md ${currentStep >= 2 ? 'bg-white text-primary' : 'bg-white/20 text-white'}`}>
                <DollarSign size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-white drop-shadow-md">Moneda</h3>
                <p className="text-white drop-shadow-sm">Configura tu moneda preferida</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className={`mt-1 rounded-full p-2 shadow-md ${currentStep >= 3 ? 'bg-white text-primary' : 'bg-white/20 text-white'}`}>
                <CheckCircle2 size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-white drop-shadow-md">Comisiones</h3>
                <p className="text-white drop-shadow-sm">Impuestos y tarifas administrativas</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Progress Indicators */}
          <div className="flex items-center justify-center gap-4 mb-12">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <motion.div
                  initial={false}
                  animate={{
                    scale: currentStep === step ? 1.1 : 1,
                    backgroundColor: currentStep >= step ? 'hsl(84 81% 63%)' : 'hsl(240 5% 96%)',
                  }}
                  className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold transition-colors ${
                    currentStep >= step ? 'text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {currentStep > step ? (
                    <CheckCircle2 size={24} />
                  ) : step === 1 ? (
                    <Store size={20} />
                  ) : step === 2 ? (
                    <DollarSign size={20} />
                  ) : (
                    <CheckCircle2 size={20} />
                  )}
                </motion.div>
                {step < 3 && (
                  <div className={`w-16 h-1 mx-2 rounded-full transition-colors ${
                    currentStep > step ? 'bg-primary' : 'bg-muted'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* Form Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Información Personal y de tu Tienda</h2>
                    <p className="text-muted-foreground">
                      Completa tu perfil y configura tu tienda
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="userName" className="text-base">
                        Tu Nombre Completo <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="userName"
                        value={formData.userName}
                        onChange={(e) => setFormData({ ...formData, userName: e.target.value })}
                        placeholder="Juan Pérez"
                        className="mt-2 h-12"
                      />
                      {errors.userName && (
                        <p className="text-sm text-destructive mt-1">{errors.userName}</p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="userPhone" className="text-base">
                        Tu Teléfono <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="userPhone"
                        value={formData.userPhone}
                        onChange={(e) => setFormData({ ...formData, userPhone: e.target.value })}
                        placeholder="+595 981 234567"
                        className="mt-2 h-12"
                      />
                      {errors.userPhone && (
                        <p className="text-sm text-destructive mt-1">{errors.userPhone}</p>
                      )}
                    </div>

                    <div className="pt-4 border-t">
                      <Label htmlFor="storeName" className="text-base">
                        Nombre de la Tienda <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="storeName"
                        value={formData.storeName}
                        onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                        placeholder="Mi Tienda"
                        className="mt-2 h-12"
                      />
                      {errors.storeName && (
                        <p className="text-sm text-destructive mt-1">{errors.storeName}</p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="storeCountry" className="text-base">
                        País <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={formData.storeCountry}
                        onValueChange={(value) => setFormData({ ...formData, storeCountry: value })}
                      >
                        <SelectTrigger className="mt-2 h-12">
                          <SelectValue placeholder="Selecciona un país" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PY">🇵🇾 Paraguay</SelectItem>
                          <SelectItem value="AR">🇦🇷 Argentina</SelectItem>
                          <SelectItem value="CO">🇨🇴 Colombia</SelectItem>
                          <SelectItem value="MX">🇲🇽 México</SelectItem>
                          <SelectItem value="CL">🇨🇱 Chile</SelectItem>
                        </SelectContent>
                      </Select>
                      {errors.storeCountry && (
                        <p className="text-sm text-destructive mt-1">{errors.storeCountry}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Moneda</h2>
                    <p className="text-muted-foreground">
                      Elige la moneda en la que prefieres ver los datos.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="currency" className="text-base">
                      Moneda <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={formData.currency}
                      onValueChange={(value) => setFormData({ ...formData, currency: value })}
                    >
                      <SelectTrigger className="mt-2 h-12">
                        <SelectValue placeholder="Selecciona una moneda" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pyg">🇵🇾 PYG - Guaraní Paraguayo</SelectItem>
                        <SelectItem value="usd">🇺🇸 USD - Dólar Estadounidense</SelectItem>
                        <SelectItem value="ars">🇦🇷 ARS - Peso Argentino</SelectItem>
                        <SelectItem value="cop">🇨🇴 COP - Peso Colombiano</SelectItem>
                        <SelectItem value="mxn">🇲🇽 MXN - Peso Mexicano</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.currency && (
                      <p className="text-sm text-destructive mt-1">{errors.currency}</p>
                    )}
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">Comisiones y Tarifas</h2>
                    <p className="text-muted-foreground">
                      Configura los valores de impuestos y tarifas administrativas.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="taxRate" className="text-base">
                        Impuesto (%) <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="taxRate"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={formData.taxRate}
                        onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 0 })}
                        placeholder="10"
                        className="mt-2 h-12"
                      />
                      {errors.taxRate && (
                        <p className="text-sm text-destructive mt-1">{errors.taxRate}</p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="adminFee" className="text-base">
                        Tarifa Administrativa (%) <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="adminFee"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={formData.adminFee}
                        onChange={(e) => setFormData({ ...formData, adminFee: parseFloat(e.target.value) || 0 })}
                        placeholder="0"
                        className="mt-2 h-12"
                      />
                      {errors.adminFee && (
                        <p className="text-sm text-destructive mt-1">{errors.adminFee}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between mt-12">
            <Button
              variant="ghost"
              onClick={currentStep === 1 ? handleSkip : handleBack}
              className="gap-2"
            >
              <ArrowLeft size={16} />
              {currentStep === 1 ? 'Saltar' : 'Atrás'}
            </Button>

            <Button
              onClick={handleNext}
              disabled={isLoading}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-8"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  {currentStep === 3 ? 'Completar' : 'Siguiente'}
                  {currentStep === 3 ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
