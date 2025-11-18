// ================================================================
// NEONFLOW - DATABASE CONNECTION MODULE
// ================================================================
// DUAL CLIENT ARCHITECTURE:
// 1. supabase (ANON_KEY) - For user-facing operations, respects RLS
// 2. supabaseAdmin (SERVICE_ROLE_KEY) - For system operations, bypasses RLS
// ================================================================
// SECURITY RULES:
// - Use `supabase` for all authenticated user requests
// - Use `supabaseAdmin` ONLY for webhooks and system operations
// - Never expose SERVICE_ROLE_KEY to frontend
// - RLS is the primary security layer, backend validation is secondary
// ================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// ================================================================
// ENVIRONMENT VARIABLES
// ================================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validation - require all environment variables
if (!SUPABASE_URL) {
    throw new Error('FATAL: SUPABASE_URL environment variable is required');
}
if (!SUPABASE_ANON_KEY) {
    throw new Error('FATAL: SUPABASE_ANON_KEY environment variable is required');
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('FATAL: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

// ================================================================
// REGULAR CLIENT (ANON KEY) - RESPECTS RLS
// ================================================================
// Use this client for all user-facing API operations
// It respects Row Level Security policies
// JWT token must be set via setAuth() before each request
// ================================================================

export const supabase: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        },
        db: {
            schema: 'public'
        }
    }
);

console.log('✅ Supabase client (ANON) initialized:', SUPABASE_URL);

// ================================================================
// ADMIN CLIENT (SERVICE ROLE KEY) - BYPASSES RLS
// ================================================================
// ⚠️ DANGER: This client has FULL DATABASE ACCESS
// Use ONLY for:
// - Webhook handlers (Shopify, n8n, WhatsApp)
// - System background jobs
// - Administrative operations that need to bypass RLS
//
// NEVER use this client for regular user requests!
// ================================================================

export const supabaseAdmin: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        },
        db: {
            schema: 'public'
        }
    }
);

console.log('✅ Supabase admin client (SERVICE_ROLE) initialized:', SUPABASE_URL);

// Test Supabase connection
(async () => {
    try {
        const { data, error } = await supabase.from('stores').select('count').limit(1);
        if (error) {
            console.warn('⚠️  Supabase connection test warning:', error.message);
        } else {
            console.log('✅ Supabase connection test successful');
        }
    } catch (err) {
        console.error('❌ Supabase connection test failed:', err);
    }
})();

// ================================================================
// HELPER FUNCTIONS
// ================================================================

/**
 * Get store by ID
 */
export async function getStore(storeId: string) {
    const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .eq('is_active', true)
        .single();

    if (error) {
        console.error('Error fetching store:', error);
        return null;
    }
    return data;
}

/**
 * Get store configuration
 */
export async function getStoreConfig(storeId: string) {
    const { data, error } = await supabase
        .from('store_config')
        .select('*')
        .eq('store_id', storeId)
        .single();

    if (error) {
        console.error('Error fetching store config:', error);
        return null;
    }
    return data;
}

/**
 * Check if store exists and is active
 */
export async function validateStore(storeId: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('stores')
        .select('id')
        .eq('id', storeId)
        .eq('is_active', true)
        .single();

    return !error && !!data;
}

// ================================================================
// HELPER: Set JWT for authenticated requests
// ================================================================
/**
 * Set the user's JWT token for the regular client
 * This must be called before any authenticated request
 * The token is extracted from the Authorization header
 */
export function setSupabaseAuth(token: string) {
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace('Bearer ', '');
    // Set global auth for this client instance
    supabase.rest.headers = {
        ...supabase.rest.headers,
        Authorization: `Bearer ${cleanToken}`
    };
}

// ================================================================
// EXPORTS
// ================================================================

export default {
    supabase,
    supabaseAdmin,
    setSupabaseAuth,
    getStore,
    getStoreConfig,
    validateStore
};
