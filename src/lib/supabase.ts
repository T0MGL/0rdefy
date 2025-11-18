/**
 * Supabase Client for Frontend
 *
 * IMPORTANT: This uses SUPABASE_ANON_KEY which respects RLS policies
 * DO NOT use SERVICE_ROLE_KEY in frontend code - it's a security risk
 */

import { createClient } from '@supabase/supabase-js';

// Environment variables - set these in your .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('FATAL: VITE_SUPABASE_URL environment variable is required');
}
if (!supabaseAnonKey) {
  throw new Error('FATAL: VITE_SUPABASE_ANON_KEY environment variable is required');
}

// Create a single supabase client for the entire app
// This client respects Row Level Security (RLS) policies
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'ordefy_auth',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

/**
 * Initialize Supabase auth from localStorage token
 * Call this on app startup
 */
export function initSupabaseAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) {
    // Set the session from JWT token
    supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    });
  }
}

// Initialize auth on module load
initSupabaseAuth();

export default supabase;
