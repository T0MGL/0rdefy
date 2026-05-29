/**
 * Carrier Operators Service (admin-side)
 *
 * Wraps the /api/carriers/:carrierId/operators surface used by the
 * "Operadores" tab in the carrier detail page. The service mirrors the
 * shape of carriers.service.ts so the rest of the app can swap it in
 * without surprises.
 *
 * Notes:
 *   - Network errors throw with a useful message; the caller is
 *     expected to render a toast.
 *   - We never log the API token or full email/phone client-side; PII
 *     stays in the server logs.
 *   - The service does NOT add credentials beyond the standard header
 *     pair (Authorization + X-Store-ID), which matches what
 *     carriers.service.ts does.
 */

import { config } from '@/config';
import { getActiveStoreId } from '@/lib/activeStore';

let API_URL = config.api.baseUrl;
API_URL = API_URL.trim().replace(/(\/api\/?)+$/i, '').replace(/\/+$/, '');

function getHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  const storeId = getActiveStoreId();
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (storeId) headers['X-Store-ID'] = storeId;
  return headers;
}

async function request<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { ...getHeaders(), ...(init?.headers || {}) },
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // body is not JSON; let res.ok be the source of truth
  }

  if (!res.ok) {
    const message =
      payload?.message || payload?.error || `Error ${res.status}`;
    const error = new Error(message) as Error & {
      status?: number;
      payload?: unknown;
    };
    error.status = res.status;
    error.payload = payload;
    throw error;
  }

  return payload as T;
}

// --- Types ----------------------------------------------------------------

export interface CarrierOperatorActive {
  user_id: string;
  email: string;
  name: string;
  phone: string | null;
  invited_at: string | null;
  last_active_at: string | null;
  days_since_active: number | null;
  created_at: string;
}

export interface CarrierOperatorPending {
  id: string;
  email: string;
  name: string;
  invited_at: string;
  expires_at: string;
  days_until_expiry: number;
  invited_by: string | null;
  invited_by_email: string | null;
}

export interface CarrierOperatorsList {
  carrier: { id: string; name: string };
  active: CarrierOperatorActive[];
  pending: CarrierOperatorPending[];
}

export interface CarrierOperatorInviteInput {
  email: string;
  name: string;
  phone?: string;
}

export interface CarrierOperatorInviteResult {
  already_pending: boolean;
  invitation: {
    id: string;
    email: string;
    name: string;
    expires_at: string;
    created_at: string;
  };
  link?: string;
  email_sent: boolean;
  email_error?: string;
}

export interface CarrierOperatorResendResult {
  success: true;
  email_sent: boolean;
  link: string;
  email_error?: string;
}

// --- API ------------------------------------------------------------------

export const carrierOperatorsService = {
  /**
   * List active operators + pending invitations for a carrier.
   * Throws on network or server failure.
   */
  async list(
    carrierId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<CarrierOperatorsList> {
    return request<CarrierOperatorsList>(
      `/carriers/${encodeURIComponent(carrierId)}/operators`,
      { method: 'GET', signal: opts?.signal },
    );
  },

  /**
   * Create a courier invitation. Idempotent: if a pending invite for
   * the same (email, carrier) exists, returns it with already_pending=true.
   */
  async invite(
    carrierId: string,
    input: CarrierOperatorInviteInput,
  ): Promise<CarrierOperatorInviteResult> {
    return request<CarrierOperatorInviteResult>(
      `/carriers/${encodeURIComponent(carrierId)}/operators/invite`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },

  /** Soft-revoke an active courier from this carrier+store. */
  async revoke(carrierId: string, userId: string): Promise<{ success: true }> {
    return request<{ success: true }>(
      `/carriers/${encodeURIComponent(carrierId)}/operators/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  },

  /** Cancel a pending courier invitation. */
  async cancelInvitation(
    carrierId: string,
    invitationId: string,
  ): Promise<{ success: true }> {
    return request<{ success: true }>(
      `/carriers/${encodeURIComponent(carrierId)}/operators/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' },
    );
  },

  /**
   * Resend the invitation email for a pending invitation.
   * Server enforces a 5-minute throttle per invitation.
   */
  async resendInvitation(
    carrierId: string,
    invitationId: string,
  ): Promise<CarrierOperatorResendResult> {
    return request<CarrierOperatorResendResult>(
      `/carriers/${encodeURIComponent(carrierId)}/operators/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: 'POST' },
    );
  },
};
