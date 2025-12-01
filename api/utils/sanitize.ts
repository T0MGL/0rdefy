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
