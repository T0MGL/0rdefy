// ================================================================
// ORDEFY API - Express Server Entry Point
// ================================================================
// E-commerce Management API
// Developed by Bright Idea - All Rights Reserved
// ================================================================

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { authRouter } from './routes/auth';
import { ordersRouter } from './routes/orders';
import { productsRouter } from './routes/products';
import { storesRouter } from './routes/stores';
import { customersRouter } from './routes/customers';
import { analyticsRouter } from './routes/analytics';
import { suppliersRouter } from './routes/suppliers';
import { additionalValuesRouter } from './routes/additional-values';
import { campaignsRouter } from './routes/campaigns';
import { carriersRouter } from './routes/carriers';
import { couriersRouter } from './routes/couriers';
import { shopifyRouter } from './routes/shopify';
import { shopifyOAuthRouter } from './routes/shopify-oauth';
import { shopifySyncRouter } from './routes/shopify-sync';
import shopifyWebhooksRouter from './routes/shopify-webhooks';
import { shopifyMandatoryWebhooksRouter } from './routes/shopify-mandatory-webhooks';
import { shopifyComplianceRouter } from './routes/shopify-compliance';
import { deliveryAttemptsRouter } from './routes/delivery-attempts';
import { settlementsRouter } from './routes/settlements';
import { codMetricsRouter } from './routes/cod-metrics';

// Load environment variables
dotenv.config();

// ================================================================
// ENVIRONMENT VALIDATION
// ================================================================
// Validate all required environment variables at startup
// This prevents runtime errors when critical configs are missing
// ================================================================

const REQUIRED_ENV_VARS = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'JWT_SECRET',
] as const;

const OPTIONAL_ENV_VARS = [
    'N8N_WEBHOOK_URL_NEWORDER',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_API_KEY',
] as const;

function validateEnvironment() {
    const missing: string[] = [];
    const warnings: string[] = [];

    // Check required variables
    for (const varName of REQUIRED_ENV_VARS) {
        const value = process.env[varName];
        if (!value || value.trim() === '') {
            missing.push(varName);
        }
    }

    // Check optional but important variables
    for (const varName of OPTIONAL_ENV_VARS) {
        const value = process.env[varName];
        if (!value || value.trim() === '') {
            warnings.push(varName);
        }
    }

    if (missing.length > 0) {
        console.error('================================================================');
        console.error('❌ FATAL: Missing required environment variables:');
        missing.forEach(v => console.error(`   - ${v}`));
        console.error('================================================================');
        console.error('Please set these variables in your .env file');
        process.exit(1);
    }

    if (warnings.length > 0) {
        console.warn('================================================================');
        console.warn('⚠️  WARNING: Optional environment variables not set:');
        warnings.forEach(v => console.warn(`   - ${v}`));
        console.warn('================================================================');
        console.warn('Some features may not work correctly');
    }

    // Validate JWT_SECRET length
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && jwtSecret.length < 32) {
        console.warn('⚠️  WARNING: JWT_SECRET should be at least 32 characters');
    }

    console.log('✅ Environment validation passed');
}

// Run validation before starting server
validateEnvironment();

const app = express();
const PORT = process.env.API_PORT || 3001;

// CORS configuration - supports multiple origins via comma-separated list
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

// ================================================================
// MIDDLEWARE
// ================================================================

// Security headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", process.env.VITE_API_URL || 'http://localhost:3001'],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// ================================================================
// RATE LIMITING CONFIGURATION
// ================================================================

