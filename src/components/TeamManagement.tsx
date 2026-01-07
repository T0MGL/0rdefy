/**
 * TeamManagement Component
 *
 * Componente para gestionar colaboradores e invitaciones del equipo.
 * Solo accesible para owners.
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
  AlertCircle
} from 'lucide-react';
import apiClient from '@/services/api.client';
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
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
    createInvitation.reset();
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
                <div className="space-y-4">
                  <Alert>
                    <CheckCircle2 className="w-4 h-4" />
                    <AlertDescription>
                      Invitación creada. Copia el link y envíalo por WhatsApp o Email.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-2">
                    <Label>Link de Invitación</Label>
                    <div className="flex gap-2">
                      <Input value={inviteUrl} readOnly className="font-mono text-xs" />
                      <Button onClick={copyInviteUrl} variant="outline" size="icon">
                        {copiedUrl ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                    {copiedUrl && (
                      <p className="text-xs text-green-600 dark:text-green-400">Link copiado al portapapeles</p>
                    )}
                  </div>

                  <Button onClick={closeInviteDialog} className="w-full" variant="outline">
                    Cerrar
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </CardHeader>

        {!canAddUsers && (
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
                      {member.role !== 'owner' && (
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

      {/* All Invitations */}
      {invitationsData?.invitations && invitationsData.invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invitaciones ({invitationsData.invitations.length})</CardTitle>
            <CardDescription>
              Gestiona todas las invitaciones enviadas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invitationsData.invitations.map((invitation) => {
                const isPending = invitation.status === 'pending';
                const isExpired = invitation.status === 'expired';
                const isUsed = invitation.status === 'used';

                return (
                  <div
                    key={invitation.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      isUsed ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' :
                      isExpired ? 'bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800 opacity-60' :
                      'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div>
                        <div className="font-medium">{invitation.name}</div>
                        <div className="text-sm text-muted-foreground">{invitation.email}</div>
                        {isUsed && invitation.usedAt && (
                          <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                            Aceptada el {new Date(invitation.usedAt).toLocaleDateString()}
                          </div>
                        )}
                        {isExpired && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            Expiró el {new Date(invitation.expiresAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{ROLE_LABELS[invitation.role]}</Badge>

                      {isPending && (
                        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                          Pendiente
                        </Badge>
                      )}
                      {isExpired && (
                        <Badge variant="secondary" className="text-gray-600">
                          Expirada
                        </Badge>
                      )}
                      {isUsed && (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Aceptada
                        </Badge>
                      )}

                      {isPending && (
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
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
