/**
 * TeamManagement Component
 *
 * Componente para gestionar colaboradores e invitaciones del equipo.
 * - Owners: Pueden ver miembros, invitar colaboradores, y eliminar miembros
 * - Colaboradores (admin, etc.): Solo pueden ver la lista de miembros activos
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  UserPlus,
  Copy,
  CheckCircle2,
  XCircle,
  Trash2,
  Crown,
  Shield,
  Truck,
  UserCheck,
  Calculator,
  Package,
  AlertCircle,
  MessageCircle,
  Mail,
  Link2,
  Sparkles
} from 'lucide-react';
import apiClient from '@/services/api.client';
import { useAuth } from '@/contexts/AuthContext';
import type { CollaboratorStats, CollaboratorInvitation, TeamMember } from '@/types';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  logistics: 'Logística',
  confirmador: 'Confirmador',
  contador: 'Contador',
  inventario: 'Inventario'
};

const ROLE_ICONS: Record<string, any> = {
  owner: Crown,
  admin: Shield,
  logistics: Truck,
  confirmador: UserCheck,
  contador: Calculator,
  inventario: Package
};

const ROLE_COLORS: Record<string, string> = {
  owner: 'text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/20',
  admin: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/20',
  logistics: 'text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/20',
  confirmador: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/20',
  contador: 'text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/20',
  inventario: 'text-pink-600 bg-pink-100 dark:text-pink-400 dark:bg-pink-900/20'
};

export function TeamManagement() {
  const queryClient = useQueryClient();
  const { user, currentStore } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);

  // Check if current user is the owner
  const isOwner = currentStore?.role === 'owner';
  const currentUserId = user?.id;
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [inviteData, setInviteData] = useState({
    name: '',
    email: '',
    role: 'confirmador'
  });
  const [inviteUrl, setInviteUrl] = useState('');

  // Fetch stats
  const { data: stats } = useQuery<CollaboratorStats>({
    queryKey: ['collaborators', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get('/collaborators/stats');
      return res.data;
    }
  });

  // Fetch members
  const { data: membersData, isLoading: loadingMembers } = useQuery<{ members: TeamMember[] }>({
    queryKey: ['collaborators'],
    queryFn: async () => {
      const res = await apiClient.get('/collaborators');
      return res.data;
    }
  });

  // Fetch invitations
  const { data: invitationsData } = useQuery<{ invitations: CollaboratorInvitation[] }>({
    queryKey: ['collaborators', 'invitations'],
    queryFn: async () => {
      const res = await apiClient.get('/collaborators/invitations');
      return res.data;
    }
  });

  // Create invitation mutation
  const createInvitation = useMutation({
    mutationFn: async (data: typeof inviteData) => {
      const res = await apiClient.post('/collaborators/invite', data);
      return res.data;
    },
    onSuccess: (data) => {
      setInviteUrl(data.invitation.inviteUrl);
      queryClient.invalidateQueries({ queryKey: ['collaborators', 'invitations'] });
      queryClient.invalidateQueries({ queryKey: ['collaborators', 'stats'] });
    }
  });

  // Remove member mutation
  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.delete(`/collaborators/${userId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators'] });
      queryClient.invalidateQueries({ queryKey: ['collaborators', 'stats'] });
    },
    onError: (error: any) => {
      console.error('[TeamManagement] Error removing member:', error);
      alert(`Error al remover colaborador: ${error?.response?.data?.error || error.message}`);
    }
  });

  // Cancel invitation mutation
  const cancelInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      await apiClient.delete(`/collaborators/invitations/${invitationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators', 'invitations'] });
      queryClient.invalidateQueries({ queryKey: ['collaborators', 'stats'] });
    }
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    createInvitation.mutate(inviteData);
  };

  const copyInviteUrl = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const closeInviteDialog = () => {
    setInviteOpen(false);
    setInviteUrl('');
    setInviteData({ name: '', email: '', role: 'confirmador' });
    setCopiedUrl(false);
    setCopiedWhatsApp(false);
    setCopiedEmail(false);
    createInvitation.reset();
  };

  const getWhatsAppMessage = () => {
    return `¡Hola ${inviteData.name}! 👋

Te invito a colaborar en mi tienda en Ordefy.

Haz clic aquí para aceptar:
${inviteUrl}

(El link expira en 7 días)`;
  };

  const getEmailMessage = () => {
    return `¡Hola ${inviteData.name}!

Te invito a colaborar en mi tienda en Ordefy.

Haz clic en el siguiente link para aceptar:
${inviteUrl}

(El link expira en 7 días)`;
  };

  const copyWhatsAppMessage = () => {
    navigator.clipboard.writeText(getWhatsAppMessage());
    setCopiedWhatsApp(true);
    setTimeout(() => setCopiedWhatsApp(false), 2000);
  };

  const copyEmailMessage = () => {
    navigator.clipboard.writeText(getEmailMessage());
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const canAddUsers = stats?.can_add_more ?? true;

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Equipo</CardTitle>
            <CardDescription>
              {stats && (
                <>
                  {stats.current_users} de {stats.max_users === -1 ? '∞' : stats.max_users} usuarios
                  {' '}·{' '}
                  Plan <Badge variant="outline" className="ml-1">{stats.plan}</Badge>
                </>
              )}
            </CardDescription>
          </div>

          {/* Only owners can invite new members */}
          {isOwner && (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button disabled={!canAddUsers}>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Invitar
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invitar Colaborador</DialogTitle>
                <DialogDescription>
                  Crea una invitación y comparte el link por WhatsApp o Email
                </DialogDescription>
              </DialogHeader>

              {!inviteUrl ? (
                <form onSubmit={handleInvite} className="space-y-4">
                  <div>
                    <Label htmlFor="name">Nombre Completo</Label>
                    <Input
                      id="name"
                      value={inviteData.name}
                      onChange={(e) => setInviteData({ ...inviteData, name: e.target.value })}
                      placeholder="Ej: Juan Pérez"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={inviteData.email}
                      onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                      placeholder="ejemplo@email.com"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="role">Rol</Label>
                    <Select
                      value={inviteData.role}
                      onValueChange={(value) => setInviteData({ ...inviteData, role: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="confirmador">Confirmador - Órdenes y Customers</SelectItem>
                        <SelectItem value="logistics">Logística - Warehouse y Returns</SelectItem>
                        <SelectItem value="contador">Contador - Analytics y Reportes</SelectItem>
                        <SelectItem value="inventario">Inventario - Products y Suppliers</SelectItem>
                        <SelectItem value="admin">Administrador - Acceso Completo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {createInvitation.isError && (
                    <Alert variant="destructive">
                      <AlertCircle className="w-4 h-4" />
                      <AlertDescription>
                        {(createInvitation.error as any)?.response?.data?.error || 'Error al crear invitación'}
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button type="submit" className="w-full" disabled={createInvitation.isPending}>
                    {createInvitation.isPending ? 'Creando...' : 'Crear Invitación'}
                  </Button>
                </form>
              ) : (
                <div className="space-y-5">
                  {/* Success Banner */}
                  <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 text-center space-y-2">
                    <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      ¡Invitación creada!
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      Comparte el link con <strong>{inviteData.name}</strong>
                    </p>
                  </div>

                  {/* Invite Link Card */}
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Link2 className="w-4 h-4" />
                      <span>Link de invitación</span>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={inviteUrl}
                        readOnly
                        className="font-mono text-xs bg-background"
                      />
                      <Button
                        onClick={copyInviteUrl}
                        variant={copiedUrl ? "default" : "outline"}
                        size="icon"
                        className={copiedUrl ? "bg-green-600 hover:bg-green-700" : ""}
                      >
                        {copiedUrl ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                    {copiedUrl && (
                      <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        ¡Link copiado al portapapeles!
                      </p>
                    )}
                  </div>

                  {/* Share Buttons */}
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground text-center">Copiar mensaje para:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        className={`w-full ${copiedWhatsApp
                          ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                          : 'bg-green-50 hover:bg-green-100 border-green-200 text-green-700 dark:bg-green-950/30 dark:hover:bg-green-950/50 dark:border-green-800 dark:text-green-400'}`}
                        onClick={copyWhatsAppMessage}
                      >
                        {copiedWhatsApp ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            ¡Copiado!
                          </>
                        ) : (
                          <>
                            <MessageCircle className="w-4 h-4 mr-2" />
                            WhatsApp
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        className={`w-full ${copiedEmail
                          ? 'bg-primary hover:bg-primary/90 text-white border-primary'
                          : ''}`}
                        onClick={copyEmailMessage}
                      >
                        {copiedEmail ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            ¡Copiado!
                          </>
                        ) : (
                          <>
                            <Mail className="w-4 h-4 mr-2" />
                            Email
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <Button onClick={closeInviteDialog} className="w-full" variant="outline">
                    Cerrar
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          )}
        </CardHeader>

        {isOwner && !canAddUsers && (
          <CardContent>
            <Alert>
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                Has alcanzado el límite de usuarios de tu plan. Actualiza tu suscripción para invitar más colaboradores.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle>Miembros Activos ({membersData?.members?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingMembers ? (
            <p className="text-center text-gray-500 py-8">Cargando miembros...</p>
          ) : membersData?.members?.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No hay miembros en el equipo</p>
          ) : (
            <div className="space-y-3">
              {membersData?.members.map((member) => {
                const RoleIcon = ROLE_ICONS[member.role] || Shield;
                const roleColor = ROLE_COLORS[member.role] || ROLE_COLORS.admin;
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full ${roleColor} flex items-center justify-center`}>
                        <RoleIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-medium">{member.name}</div>
                        <div className="text-sm text-muted-foreground">{member.email}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                      {/* Only owner can remove members, and cannot remove themselves or other owners */}
                      {isOwner && member.role !== 'owner' && member.id !== currentUserId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (confirm(`¿Remover a ${member.name} del equipo?`)) {
                              try {
                                await removeMember.mutateAsync(member.id);
                                alert(`${member.name} ha sido removido del equipo`);
                              } catch (error) {
                                // Error handling is in onError callback
                              }
                            }
                          }}
                          disabled={removeMember.isPending}
                        >
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations Only - Only visible to owners */}
      {isOwner && invitationsData?.invitations && invitationsData.invitations.filter(inv => inv.status === 'pending').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invitaciones Pendientes ({invitationsData.invitations.filter(inv => inv.status === 'pending').length})</CardTitle>
            <CardDescription>
              Invitaciones enviadas que aún no han sido aceptadas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invitationsData.invitations
                .filter(invitation => invitation.status === 'pending')
                .map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div>
                        <div className="font-medium">{invitation.name}</div>
                        <div className="text-sm text-muted-foreground">{invitation.email}</div>
                        <div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                          Expira el {new Date(invitation.expiresAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{ROLE_LABELS[invitation.role]}</Badge>

                      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                        Pendiente
                      </Badge>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`¿Cancelar la invitación para ${invitation.name}?`)) {
                            cancelInvitation.mutate(invitation.id);
                          }
                        }}
                        disabled={cancelInvitation.isPending}
                      >
                        <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
