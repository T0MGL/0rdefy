/**
 * Type-safe query parameter extraction.
 * Express qs parser returns string | string[] | ParsedQs | ParsedQs[] | undefined.
 * These helpers narrow to the expected type safely.
 */

/**
 * Extracts a single string value from a query parameter.
 * Returns undefined if the param is missing or is an array.
 */
export function queryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * Extracts a required string value from a query parameter.
 * Returns the string or throws-safe empty string for downstream validation.
 */
export function queryStringRequired(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

/**
 * Extracts error message from an unknown caught value.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
