/**
 * AcceptInvitation Page
 *
 * Página para que los colaboradores invitados acepten su invitación.
 * Solo requieren crear una contraseña para completar el proceso.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';

interface InvitationData {
  name: string;
  email: string;
  role: string;
  storeName: string;
  expiresAt: string;
}

export default function AcceptInvitation() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    validateToken();
  }, [token]);

  const validateToken = async () => {
    try {
      const res = await fetch(`/api/collaborators/validate-token/${token}`);
      const data = await res.json();

      if (!data.valid) {
        setError(data.error || 'Invitación inválida o expirada');
      } else {
        setInvitation(data.invitation);
      }
    } catch (err) {
      console.error('Error validating token:', err);
      setError('Error al validar la invitación');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validations
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    setAccepting(true);

    try {
      const res = await fetch('/api/collaborators/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al aceptar invitación');
      }

      // Auto-login: Save token and store ID
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('current_store_id', data.storeId);

      // Redirect to dashboard
      navigate('/dashboard');
      window.location.reload(); // Force reload to initialize auth context
    } catch (err: any) {
      console.error('Error accepting invitation:', err);
      setError(err.message || 'Error al aceptar la invitación');
    } finally {
      setAccepting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Validando invitación...</p>
        </div>
      </div>
    );
  }

  // Error state (invalid/expired invitation)
  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <CardTitle>Invitación Inválida</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  No se pudo validar la invitación
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600 dark:text-gray-400">{error}</p>
            <div className="space-y-2 text-sm text-gray-500 dark:text-gray-500">
              <p>Posibles causas:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>La invitación ha expirado (7 días de validez)</li>
                <li>La invitación ya fue utilizada</li>
                <li>El link de invitación es incorrecto</li>
              </ul>
            </div>
            <Button onClick={() => navigate('/login')} className="w-full">
              Ir al Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state - Show form to accept invitation
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle>Invitación a {invitation?.storeName}</CardTitle>
              <CardDescription>
                Has sido invitado como <strong className="text-foreground">{invitation?.role}</strong>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAccept} className="space-y-4">
            {/* Pre-filled Information */}
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border">
              <div>
                <Label className="text-xs text-gray-500 dark:text-gray-400">Nombre</Label>
                <p className="font-medium">{invitation?.name}</p>
              </div>
              <div>
                <Label className="text-xs text-gray-500 dark:text-gray-400">Email</Label>
                <p className="font-medium">{invitation?.email}</p>
              </div>
            </div>

            {/* Password Fields */}
            <div className="space-y-2">
              <Label htmlFor="password">Crear Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  minLength={8}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Usa una combinación de letras, números y símbolos
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Contraseña</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite tu contraseña"
                  required
                  minLength={8}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <Alert variant="destructive">
                <XCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <Button type="submit" className="w-full" size="lg" disabled={accepting}>
              {accepting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Aceptando invitación...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Aceptar Invitación
                </>
              )}
            </Button>

            {/* Terms */}
            <p className="text-xs text-center text-gray-500 dark:text-gray-400">
              Al aceptar, confirmas que tienes autorización para acceder a esta tienda
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
