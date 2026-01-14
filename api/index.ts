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
import { recurringValuesRouter } from './routes/recurring-values';
import { campaignsRouter } from './routes/campaigns';
import { carriersRouter } from './routes/carriers';
import { couriersRouter } from './routes/couriers';
import { merchandiseRouter } from './routes/merchandise';
import { shopifyRouter } from './routes/shopify';
import { shopifyOAuthRouter } from './routes/shopify-oauth';
import { shopifyManualOAuthRouter } from './routes/shopify-manual-oauth';
import { shopifySyncRouter } from './routes/shopify-sync';
import shopifyWebhooksRouter from './routes/shopify-webhooks';
import { shopifyMandatoryWebhooksRouter } from './routes/shopify-mandatory-webhooks';
import { shopifyComplianceRouter } from './routes/shopify-compliance';
import { deliveryAttemptsRouter } from './routes/delivery-attempts';
import { settlementsRouter } from './routes/settlements';
import { carrierSettlementsRouter } from './routes/carrier-settlements';
import { codMetricsRouter } from './routes/cod-metrics';
import warehouseRouter from './routes/warehouse';
import shippingRouter from './routes/shipping';
import { inventoryRouter } from './routes/inventory';
import returnsRouter from './routes/returns';
import securityRouter from './routes/security';
import { incidentsRouter } from './routes/incidents';
import { unifiedRouter } from './routes/unified';
import { collaboratorsRouter } from './routes/collaborators';
import { externalWebhooksRouter } from './routes/external-webhooks';
// import phoneVerificationRouter from './routes/phone-verification'; // TODO: Enable when WhatsApp number is ready
import billingRouter from './routes/billing';
import uploadRouter from './routes/upload';
import onboardingRouter from './routes/onboarding';
import { requestLoggerMiddleware } from './utils/logger';

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

// ================================================================
// TRUST PROXY CONFIGURATION
// ================================================================
// Enable trust proxy to correctly identify client IPs behind reverse proxies
// This is required for rate limiting to work correctly on hosting platforms
// (Vercel, Heroku, Railway, etc.)
// ================================================================
app.set('trust proxy', 1);

// CORS configuration - supports multiple origins via comma-separated list
// Default origins for Ordefy production domains
const DEFAULT_ORIGINS = [
    'https://app.ordefy.io',
    'https://ordefy.io',
    'https://api.ordefy.io',
    'http://localhost:8080',
    'http://localhost:5173',
    'http://localhost:3000'
];