// General API rate limiter (applies to all endpoints)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Increased to 500 for general API usage (was too restrictive at 100)
    message: {
        error: 'Too Many Requests',
        message: 'You have exceeded the rate limit. Please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,  // Disable `X-RateLimit-*` headers
    handler: (req: Request, res: Response) => {
        console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip} on ${req.path}`);
        res.status(429).json({
            error: 'Too Many Requests',
            message: 'You have exceeded the rate limit. Please try again later.',
            retryAfter: '15 minutes'
        });
    }
});

// Stricter limiter for auth endpoints (login, register, password reset)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 attempts per 15 minutes
    skipSuccessfulRequests: true, // Don't count successful requests
    message: {
        error: 'Too Many Authentication Attempts',
        message: 'Too many authentication attempts from this IP. Please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
        console.warn(`🚨 Auth rate limit exceeded for IP: ${req.ip} on ${req.path}`);
        res.status(429).json({
            error: 'Too Many Authentication Attempts',
            message: 'Too many authentication attempts from this IP. Please try again later.',
            retryAfter: '15 minutes'
        });
    }
});

// Webhook rate limiter (for Shopify and other webhooks)
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // Max 60 requests per minute (1 req/sec average)
    message: {
        error: 'Webhook Rate Limit Exceeded',
        message: 'Too many webhook requests. Please slow down.',
        retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
        console.warn(`⚠️ Webhook rate limit exceeded for IP: ${req.ip} on ${req.path}`);
        res.status(429).json({
            error: 'Webhook Rate Limit Exceeded',
            message: 'Too many webhook requests. Please slow down.',
            retryAfter: '1 minute'
        });
    }
});

// Write operations limiter (POST, PUT, PATCH, DELETE)
const writeOperationsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Max 200 write operations per 15 minutes
    message: {
        error: 'Too Many Write Operations',
        message: 'You have exceeded the write operations limit. Please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request) => req.method === 'GET', // Only apply to write operations
    handler: (req: Request, res: Response) => {
        console.warn(`⚠️ Write operations rate limit exceeded for IP: ${req.ip} on ${req.path}`);
        res.status(429).json({
            error: 'Too Many Write Operations',
            message: 'You have exceeded the write operations limit. Please try again later.',
            retryAfter: '15 minutes'
        });
    }
});

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) {
            return callback(null, true);
        }

        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS rejected request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Store-ID']
}));

// ================================================================
// RAW BODY MIDDLEWARE (for webhook HMAC validation)
// ================================================================
// IMPORTANT: This must come BEFORE express.json()
// We need raw body for Shopify webhook signature verification
// ================================================================
app.use((req: any, res: Response, next: NextFunction) => {
    // Handle both regular webhooks and compliance webhooks
    if (req.path.startsWith('/api/shopify/webhooks') || req.path.startsWith('/api/shopify/compliance')) {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
            data += chunk;
        });
        req.on('end', () => {
            req.rawBody = data;
            // Parse JSON manually for webhook routes
            try {
                req.body = JSON.parse(data);
            } catch (e) {
                req.body = {};
            }
            next();
        });
    } else {
        next();
    }
});

// Body parsing (for non-webhook routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// ================================================================
// ROUTES
// ================================================================

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        service: 'Ordefy API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        database: 'connected',
        environment: process.env.NODE_ENV || 'development',
        author: 'Bright Idea'
    });
});

// ================================================================
// API ROUTES WITH RATE LIMITING
// ================================================================

// Apply auth limiter to authentication endpoints first (most restrictive)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/change-password', authLimiter);
app.use('/api/auth/delete-account', authLimiter);

// Apply webhook limiter to webhook endpoints
app.use('/api/shopify/webhooks', webhookLimiter);
app.use('/api/shopify/compliance', webhookLimiter);

// Apply write operations limiter to all API routes
app.use('/api/', writeOperationsLimiter);

// Apply general API limiter to all API routes (broadest protection)
app.use('/api/', apiLimiter);

// Register API routers
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/products', productsRouter);
app.use('/api/stores', storesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/additional-values', additionalValuesRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/carriers', carriersRouter);
app.use('/api/couriers', couriersRouter); // Repartidores (delivery personnel)
app.use('/api/shopify', shopifyRouter);
app.use('/api/shopify-oauth', shopifyOAuthRouter);
app.use('/api/shopify-sync', shopifySyncRouter);
app.use('/api/shopify/webhooks', shopifyWebhooksRouter);
app.use('/api/shopify/webhooks', shopifyMandatoryWebhooksRouter);
app.use('/api/shopify/compliance', shopifyComplianceRouter);

// COD (Cash on Delivery) routes
app.use('/api/delivery-attempts', deliveryAttemptsRouter);
app.use('/api/settlements', settlementsRouter);
app.use('/api/cod-metrics', codMetricsRouter);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
    res.json({
        message: 'Ordefy API Server',
        version: '1.0.0',
        author: 'Bright Idea',
        documentation: '/api/docs',
        endpoints: {
            health: '/health',
            orders: '/api/orders',
            products: '/api/products',
            stores: '/api/stores',
            customers: '/api/customers',
            analytics: '/api/analytics',
            suppliers: '/api/suppliers',
            additionalValues: '/api/additional-values',
            campaigns: '/api/campaigns',
            carriers: '/api/carriers'
        }
    });
});

// ================================================================
// ERROR HANDLING
// ================================================================

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[ERROR]', err);

    // Database errors
    if (err.code === '23505') {
        return res.status(409).json({
            error: 'Conflict',
            message: 'A record with this unique identifier already exists',
            detail: err.detail
        });
    }

    if (err.code === '23503') {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Referenced record does not exist',
            detail: err.detail
        });
    }

    // Validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            message: err.message,
            details: err.details
        });
    }

    // Default error response
    res.status(err.status || 500).json({
        error: err.name || 'Internal Server Error',
        message: err.message || 'An unexpected error occurred',
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// ================================================================
// SERVER STARTUP
// ================================================================

app.listen(PORT, () => {
    console.log('================================================================');
    console.log('🚀 ORDEFY API SERVER STARTED');
    console.log('================================================================');
    console.log(`📡 Server running on: http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 CORS Origins: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log('================================================================');
    console.log('📚 Available Endpoints:');
    console.log('   GET  /health                    - Health check');
    console.log('   GET  /api/stores                - List stores');
    console.log('   GET  /api/orders                - List orders');
    console.log('   POST /api/orders                - Create order');
    console.log('   GET  /api/products              - List products');
    console.log('   POST /api/products              - Create product');
    console.log('   GET  /api/customers             - List customers');
    console.log('   GET  /api/suppliers             - List suppliers');
    console.log('   GET  /api/analytics/*           - Analytics endpoints');
    console.log('   GET  /api/additional-values     - List additional values');
    console.log('   GET  /api/campaigns             - List campaigns/ads');
    console.log('   GET  /api/carriers              - List carriers');
    console.log('================================================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    process.exit(0);
});

export default app;
