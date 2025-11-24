import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { User, Mail, Phone, Building, Upload, CreditCard, Bell, Palette, Shield, AlertCircle, Eye, EyeOff, LogOut, Store, Trash2, CheckCircle } from 'lucide-react';

export default function Settings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, currentStore, stores, updateProfile, changePassword, deleteAccount, deleteStore, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'profile');
  const [profileImage, setProfileImage] = useState<string>('');
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    company: currentStore?.name || '',
  });

  // Password change state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Delete account state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Delete store state
  const [deleteStoreDialogOpen, setDeleteStoreDialogOpen] = useState(false);
  const [storeToDelete, setStoreToDelete] = useState<string | null>(null);
  const [isDeletingStore, setIsDeletingStore] = useState(false);

  // Update form data when user or store changes
  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        company: currentStore?.name || '',
      });
    }
  }, [user, currentStore]);

  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    orderAlerts: true,
    marketingEmails: false,
  });

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar tipo
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Error",
        description: "Solo se permiten imágenes JPG, PNG o WebP",
        variant: "destructive"
      });
      return;
    }

    // Validar tamaño (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "Error",
        description: "La imagen no debe superar 2MB",
        variant: "destructive"
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setProfileImage(reader.result as string);
      toast({
        title: "Imagen actualizada",
        description: "Tu foto de perfil ha sido actualizada exitosamente.",
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = await updateProfile({
      userName: formData.name,
      userPhone: formData.phone,
      storeName: formData.company,
    });

    if (result.error) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Perfil actualizado",
        description: "Tus cambios han sido guardados exitosamente.",
      });
    }
  };

  const handlePreferenceChange = (key: keyof typeof preferences) => {
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
    toast({
      title: "Preferencia actualizada",
      description: "Tu configuración ha sido guardada.",
    });
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams({ tab: value });
  };

  const handleChangePassword = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      toast({
        title: "Error",
        description: "Todos los campos son obligatorios",
        variant: "destructive",
      });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast({
        title: "Error",
        description: "La nueva contraseña debe tener al menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: "Error",
        description: "Las contraseñas no coinciden",
        variant: "destructive",
      });
      return;
    }

    setIsChangingPassword(true);

    const result = await changePassword(passwordData.currentPassword, passwordData.newPassword);

    setIsChangingPassword(false);

    if (result.error) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Contraseña actualizada",
        description: "Tu contraseña ha sido cambiada exitosamente.",
      });
      setPasswordDialogOpen(false);
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      toast({
        title: "Error",
        description: "Debes ingresar tu contraseña para confirmar",
        variant: "destructive",
      });
      return;
    }

    setIsDeletingAccount(true);

    const result = await deleteAccount(deletePassword);

    setIsDeletingAccount(false);

    if (result.error) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Cuenta eliminada",
        description: "Tu cuenta ha sido eliminada exitosamente.",
      });
      setDeleteDialogOpen(false);
      navigate('/login');
    }
  };

  const handleLogout = () => {
    signOut();
    toast({
      title: "Sesión cerrada",
      description: "Has cerrado sesión exitosamente.",
    });
    navigate('/login');
  };

  const handleDeleteStoreClick = (storeId: string) => {
    setStoreToDelete(storeId);
    setDeleteStoreDialogOpen(true);
  };

  const handleDeleteStore = async () => {
    if (!storeToDelete) return;

    setIsDeletingStore(true);

    const result = await deleteStore(storeToDelete);

    setIsDeletingStore(false);

    if (result.error) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Tienda eliminada",
        description: "La tienda ha sido eliminada exitosamente.",
      });
      setDeleteStoreDialogOpen(false);
      setStoreToDelete(null);
      // The deleteStore function already handles the page reload
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Configuración</h1>
        <p className="text-muted-foreground">
          Administra tu perfil y preferencias de la cuenta
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-[600px]">
          <TabsTrigger value="profile" className="gap-2">
            <User size={16} />
            Perfil
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2">
            <CreditCard size={16} />
            Facturación
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-2">
            <Bell size={16} />
            Preferencias
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield size={16} />
            Seguridad
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-6">Información del Perfil</h2>

            <div className="flex items-center gap-6 mb-8">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  {profileImage ? (
                    <AvatarImage src={profileImage} alt="Profile" />
                  ) : (
                    <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
                      {formData.name.charAt(0)}
                    </AvatarFallback>
                  )}
                </Avatar>
                <label
                  htmlFor="avatar-upload"
                  className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors"
                >
                  <Upload size={16} />
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </label>
              </div>
              <div>
                <h3 className="font-semibold text-lg">{formData.name}</h3>
                <p className="text-sm text-muted-foreground">{formData.email}</p>
                <Button variant="outline" size="sm" className="mt-2" asChild>
                  <label htmlFor="avatar-upload" className="cursor-pointer">
                    Cambiar foto
                  </label>
                </Button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="flex items-center gap-2">
                    <User size={16} />
                    Nombre completo
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Tu nombre"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-2">
                    <Mail size={16} />
                    Correo electrónico
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="tu@email.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-2">
                    <Phone size={16} />
                    Teléfono
                  </Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+595 981 234567"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company" className="flex items-center gap-2">
                    <Building size={16} />
                    Nombre de la Tienda
                  </Label>
                  <Input
                    id="company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="Nombre de tu tienda"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline">
                  Cancelar
                </Button>
                <Button type="submit">
                  Guardar cambios
                </Button>
              </div>
            </form>
          </Card>

          {/* Store Management */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-6">Mis Tiendas</h2>

            <div className="space-y-4">
              {stores.map((store) => (
                <div
                  key={store.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors dark:border-gray-700"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Store className="text-primary" size={24} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{store.name}</h3>
                        {currentStore?.id === store.id && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-400">
                            <CheckCircle size={12} />
                            Activa
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {store.country} • {store.currency} • {store.role}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {stores.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteStoreClick(store.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {stores.length === 1 && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-950/20 dark:border-blue-900">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    Esta es tu única tienda. Debes tener al menos una tienda activa.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="text-primary" size={32} />
                </div>
                <h3 className="text-xl font-semibold mb-2">Facturación en Desarrollo</h3>
                <p className="text-muted-foreground mb-6">
                  Esta funcionalidad está siendo desarrollada actualmente. Pronto podrás gestionar tus métodos de pago, ver facturas y administrar tu suscripción desde aquí.
                </p>
                <div className="space-y-3 text-sm text-left bg-muted/50 p-4 rounded-lg">
                  <p className="font-medium">Funciones próximamente disponibles:</p>
                  <ul className="space-y-2 ml-4">
                    <li>• Métodos de pago</li>
                    <li>• Historial de facturas</li>
                    <li>• Gestión de suscripción</li>
                    <li>• Información fiscal</li>
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-6">Preferencias de Notificaciones</h2>

            <div className="space-y-6">
              <div className="flex items-center justify-between py-4 border-b">
                <div className="space-y-0.5">
                  <Label htmlFor="email-notif" className="text-base font-medium cursor-pointer">
                    Notificaciones por correo
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Recibe actualizaciones importantes por email
                  </p>
                </div>
                <Switch
                  id="email-notif"
                  checked={preferences.emailNotifications}
                  onCheckedChange={() => handlePreferenceChange('emailNotifications')}
                />
              </div>

              <div className="flex items-center justify-between py-4 border-b">
                <div className="space-y-0.5">
                  <Label htmlFor="order-alerts" className="text-base font-medium cursor-pointer">
                    Alertas de pedidos
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Notificaciones sobre nuevos pedidos y cambios de estado
                  </p>
                </div>
                <Switch
                  id="order-alerts"
                  checked={preferences.orderAlerts}
                  onCheckedChange={() => handlePreferenceChange('orderAlerts')}
                />
              </div>

              <div className="flex items-center justify-between py-4 border-b">
                <div className="space-y-0.5">
                  <Label htmlFor="marketing" className="text-base font-medium cursor-pointer">
                    Emails de marketing
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Recibe tips, novedades y ofertas especiales
                  </p>
                </div>
                <Switch
                  id="marketing"
                  checked={preferences.marketingEmails}
                  onCheckedChange={() => handlePreferenceChange('marketingEmails')}
                />
              </div>

              <div className="flex items-center justify-between py-4">
                <div className="space-y-0.5">
                  <Label htmlFor="dark-mode" className="text-base font-medium cursor-pointer">
                    Modo oscuro
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Cambia entre tema claro y oscuro
                  </p>
                </div>
                <Switch
                  id="dark-mode"
                  checked={theme === 'dark'}
                  onCheckedChange={() => {
                    toggleTheme();
                    toast({
                      title: "Tema actualizado",
                      description: `Modo ${theme === 'light' ? 'oscuro' : 'claro'} activado.`,
                    });
                  }}
                />
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-6">Seguridad</h2>

            <div className="space-y-6">
              {/* Change Password */}
              <div>
                <Label className="text-base font-medium mb-2">Contraseña</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Cambia tu contraseña regularmente para mantener tu cuenta segura
                </p>
                <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">Cambiar contraseña</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cambiar contraseña</DialogTitle>
                      <DialogDescription>
                        Ingresa tu contraseña actual y elige una nueva contraseña segura.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="current-password">Contraseña actual</Label>
                        <div className="relative">
                          <Input
                            id="current-password"
                            type={showCurrentPassword ? 'text' : 'password'}
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                            placeholder="Ingresa tu contraseña actual"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                          >
                            {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-password">Nueva contraseña</Label>
                        <div className="relative">
                          <Input
                            id="new-password"
                            type={showNewPassword ? 'text' : 'password'}
                            value={passwordData.newPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                            placeholder="Mínimo 6 caracteres"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                          >
                            {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirmar nueva contraseña</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          placeholder="Repite la nueva contraseña"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                        Cancelar
                      </Button>
                      <Button onClick={handleChangePassword} disabled={isChangingPassword}>
                        {isChangingPassword ? 'Cambiando...' : 'Cambiar contraseña'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Logout */}
              <div className="pt-6 border-t">
                <Label className="text-base font-medium mb-2">Cerrar sesión</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Cierra tu sesión actual en este dispositivo
                </p>
                <Button variant="outline" onClick={handleLogout} className="gap-2">
                  <LogOut size={16} />
                  Cerrar sesión
                </Button>
              </div>

              {/* 2FA (Coming Soon) */}
              <div className="pt-6 border-t">
                <Label className="text-base font-medium mb-2">Autenticación de dos factores</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Agrega una capa extra de seguridad a tu cuenta (próximamente)
                </p>
                <Button variant="outline" disabled>Configurar 2FA</Button>
              </div>

              {/* Danger Zone - Delete Account */}
              <div className="pt-6 border-t">
                <Label className="text-base font-medium mb-2 text-destructive">Zona de peligro</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Esta acción es permanente y no se puede deshacer. Todos tus datos serán eliminados.
                </p>
                <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="destructive">Eliminar cuenta</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>¿Estás absolutamente seguro?</DialogTitle>
                      <DialogDescription>
                        Esta acción no se puede deshacer. Esto eliminará permanentemente tu cuenta y todos los datos asociados.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                        <div className="flex gap-3">
                          <AlertCircle className="text-destructive flex-shrink-0 mt-0.5" size={20} />
                          <div className="space-y-2 text-sm">
                            <p className="font-semibold text-destructive">
                              Advertencia: Esta acción es irreversible
                            </p>
                            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                              <li>Se eliminarán todos tus pedidos</li>
                              <li>Se eliminarán todos tus productos</li>
                              <li>Se eliminarán todas tus tiendas</li>
                              <li>Perderás acceso a todas las integraciones</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="delete-password">
                          Para confirmar, ingresa tu contraseña
                        </Label>
                        <div className="relative">
                          <Input
                            id="delete-password"
                            type={showDeletePassword ? 'text' : 'password'}
                            value={deletePassword}
                            onChange={(e) => setDeletePassword(e.target.value)}
                            placeholder="Ingresa tu contraseña"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                            onClick={() => setShowDeletePassword(!showDeletePassword)}
                          >
                            {showDeletePassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                        Cancelar
                      </Button>
                      <Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeletingAccount}>
                        {isDeletingAccount ? 'Eliminando...' : 'Sí, eliminar mi cuenta'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
