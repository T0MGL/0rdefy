import api from './api.client';

// ============================================
// TYPESCRIPT INTERFACES
// ============================================

export interface DeviceInfo {
  device: string;
  browser: string;
  os: string;
  version: string;
}

export interface UserSession {
  id: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  lastActivity: string;
  createdAt: string;
  expiresAt: string;
  isCurrent?: boolean;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  store_id: string | null;
  action_type: string;
  description: string;
  metadata: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface GetSessionsResponse {
  success: boolean;
  data: UserSession[];
}

export interface GetActivityResponse {
  success: boolean;
  data: ActivityLog[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// ============================================
// SESSION MANAGEMENT
// ============================================

/**
 * Get all active sessions for the current user
 */
export async function getSessions(): Promise<UserSession[]> {
  const response = await api.get<GetSessionsResponse>('/security/sessions');
  return response.data.data;
}

/**
 * Terminate a specific session by ID
 */
export async function terminateSession(sessionId: string): Promise<void> {
  await api.delete<ApiResponse>(`/security/sessions/${sessionId}`);
}

/**
 * Terminate all sessions except the current one
 */
export async function terminateAllOtherSessions(): Promise<void> {
  await api.delete<ApiResponse>('/security/sessions');
}

// ============================================
// ACTIVITY LOG
// ============================================

/**
 * Get activity log for the current user
 */
export async function getActivity(limit = 50, offset = 0): Promise<GetActivityResponse> {
  const response = await api.get<GetActivityResponse>('/security/activity', {
    params: { limit, offset }
  });
  return response.data;
}

/**
 * Get recent critical activities (last 10)
 */
export async function getRecentActivity(): Promise<ActivityLog[]> {
  const response = await api.get<{ success: boolean; data: ActivityLog[] }>('/security/activity/recent');
  return response.data.data;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Format device info into a readable string
 */
export function formatDeviceInfo(deviceInfo: DeviceInfo): string {
  const { device, browser, os, version } = deviceInfo;

  if (device === 'Mobile') {
    return `${browser} en ${os} (Móvil)`;
  } else if (device === 'Tablet') {
    return `${browser} en ${os} (Tablet)`;
  } else {
    return `${browser} ${version ? `v${version}` : ''} en ${os}`;
  }
}

/**
 * Format activity action type into a readable string
 */
export function formatActionType(actionType: string): string {
  const actionTypeMap: Record<string, string> = {
    login: 'Inicio de sesión',
    logout: 'Cierre de sesión',
    logout_all: 'Cierre de todas las sesiones',
    session_terminated: 'Sesión terminada',
    password_change: 'Cambio de contraseña',
    password_reset: 'Restablecimiento de contraseña',
    email_change: 'Cambio de correo electrónico',
    account_deleted: 'Cuenta eliminada',
    store_created: 'Tienda creada',
    store_deleted: 'Tienda eliminada',
    store_settings_updated: 'Configuración de tienda actualizada',
    user_settings_updated: 'Configuración de usuario actualizada',
    integration_connected: 'Integración conectada',
    integration_disconnected: 'Integración desconectada',
    failed_login: 'Intento de inicio de sesión fallido',
    suspicious_activity: 'Actividad sospechosa detectada'
  };

  return actionTypeMap[actionType] || actionType;
}

/**
 * Get icon for activity type
 */
export function getActivityIcon(actionType: string): string {
  const iconMap: Record<string, string> = {
    login: '🔐',
    logout: '🚪',
    logout_all: '🚪',
    session_terminated: '❌',
    password_change: '🔑',
    password_reset: '🔓',
    email_change: '📧',
    account_deleted: '🗑️',
    store_created: '🏪',
    store_deleted: '🗑️',
    store_settings_updated: '⚙️',
    user_settings_updated: '⚙️',
    integration_connected: '🔌',
    integration_disconnected: '🔌',
    failed_login: '⚠️',
    suspicious_activity: '🚨'
  };

  return iconMap[actionType] || '📋';
}

/**
 * Determine if an activity is critical (requires attention)
 */
export function isCriticalActivity(actionType: string): boolean {
  const criticalTypes = [
    'failed_login',
    'suspicious_activity',
    'session_terminated',
    'password_change',
    'email_change',
    'account_deleted'
  ];

  return criticalTypes.includes(actionType);
}

/**
 * Format relative time from timestamp
 */
export function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'Hace unos segundos';
  } else if (diffMins < 60) {
    return `Hace ${diffMins} ${diffMins === 1 ? 'minuto' : 'minutos'}`;
  } else if (diffHours < 24) {
    return `Hace ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
  } else if (diffDays < 7) {
    return `Hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
  } else {
    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }
}

export default {
  getSessions,
  terminateSession,
  terminateAllOtherSessions,
  getActivity,
  getRecentActivity,
  formatDeviceInfo,
  formatActionType,
  getActivityIcon,
  isCriticalActivity,
  formatRelativeTime
};
