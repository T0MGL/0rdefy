/**
 * Sanitization Utilities
 * Prevents SQL injection and other security vulnerabilities
 */

/**
 * Sanitizes a search string for use in Supabase queries
 * Escapes special characters that could be used for SQL injection
 *
 * @param input - The raw user input
 * @returns Sanitized string safe for use in queries
 */
export function sanitizeSearchInput(input: string): string {
    if (!input || typeof input !== 'string') {
        return '';
    }

    // Remove or escape potentially dangerous characters
    // Supabase uses PostgREST which handles most injection, but we add extra safety
    return input
        .trim()
        // Remove SQL comment indicators
        .replace(/--/g, '')
        .replace(/\/\*/g, '')
        .replace(/\*\//g, '')
        // Strip PostgREST filter syntax characters to prevent filter injection
        .replace(/[,.()']/g, '')
        // Escape wildcards to prevent unintended pattern matching
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        // Remove null bytes
        .replace(/\0/g, '')
        // Limit length to prevent DoS
        .substring(0, 100);
}

/**
 * Validates that a string is a valid UUID
 *
 * @param id - The string to validate
 * @returns true if valid UUID, false otherwise
 */
export function isValidUUID(id: string): boolean {
    if (!id || typeof id !== 'string') {
        return false;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
}

/**
 * Validates an array of UUIDs
 *
 * @param ids - Array of strings to validate
 * @returns true if all are valid UUIDs, false otherwise
 */
export function areValidUUIDs(ids: string[]): boolean {
    if (!Array.isArray(ids) || ids.length === 0) {
        return false;
    }

    return ids.every(id => isValidUUID(id));
}

/**
 * Sanitizes a numeric input
 *
 * @param input - The raw input
 * @param defaultValue - Default value if input is invalid
 * @returns Sanitized number
 */
export function sanitizeNumber(input: any, defaultValue: number = 0): number {
    const parsed = Number(input);

    if (isNaN(parsed) || !isFinite(parsed)) {
        return defaultValue;
    }

    return parsed;
}

/**
 * Sanitizes an integer input with min/max bounds
 *
 * @param input - The raw input
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @param defaultValue - Default value if input is invalid
 * @returns Sanitized integer within bounds
 */
export function sanitizeInteger(
    input: any,
    min: number = Number.MIN_SAFE_INTEGER,
    max: number = Number.MAX_SAFE_INTEGER,
    defaultValue: number = 0
): number {
    const parsed = parseInt(input, 10);

    if (isNaN(parsed) || !isFinite(parsed)) {
        return defaultValue;
    }

    return Math.max(min, Math.min(max, parsed));
}

/**
 * Parses and clamps pagination parameters from query strings.
 * Prevents DoS via unbounded limit and ensures valid offset.
 *
 * @param rawLimit - The raw limit from req.query
 * @param rawOffset - The raw offset from req.query
 * @param maxLimit - Maximum allowed limit (default: 200)
 * @returns { limit, offset } clamped to safe values
 */
export function parsePagination(
    rawLimit: any,
    rawOffset: any,
    maxLimit: number = 200
): { limit: number; offset: number } {
    const limit = sanitizeInteger(rawLimit, 1, maxLimit, 50);
    const offset = sanitizeInteger(rawOffset, 0, Number.MAX_SAFE_INTEGER, 0);
    return { limit, offset };
}

/**
 * Express middleware factory to validate UUID parameters
 *
 * @param paramName - The name of the route parameter to validate (default: 'id')
 * @returns Express middleware function
 *
 * Usage:
 *   router.get('/:id', validateUUIDParam(), handler);
 *   router.get('/:orderId', validateUUIDParam('orderId'), handler);
 */
export function validateUUIDParam(paramName: string = 'id') {
    return (req: any, res: any, next: any) => {
        const id = req.params[paramName];

        if (!id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: `Missing required parameter: ${paramName}`
            });
        }

        if (!isValidUUID(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: `Invalid ${paramName} format. Expected UUID.`
            });
        }

        next();
    };
}

/**
 * Validates multiple UUID parameters at once
 *
 * @param paramNames - Array of parameter names to validate
 * @returns Express middleware function
 *
 * Usage:
 *   router.delete('/:sessionId/orders/:orderId', validateUUIDParams(['sessionId', 'orderId']), handler);
 */
export function validateUUIDParams(paramNames: string[]) {
    return (req: any, res: any, next: any) => {
        for (const paramName of paramNames) {
            const id = req.params[paramName];

            if (!id) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: `Missing required parameter: ${paramName}`
                });
            }

            if (!isValidUUID(id)) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: `Invalid ${paramName} format. Expected UUID.`
                });
            }
        }

        next();
    };
}
