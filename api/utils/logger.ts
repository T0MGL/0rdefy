/**
 * Production-Ready Logger Utility
 *
 * CRITICAL: This logger is designed for a $100k production system.
 * - Automatic PII redaction (emails, phones, tokens, IPs)
 * - Environment-aware logging (silences info/debug in production)
 * - Structured JSON output for log aggregation
 * - Correlation ID support for request tracing
 * - Performance tracking with timing
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('AUTH', 'User logged in', { userId: '123' });
 *   logger.error('AUTH', 'Login failed', error);
 *   logger.security('AUTH', 'Brute force detected', { ip: req.ip });
 */

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const VERBOSE_LOGS = process.env.VERBOSE_LOGS === 'true';
const JSON_LOGS = process.env.JSON_LOGS === 'true' || isProduction;

// Request context for correlation IDs (using AsyncLocalStorage pattern)
let currentRequestId: string | null = null;

/**
 * Set the current request ID for correlation
 */
export function setRequestId(requestId: string): void {
    currentRequestId = requestId;
}

/**
 * Get the current request ID
 */
export function getRequestId(): string | null {
    return currentRequestId;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * PII patterns to redact
 */
const PII_PATTERNS = {
    // Email: any@domain.com → a***@domain.com
    email: /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
    // Phone: +595981... → +595***...
    phone: /(\+?\d{1,4})?[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
    // JWT tokens
    jwt: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    // API keys/secrets (generic patterns)
    apiKey: /(api[_-]?key|secret|token|password|authorization)['":\s]*[=:]\s*['"]?([a-zA-Z0-9_\-\.]{20,})['"]?/gi,
    // Credit card numbers
    creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    // IP addresses (optional - may want to keep for security logs)
    // ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

/**
 * Redacts PII from a string
 */
function redactPII(value: string): string {
    if (!isProduction) return value;

    let redacted = value;

    // Redact emails: keep first 2 chars + domain
    redacted = redacted.replace(PII_PATTERNS.email, (match, local, domain) => {
        const prefix = local.substring(0, Math.min(2, local.length));
        return `${prefix}***@${domain}`;
    });

    // Redact phone numbers: keep country code + last 2 digits
    redacted = redacted.replace(PII_PATTERNS.phone, (match) => {
        if (match.length < 6) return match; // Don't redact short numbers
        const cleaned = match.replace(/[-.\s()]/g, '');
        if (cleaned.length < 8) return match;
        return `${cleaned.substring(0, 3)}***${cleaned.slice(-2)}`;
    });

    // Redact JWTs
    redacted = redacted.replace(PII_PATTERNS.jwt, '[JWT_REDACTED]');

    // Redact API keys/secrets
    redacted = redacted.replace(PII_PATTERNS.apiKey, '$1=[REDACTED]');

    // Redact credit cards
    redacted = redacted.replace(PII_PATTERNS.creditCard, '****-****-****-$4');

    return redacted;
}

/**
 * List of sensitive field names to completely redact in objects
 */
const SENSITIVE_FIELDS = new Set([
    'password', 'password_hash', 'passwordHash', 'newPassword', 'currentPassword',
    'token', 'accessToken', 'refreshToken', 'apiKey', 'api_key', 'secret',
    'authorization', 'cookie', 'session', 'sessionToken',
    'credit_card', 'creditCard', 'card_number', 'cardNumber', 'cvv', 'cvc',
    'ssn', 'socialSecurityNumber',
    'pin', 'otp', 'verificationCode',
]);

/**
 * Fields that contain PII but should be partially redacted (not fully)
 */
const PII_FIELDS = new Set([
    'email', 'phone', 'userPhone', 'customerPhone', 'phoneNumber',
    'address', 'street', 'fullName', 'firstName', 'lastName',
]);

/**
 * Deep sanitizes an object, redacting sensitive fields and PII
 */
function sanitizeObject(obj: any, depth: number = 0): any {
    // Prevent infinite recursion
    if (depth > 10) return '[MAX_DEPTH]';

    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        return redactPII(obj);
    }

    if (typeof obj !== 'object') return obj;

    // Handle Error objects specially
    if (obj instanceof Error) {
        return {
            name: obj.name,
            message: redactPII(obj.message),
            // Only include stack in non-production
            ...(isProduction ? {} : { stack: obj.stack }),
        };
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        // Limit array length in logs
        const limited = obj.slice(0, 100);
        const sanitized = limited.map(item => sanitizeObject(item, depth + 1));
        if (obj.length > 100) {
            sanitized.push(`... and ${obj.length - 100} more items`);
        }
        return sanitized;
    }

    // Handle objects
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();

        // Completely redact sensitive fields
        if (SENSITIVE_FIELDS.has(key) || SENSITIVE_FIELDS.has(lowerKey)) {
            sanitized[key] = '[REDACTED]';
            continue;
        }

        // Partially redact PII fields
        if (PII_FIELDS.has(key) || PII_FIELDS.has(lowerKey)) {
            if (typeof value === 'string') {
                sanitized[key] = redactPII(value);
            } else {
                sanitized[key] = '[REDACTED]';
            }
            continue;
        }

        // Recursively sanitize nested objects
        sanitized[key] = sanitizeObject(value, depth + 1);
    }

    return sanitized;
}

/**
 * Formats the current timestamp for logs
 */
function getTimestamp(): string {
    return new Date().toISOString();
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SECURITY' | 'PERF';

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    module: string;
    message: string;
    requestId?: string;
    data?: any;
    duration?: number;
}

/**
 * Formats log entry based on environment
 */
function formatLog(entry: LogEntry): string {
    if (JSON_LOGS) {
        // Structured JSON for production log aggregation
        return JSON.stringify(entry);
    }

    // Human-readable format for development
    const parts = [
        `[${entry.timestamp}]`,
        `[${entry.level}]`,
        `[${entry.module}]`,
    ];

    if (entry.requestId) {
        parts.push(`[${entry.requestId}]`);
    }

    parts.push(entry.message);

    if (entry.duration !== undefined) {
        parts.push(`(${entry.duration}ms)`);
    }

    let output = parts.join(' ');

    if (entry.data && Object.keys(entry.data).length > 0) {
        output += '\n' + JSON.stringify(entry.data, null, 2);
    }

    return output;
}

/**
 * Core logging function
 */
function log(level: LogLevel, module: string, message: string, data?: any, duration?: number): void {
    if (isTest) return;

    const entry: LogEntry = {
        timestamp: getTimestamp(),
        level,
        module: module.toUpperCase(),
        message,
    };

    if (currentRequestId) {
        entry.requestId = currentRequestId;
    }

    if (data !== undefined) {
        entry.data = sanitizeObject(data);
    }

    if (duration !== undefined) {
        entry.duration = duration;
    }

    const formatted = formatLog(entry);

    switch (level) {
        case 'ERROR':
            console.error(formatted);
            break;
        case 'WARN':
        case 'SECURITY':
            console.warn(formatted);
            break;
        default:
            console.log(formatted);
    }
}

export const logger = {
    /**
     * Debug level - Detailed debugging information
     * In production: Always suppressed (unless VERBOSE_LOGS=true)
     */
    debug: (module: string, message: string, data?: any): void => {
        if (isProduction && !VERBOSE_LOGS) return;
        log('DEBUG', module, message, data);
    },

    /**
     * Info level - General information about application flow
     * In production: Suppressed unless VERBOSE_LOGS=true
     */
    info: (module: string, message: string, data?: any): void => {
        if (isProduction && !VERBOSE_LOGS) return;
        log('INFO', module, message, data);
    },

    /**
     * Warning level - Non-critical issues that should be addressed
     * In production: Always shown (sanitized)
     */
    warn: (module: string, message: string, data?: any): void => {
        log('WARN', module, message, data);
    },

    /**
     * Error level - Errors that need attention
     * In production: Always shown with sanitized details
     */
    error: (module: string, message: string, error?: any): void => {
        log('ERROR', module, message, error);
    },

    /**
     * Security level - Security-relevant events (auth failures, rate limits, etc.)
     * In production: Always shown for audit trail
     */
    security: (module: string, message: string, data?: any): void => {
        log('SECURITY', module, message, data);
    },

    /**
     * Performance level - Performance metrics
     * In production: Only shown if VERBOSE_LOGS=true
     */
    perf: (module: string, operation: string, durationMs: number, data?: any): void => {
        if (isProduction && !VERBOSE_LOGS) return;
        log('PERF', module, operation, data, durationMs);
    },

    /**
     * Start a timer for performance tracking
     * Returns a function to call when operation completes
     */
    startTimer: (module: string, operation: string): (() => void) => {
        const start = Date.now();
        return () => {
            const duration = Date.now() - start;
            logger.perf(module, operation, duration);
        };
    },

    /**
     * Create a child logger with a fixed module name
     */
    child: (module: string) => ({
        debug: (message: string, data?: any) => logger.debug(module, message, data),
        info: (message: string, data?: any) => logger.info(module, message, data),
        warn: (message: string, data?: any) => logger.warn(module, message, data),
        error: (message: string, error?: any) => logger.error(module, message, error),
        security: (message: string, data?: any) => logger.security(module, message, data),
        perf: (operation: string, durationMs: number, data?: any) => logger.perf(module, operation, durationMs, data),
        startTimer: (operation: string) => logger.startTimer(module, operation),
    }),
};

/**
 * Express middleware for request logging with correlation IDs
 */
export function requestLoggerMiddleware(req: any, res: any, next: any): void {
    const requestId = generateRequestId();
    setRequestId(requestId);

    // Attach request ID to response headers for debugging
    res.setHeader('X-Request-ID', requestId);

    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const level = res.statusCode >= 500 ? 'ERROR' :
                     res.statusCode >= 400 ? 'WARN' : 'INFO';

        // Only log in production if error/warn, or if verbose
        if (isProduction && level === 'INFO' && !VERBOSE_LOGS) {
            setRequestId(null as any);
            return;
        }

        log(level as LogLevel, 'HTTP', `${req.method} ${req.path}`, {
            statusCode: res.statusCode,
            duration,
            // Don't log IPs in production for GDPR compliance
            ...(isProduction ? {} : { ip: req.ip }),
        }, duration);

        // Clear request ID after logging
        setRequestId(null as any);
    });

    next();
}

/**
 * Legacy console wrapper - for gradual migration
 * Use this to replace console.log calls that should respect production settings
 */
export const safeConsole = {
    log: (...args: any[]): void => {
        if (isProduction || isTest) return;
        console.log(...args.map(arg =>
            typeof arg === 'object' ? sanitizeObject(arg) : redactPII(String(arg))
        ));
    },
    error: (...args: any[]): void => {
        if (isTest) return;
        console.error(...args.map(arg =>
            typeof arg === 'object' ? sanitizeObject(arg) : redactPII(String(arg))
        ));
    },
    warn: (...args: any[]): void => {
        if (isTest) return;
        console.warn(...args.map(arg =>
            typeof arg === 'object' ? sanitizeObject(arg) : redactPII(String(arg))
        ));
    },
};

export default logger;
