/**
 * Error Handler Utility
 * Sanitizes errors before sending to client to prevent information disclosure
 *
 * Security: Never expose internal error messages, stack traces, or database details to client
 * OWASP: Prevents CWE-209 (Information Exposure Through Error Message)
 */

import { logger } from './logger';
import { Response } from 'express';

/**
 * Error codes that are safe to expose to clients
 */
export enum ErrorCode {
    // Client Errors (4xx)
    BAD_REQUEST = 'BAD_REQUEST',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    NOT_FOUND = 'NOT_FOUND',
    NO_CONTENT = 'NO_CONTENT',
    DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
    REQUIRED_FIELD = 'REQUIRED_FIELD',
    INVALID_INPUT = 'INVALID_INPUT',
    REFERENCE_ERROR = 'REFERENCE_ERROR',

    // Server Errors (5xx)
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR'
}

/**
 * HTTP status codes
 */
const STATUS_CODES: Record<ErrorCode, number> = {
    [ErrorCode.BAD_REQUEST]: 400,
    [ErrorCode.UNAUTHORIZED]: 401,
    [ErrorCode.FORBIDDEN]: 403,
    [ErrorCode.NOT_FOUND]: 404,
    [ErrorCode.NO_CONTENT]: 204,
    [ErrorCode.DUPLICATE_ENTRY]: 409,
    [ErrorCode.REQUIRED_FIELD]: 400,
    [ErrorCode.INVALID_INPUT]: 400,
    [ErrorCode.REFERENCE_ERROR]: 400,
    [ErrorCode.INTERNAL_ERROR]: 500,
    [ErrorCode.DATABASE_ERROR]: 500,
    [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502
};

/**
 * User-friendly messages for each error code
 */
const CLIENT_MESSAGES: Record<ErrorCode, string> = {
    [ErrorCode.BAD_REQUEST]: 'Solicitud inválida',
    [ErrorCode.UNAUTHORIZED]: 'No autorizado. Por favor inicia sesión',
    [ErrorCode.FORBIDDEN]: 'No tienes permiso para realizar esta acción',
    [ErrorCode.NOT_FOUND]: 'Recurso no encontrado',
    [ErrorCode.NO_CONTENT]: 'Operación exitosa',
    [ErrorCode.DUPLICATE_ENTRY]: 'El registro ya existe',
    [ErrorCode.REQUIRED_FIELD]: 'Campos requeridos faltantes',
    [ErrorCode.INVALID_INPUT]: 'Datos de entrada inválidos',
    [ErrorCode.REFERENCE_ERROR]: 'Referencia inválida',
    [ErrorCode.INTERNAL_ERROR]: 'Error interno del servidor',
    [ErrorCode.DATABASE_ERROR]: 'Error de base de datos',
    [ErrorCode.EXTERNAL_SERVICE_ERROR]: 'Error en servicio externo'
};

/**
 * Maps PostgreSQL error codes to our ErrorCode enum
 */
const PG_ERROR_CODES: Record<string, ErrorCode> = {
    '23505': ErrorCode.DUPLICATE_ENTRY,      // unique_violation
    '23503': ErrorCode.REFERENCE_ERROR,      // foreign_key_violation
    '23502': ErrorCode.REQUIRED_FIELD,       // not_null_violation
    '23514': ErrorCode.INVALID_INPUT,        // check_violation
    '22P02': ErrorCode.INVALID_INPUT,        // invalid_text_representation
    '42P01': ErrorCode.DATABASE_ERROR,       // undefined_table
    '42703': ErrorCode.DATABASE_ERROR        // undefined_column
};

/**
 * Maps Supabase/PostgREST error codes to our ErrorCode enum
 */
const SUPABASE_ERROR_CODES: Record<string, ErrorCode> = {
    'PGRST116': ErrorCode.NOT_FOUND,         // Row not found
    'PGRST204': ErrorCode.NO_CONTENT,        // No content (successful delete)
    '22P02': ErrorCode.INVALID_INPUT         // Invalid input syntax
};

/**
 * Sanitized error response
 */
export interface SanitizedError {
    error: string;
    code: ErrorCode;
    status: number;
    details?: any;  // Only in development mode
}

/**
 * Sanitizes an error object before sending to client
 * Logs full error details server-side for debugging
 *
 * @param error - The error object to sanitize
 * @param context - Context string for logging (e.g., 'GET /api/customers/:id')
 * @returns Sanitized error safe to send to client
 */
export function sanitizeError(error: any, context: string = 'API'): SanitizedError {
    // Log full error server-side for debugging
    logger.error(context, 'Error occurred:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });

    // Determine error code
    let errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR;

    if (error?.code) {
        // Check PostgreSQL error codes
        if (PG_ERROR_CODES[error.code]) {
            errorCode = PG_ERROR_CODES[error.code];
        }
        // Check Supabase error codes
        else if (SUPABASE_ERROR_CODES[error.code]) {
            errorCode = SUPABASE_ERROR_CODES[error.code];
        }
    }

    // Check for common error messages
    if (error?.message) {
        const msg = error.message.toLowerCase();

        if (msg.includes('not found') || msg.includes('no rows')) {
            errorCode = ErrorCode.NOT_FOUND;
        } else if (msg.includes('duplicate') || msg.includes('already exists')) {
            errorCode = ErrorCode.DUPLICATE_ENTRY;
        } else if (msg.includes('required') || msg.includes('cannot be null')) {
            errorCode = ErrorCode.REQUIRED_FIELD;
        } else if (msg.includes('invalid') || msg.includes('malformed')) {
            errorCode = ErrorCode.INVALID_INPUT;
        } else if (msg.includes('unauthorized') || msg.includes('not authenticated')) {
            errorCode = ErrorCode.UNAUTHORIZED;
        } else if (msg.includes('forbidden') || msg.includes('permission denied')) {
            errorCode = ErrorCode.FORBIDDEN;
        }
    }

    const sanitized: SanitizedError = {
        error: CLIENT_MESSAGES[errorCode],
        code: errorCode,
        status: STATUS_CODES[errorCode]
    };

    // In development, include additional details
    if (process.env.NODE_ENV === 'development') {
        sanitized.details = {
            originalMessage: error?.message,
            code: error?.code,
            hint: error?.hint
        };
    }

    return sanitized;
}

/**
 * Express middleware for handling errors
 * Use this as the last middleware in your route
 *
 * @param error - Error object
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function errorHandler(error: any, req: any, res: Response, next: any) {
    const context = `${req.method} ${req.path}`;
    const sanitized = sanitizeError(error, context);

    res.status(sanitized.status).json({
        error: sanitized.error,
        code: sanitized.code,
        ...(sanitized.details && { details: sanitized.details })
    });
}

/**
 * Convenience function to send sanitized error response
 * Use this in try-catch blocks
 *
 * @param res - Express response object
 * @param error - Error to sanitize and send
 * @param context - Context string for logging
 */
export function sendError(res: Response, error: any, context: string = 'API') {
    const sanitized = sanitizeError(error, context);

    res.status(sanitized.status).json({
        error: sanitized.error,
        code: sanitized.code,
        ...(sanitized.details && { details: sanitized.details })
    });
}

/**
 * Creates a custom error with a specific error code
 *
 * @param code - The error code
 * @param message - Optional custom message (defaults to standard message)
 * @returns Error object
 */
export function createError(code: ErrorCode, message?: string): Error {
    const error = new Error(message || CLIENT_MESSAGES[code]);
    (error as any).errorCode = code;
    return error;
}
