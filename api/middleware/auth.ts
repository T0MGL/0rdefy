import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../db/connection';

// JWT Configuration Constants
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
}

// Shopify App Secret for session token validation
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;

if (!SHOPIFY_API_KEY) {
  console.warn('WARNING: SHOPIFY_API_KEY environment variable is not set. Shopify session token validation will fail.');
}

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'ordefy-api';
const JWT_AUDIENCE = 'ordefy-app';
const JWT_CLOCK_TOLERANCE = 30; // 30 seconds tolerance for clock skew

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email: string;
    stores: Array<{ id: string; name: string; role: string }>;
  };
  storeId?: string;
  shopifySession?: {
    dest: string; // shop domain
    aud: string; // API key
    sub: string; // user ID
    exp: number;
    nbf: number;
    iat: number;
    jti: string;
    sid: string;
  };
}

/**
 * Verifica un token de sesión de Shopify
 * Los tokens de sesión son JWTs firmados con el App Secret
 */
function verifyShopifySessionToken(token: string): any {
  if (!SHOPIFY_API_SECRET) {
    throw new Error('SHOPIFY_API_SECRET not configured');
  }

  try {
    // Shopify session tokens use HS256 with the app secret
    const decoded = jwt.verify(token, SHOPIFY_API_SECRET, {
      algorithms: ['HS256'],
      audience: SHOPIFY_API_KEY, // aud should be the API key
    }) as any;

    // Validate required Shopify claims
    if (!decoded.dest || !decoded.sub || !decoded.aud) {
      throw new Error('Invalid Shopify session token claims');
    }

    // Verify the audience matches our API key
    if (decoded.aud !== SHOPIFY_API_KEY) {
      throw new Error('Invalid API key in session token');
    }

    return decoded;
  } catch (error: any) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Shopify session token verification failed:', error.message);
    }
    throw error;
  }
}

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const token = authHeader.substring(7);
  const isShopifySession = req.headers['x-shopify-session'] === 'true';

  try {
    // Si es un token de sesión de Shopify, usar validación de Shopify
    if (isShopifySession) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth] Verifying Shopify session token');
      }

      const decoded = verifyShopifySessionToken(token);
      req.shopifySession = decoded;

      // Para tokens de Shopify, necesitamos obtener o crear el usuario en nuestra DB
      // usando el shop domain (decoded.dest) como identificador
      // Por ahora, extraemos la información básica

      // El 'sub' en Shopify session tokens es el user ID de Shopify
      // El 'dest' es el shop domain (ej: mystore.myshopify.com)

      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth] Shopify session validated:', {
          shop: decoded.dest,
          userId: decoded.sub,
        });
      }

      // Aquí deberías buscar o crear el usuario en tu base de datos
      // basándote en el shop domain. Por ahora, pasamos el token validado.

      // NOTA: Implementa la lógica para mapear el shop de Shopify a tu store_id
      // Por ejemplo, buscando en la tabla shopify_integrations

      next();
    } else {
      // Verificación de token JWT normal (autenticación propia)
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        clockTolerance: JWT_CLOCK_TOLERANCE,
      }) as any;

      // Validate required claims (token uses 'userId' not 'id')
      if (!decoded.userId || !decoded.email) {
        return res.status(401).json({ error: 'No autorizado' });
      }

      // Explicit expiration check (redundant with jwt.verify but more explicit)
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < now) {
        return res.status(401).json({ error: 'No autorizado' });
      }

      // Set userId for routes that need it (auth routes use req.userId)
      req.userId = decoded.userId;

      // Also set user object for compatibility
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        stores: decoded.stores || []
      };
      next();
    }
  } catch (error: any) {
    // Log error internally but don't leak details to client
    if (process.env.NODE_ENV === 'development') {
      console.error('JWT verification failed:', error.message);
    }
    return res.status(401).json({ error: 'No autorizado' });
  }
}

export async function extractStoreId(req: AuthRequest, res: Response, next: NextFunction) {
  let storeId = req.headers['x-store-id'] as string;

  // Si es una sesión de Shopify y no hay store_id en headers, buscarlo por shop domain
  if (!storeId && req.shopifySession) {
    try {
      const shopDomain = req.shopifySession.dest;

      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth] Looking up store_id for Shopify shop:', shopDomain);
      }

      // Buscar la integración de Shopify por shop_domain
      const { data: integration, error } = await supabaseAdmin
        .from('shopify_integrations')
        .select('store_id')
        .eq('shop_domain', shopDomain)
        .eq('status', 'active')
        .single();

      if (error || !integration) {
        console.error('[Auth] No active Shopify integration found for shop:', shopDomain);
        return res.status(403).json({
          error: 'No active integration found for this Shopify store',
          details: 'Please connect your Shopify store first'
        });
      }

      storeId = integration.store_id;

      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth] Found store_id from Shopify integration:', storeId);
      }
    } catch (error) {
      console.error('[Auth] Error looking up Shopify store:', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  // Ahora verificamos que storeId esté presente
  if (!storeId) {
    return res.status(400).json({ error: 'Se requiere el header X-Store-ID' });
  }

  // Verificar acceso del usuario a este store (solo para autenticación normal, no Shopify)
  // SECURITY FIX: Also check is_active to prevent removed collaborators from accessing
  if (!req.shopifySession && req.userId) {
    try {
      const { data: userStore, error } = await supabaseAdmin
        .from('user_stores')
        .select('role')
        .eq('user_id', req.userId)
        .eq('store_id', storeId)
        .eq('is_active', true) // SECURITY: Prevent removed/deactivated users from accessing
        .single();

      if (error || !userStore) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Store access check failed:', error?.message || 'No access found or user deactivated');
        }
        return res.status(403).json({ error: 'Acceso denegado a esta tienda' });
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Store access verification error:', error);
      }
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  req.storeId = storeId;
  next();
}
