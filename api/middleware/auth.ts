import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../db/connection';

// JWT Configuration Constants
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
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
}

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: JWT_CLOCK_TOLERANCE,
    }) as any;

    // Validate required claims (token uses 'userId' not 'id')
    if (!decoded.userId || !decoded.email) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Explicit expiration check (redundant with jwt.verify but more explicit)
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      return res.status(401).json({ error: 'Unauthorized' });
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
  } catch (error: any) {
    // Log error internally but don't leak details to client
    if (process.env.NODE_ENV === 'development') {
      console.error('JWT verification failed:', error.message);
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export async function extractStoreId(req: AuthRequest, res: Response, next: NextFunction) {
  const storeId = req.headers['x-store-id'] as string;

  if (!storeId) {
    return res.status(400).json({ error: 'X-Store-ID header is required' });
  }

  // Verify user has access to this store by checking database
  try {
    const { data: userStore, error } = await supabaseAdmin
      .from('user_stores')
      .select('role')
      .eq('user_id', req.userId)
      .eq('store_id', storeId)
      .single();

    if (error || !userStore) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Store access check failed:', error?.message || 'No access found');
      }
      return res.status(403).json({ error: 'Access denied to this store' });
    }

    req.storeId = storeId;
    next();
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Store access verification error:', error);
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
