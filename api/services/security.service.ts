import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';

// Device info parser utilities
interface DeviceInfo {
  device: string;
  browser: string;
  os: string;
  version: string;
}

function parseUserAgent(userAgent: string): DeviceInfo {
  const ua = userAgent.toLowerCase();

  // Detect device type
  let device = 'Desktop';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    device = 'Tablet';
  } else if (/mobile|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    device = 'Mobile';
  }

  // Detect browser
  let browser = 'Unknown';
  if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('safari')) browser = 'Safari';
  else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

  // Detect OS
  let os = 'Unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  // Extract version (simplified)
  let version = '';
  const versionMatch = userAgent.match(/(?:Chrome|Firefox|Safari|Edge)\/(\d+\.\d+)/);
  if (versionMatch) version = versionMatch[1];

  return { device, browser, os, version };
}

// Hash JWT token for storage (one-way hash)
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ============================================
// SESSION MANAGEMENT
// ============================================

interface CreateSessionParams {
  userId: string;
  token: string;
  ipAddress: string;
  userAgent: string;
  expiresAt: Date;
}

export async function createSession(params: CreateSessionParams) {
  const { userId, token, ipAddress, userAgent, expiresAt } = params;

  const tokenHash = hashToken(token);
  const deviceInfo = parseUserAgent(userAgent);

  const { data, error } = await supabaseAdmin
    .from('user_sessions')
    .insert({
      user_id: userId,
      token_hash: tokenHash,
      device_info: deviceInfo,
      ip_address: ipAddress,
      expires_at: expiresAt.toISOString(),
      is_active: true
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSessionActivity(token: string) {
  const tokenHash = hashToken(token);

  const { error } = await supabaseAdmin
    .from('user_sessions')
    .update({ last_activity: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .eq('is_active', true);

  if (error) throw error;
}

export async function getUserSessions(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .gte('expires_at', new Date().toISOString())
    .order('last_activity', { ascending: false });

  if (error) throw error;

  // Don't expose token_hash to frontend
  return data.map(session => ({
    id: session.id,
    deviceInfo: session.device_info,
    ipAddress: session.ip_address,
    lastActivity: session.last_activity,
    createdAt: session.created_at,
    expiresAt: session.expires_at
  }));
}

export async function terminateSession(sessionId: string, userId: string) {
  const { error } = await supabaseAdmin
    .from('user_sessions')
    .update({ is_active: false })
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function terminateAllSessions(userId: string, exceptToken?: string) {
  let query = supabaseAdmin
    .from('user_sessions')
    .update({ is_active: false })
    .eq('user_id', userId);

  // Don't terminate current session
  if (exceptToken) {
    const tokenHash = hashToken(exceptToken);
    query = query.neq('token_hash', tokenHash);
  }

  const { error } = await query;
  if (error) throw error;
}

export async function terminateSessionByToken(token: string) {
  const tokenHash = hashToken(token);

  const { error } = await supabaseAdmin
    .from('user_sessions')
    .update({ is_active: false })
    .eq('token_hash', tokenHash);

  if (error) throw error;
}

export async function getSessionByToken(token: string) {
  const tokenHash = hashToken(token);

  const { data, error } = await supabaseAdmin
    .from('user_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .single();

  if (error) return null;
  return data;
}

// ============================================
// ACTIVITY LOGGING
// ============================================

interface LogActivityParams {
  userId: string;
  storeId?: string;
  actionType: string;
  description: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}

export async function logActivity(params: LogActivityParams) {
  const { userId, storeId, actionType, description, metadata, ipAddress, userAgent } = params;

  const { data, error } = await supabaseAdmin
    .from('activity_log')
    .insert({
      user_id: userId,
      store_id: storeId || null,
      action_type: actionType,
      description,
      metadata: metadata || {},
      ip_address: ipAddress || null,
      user_agent: userAgent || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserActivity(userId: string, limit = 50, offset = 0) {
  const { data, error } = await supabaseAdmin
    .from('activity_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data;
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

export async function logLogin(userId: string, ipAddress: string, userAgent: string, success: boolean = true) {
  const deviceInfo = parseUserAgent(userAgent);

  await logActivity({
    userId,
    actionType: success ? 'login' : 'failed_login',
    description: success
      ? `Inicio de sesión desde ${deviceInfo.device} (${deviceInfo.browser})`
      : `Intento de inicio de sesión fallido desde ${deviceInfo.device}`,
    metadata: { deviceInfo },
    ipAddress,
    userAgent
  });
}

export async function logLogout(userId: string, ipAddress: string, userAgent: string) {
  await logActivity({
    userId,
    actionType: 'logout',
    description: 'Usuario cerró sesión',
    ipAddress,
    userAgent
  });
}

export async function logPasswordChange(userId: string, ipAddress: string, userAgent: string) {
  await logActivity({
    userId,
    actionType: 'password_change',
    description: 'Contraseña cambiada exitosamente',
    ipAddress,
    userAgent
  });
}

export async function logAccountDeleted(userId: string, ipAddress: string, userAgent: string) {
  await logActivity({
    userId,
    actionType: 'account_deleted',
    description: 'Cuenta de usuario eliminada',
    ipAddress,
    userAgent
  });
}