const ALLOWED_ORIGINS = [
    ...DEFAULT_ORIGINS,
    ...(process.env.CORS_ORIGIN || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
].filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates

// ================================================================
// MIDDLEWARE
// ================================================================

// Security headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "https://cdn.shopify.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", process.env.VITE_API_URL || 'http://localhost:3001'],
            // Frame ancestors: Allow Shopify admin to embed this app
            // CRITICAL for embedded apps - prevents clickjacking while allowing Shopify embedding
            frameAncestors: [
                "'self'",
                "https://*.myshopify.com",
                "https://admin.shopify.com",
                "https://*.shopify.com"
            ],
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
// CRÍTICO: Protege contra picos altos de tráfico (Black Friday, flash sales)
// Shopify puede enviar cientos de webhooks simultáneos
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // Max 1000 requests per minute (alto para manejar picos)
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

// Public delivery endpoints limiter (for courier delivery tokens)
// SECURITY: Prevents brute force attacks on delivery tokens
const deliveryTokenLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Max 10 requests per minute per IP
    message: {
        error: 'Too Many Requests',
        message: 'Demasiados intentos. Por favor intenta nuevamente en un minuto.',
        retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
        console.warn(`🚨 Delivery token rate limit exceeded for IP: ${req.ip} on ${req.path}`);
        res.status(429).json({
            error: 'Too Many Requests',
            message: 'Demasiados intentos. Por favor intenta nuevamente en un minuto.',
            retryAfter: '1 minute'
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

        // Check exact matches from ALLOWED_ORIGINS
        if (ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }

        // Allow Shopify admin domains (*.myshopify.com)
        // This is necessary for Shopify App Bridge embedded apps
        if (origin.match(/^https:\/\/[a-zA-Z0-9-]+\.myshopify\.com$/)) {
            return callback(null, true);
        }

        // Allow Shopify admin
        if (origin === 'https://admin.shopify.com') {
            return callback(null, true);
        }

        console.warn(`⚠️ CORS rejected request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Store-ID', 'X-Shopify-Session', 'X-API-Key', 'X-Idempotency-Key']
}));

// ================================================================
// RAW BODY MIDDLEWARE (for webhook HMAC validation)
// ================================================================
// IMPORTANT: This must come BEFORE express.json()
// We need raw body for Shopify webhook signature verification
// CRITICAL FIX: Support both /webhook/ AND /webhooks/ (Shopify uses plural in URLs)
// ================================================================
app.use((req: any, res: Response, next: NextFunction) => {
    // Handle all Shopify webhook routes (including GDPR and app uninstall)
    // Support both singular and plural: /api/shopify/webhook/ AND /api/shopify/webhooks/
    const isWebhookRoute = req.path.startsWith('/api/shopify/webhook/') ||
        req.path.startsWith('/api/shopify/webhooks/');

    if (isWebhookRoute) {
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
                console.error('❌ Failed to parse webhook JSON:', e);
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

// Request logging middleware with correlation IDs and PII redaction
app.use(requestLoggerMiddleware);

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

// Apply auth limiter to phone verification endpoints (prevent SMS spam)
app.use('/api/phone-verification/request', authLimiter);
app.use('/api/phone-verification/resend', authLimiter);

// Apply webhook limiter to webhook endpoints
// Support both /webhook/ (singular) and /webhooks/ (plural)
app.use('/api/shopify/webhook/', webhookLimiter);
app.use('/api/shopify/webhooks/', webhookLimiter);

// Apply webhook limiter to external webhook order reception
app.use('/api/webhook/orders/', webhookLimiter);

// Apply delivery token limiter to public delivery endpoints
// SECURITY: Prevents brute force attacks on delivery tokens
app.use('/api/orders/token/', deliveryTokenLimiter);
app.use('/api/orders/:id/delivery-confirm', deliveryTokenLimiter);
app.use('/api/orders/:id/delivery-fail', deliveryTokenLimiter);
app.use('/api/orders/:id/rate-delivery', deliveryTokenLimiter);
app.use('/api/orders/:id/cancel', deliveryTokenLimiter);

// Apply delivery token limiter to public incident endpoints
app.use('/api/incidents/order/', deliveryTokenLimiter);
app.use('/api/incidents/retry/', deliveryTokenLimiter);

// Apply rate limiter to collaborator public endpoints (invitation validation/acceptance)
// SECURITY: Prevents token enumeration and brute force attacks
app.use('/api/collaborators/validate-token/', deliveryTokenLimiter);
app.use('/api/collaborators/accept-invitation', deliveryTokenLimiter);

// Apply rate limiter to billing public endpoints
app.use('/api/billing/plans', apiLimiter);
app.use('/api/billing/referral/', deliveryTokenLimiter);
app.use('/api/billing/discount/validate', deliveryTokenLimiter);

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
app.use('/api/recurring-values', recurringValuesRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/carriers', carriersRouter);
app.use('/api/couriers', couriersRouter); // Repartidores (delivery personnel)
app.use('/api/merchandise', merchandiseRouter); // Inbound shipments / supplier purchases

// Shopify routes - ORDER MATTERS! More specific routes must come first
app.use('/api/shopify/manual-oauth', shopifyManualOAuthRouter); // Custom app OAuth for Dev Dashboard 2026
app.use('/api/shopify-oauth', shopifyOAuthRouter);
app.use('/api/shopify-sync', shopifySyncRouter);
app.use('/api/shopify', shopifyRouter); // General shopify routes (must be after more specific ones)
// Support both /webhook/ (singular) and /webhooks/ (plural) for backwards compatibility
app.use('/api/shopify/webhook', shopifyWebhooksRouter); // Singular (legacy URLs from Shopify)
app.use('/api/shopify/webhooks', shopifyWebhooksRouter); // Plural (new standard)
app.use('/api/shopify/webhooks', shopifyMandatoryWebhooksRouter);
app.use('/api/shopify/compliance', shopifyComplianceRouter);

// COD (Cash on Delivery) routes
app.use('/api/delivery-attempts', deliveryAttemptsRouter);
app.use('/api/incidents', incidentsRouter); // Delivery incidents and retry system
app.use('/api/settlements', settlementsRouter);
app.use('/api/carrier-settlements', carrierSettlementsRouter); // Carrier deferred payments
app.use('/api/cod-metrics', codMetricsRouter);

// Warehouse routes
app.use('/api/warehouse', warehouseRouter);
app.use('/api/unified', unifiedRouter);

// Shipping routes (Order dispatch to couriers)
app.use('/api/shipping', shippingRouter);

// Returns routes (Return/Refund processing)
app.use('/api/returns', returnsRouter);

// Inventory routes
app.use('/api/inventory', inventoryRouter);

// Security routes (Session management & Activity log)
app.use('/api/security', securityRouter);

// Collaborators & Team Management routes
app.use('/api/collaborators', collaboratorsRouter);

// External Webhooks routes (Landing pages & external systems)
app.use('/api/external-webhooks', externalWebhooksRouter);
app.use('/api/webhook', externalWebhooksRouter); // Public endpoint for receiving orders

// Phone verification routes (WhatsApp verification)
// TODO: Enable when WhatsApp Business number is ready
// app.use('/api/phone-verification', phoneVerificationRouter);

// Billing routes (Stripe subscriptions)
// Note: /api/billing/webhook uses raw body parser internally for Stripe signature
app.use('/api/billing', billingRouter);

// Upload routes (Image uploads to Supabase Storage)
app.use('/api/upload', uploadRouter);

// Onboarding routes (Setup progress & first-time user experience)
app.use('/api/onboarding', onboardingRouter);

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        deployedAt: process.env.RAILWAY_DEPLOYMENT_ID || 'local',
        externalWebhooksRouterRegistered: true
    });
});

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
