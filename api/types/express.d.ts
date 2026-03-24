// Global Express request augmentation for Ordefy API.
// Adds custom properties set by auth middleware.

import 'express-serve-static-core';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        email: string;
        name?: string;
        stores: Array<{ id: string; name: string; role: string }>;
      };
      storeId?: string;
      rawBody?: string;
      requestId?: string;
      shopifySession?: {
        dest: string;
        aud: string;
        sub: string;
        exp: number;
        nbf: number;
        iat: number;
        jti: string;
        sid: string;
      };
    }
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    user?: {
      id: string;
      email: string;
      name?: string;
      stores: Array<{ id: string; name: string; role: string }>;
    };
    storeId?: string;
    rawBody?: string;
    requestId?: string;
    shopifySession?: {
      dest: string;
      aud: string;
      sub: string;
      exp: number;
      nbf: number;
      iat: number;
      jti: string;
      sid: string;
    };
  }
}

export {};
