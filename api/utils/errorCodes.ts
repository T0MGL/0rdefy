/**
 * Structured Error Codes for Production API
 *
 * CRITICAL: Standardized error codes for consistent error handling and debugging.
 * All API responses should use these codes for:
 * - Frontend error handling and user messaging
 * - Log aggregation and alerting
 * - Support troubleshooting
 *
 * Format: CATEGORY_SPECIFIC_ERROR
 */

export const ERROR_CODES = {
    // ================================================================
    // AUTHENTICATION ERRORS (AUTH_*)
    // ================================================================
    AUTH_MISSING_CREDENTIALS: 'AUTH_MISSING_CREDENTIALS',
    AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
    AUTH_ACCOUNT_INACTIVE: 'AUTH_ACCOUNT_INACTIVE',
    AUTH_ACCESS_REVOKED: 'AUTH_ACCESS_REVOKED',
    AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
    AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
    AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
    AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',

    // ================================================================
    // REGISTRATION ERRORS (REG_*)
    // ================================================================
    REG_MISSING_FIELDS: 'REG_MISSING_FIELDS',
    REG_EMAIL_EXISTS: 'REG_EMAIL_EXISTS',
    REG_PHONE_EXISTS: 'REG_PHONE_EXISTS',
    REG_PASSWORD_TOO_SHORT: 'REG_PASSWORD_TOO_SHORT',
    REG_INVALID_EMAIL: 'REG_INVALID_EMAIL',

    // ================================================================
    // USER ERRORS (USER_*)
    // ================================================================
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    USER_UPDATE_FAILED: 'USER_UPDATE_FAILED',
    USER_CREATION_FAILED: 'USER_CREATION_FAILED',
    USER_DELETION_FAILED: 'USER_DELETION_FAILED',

    // ================================================================
    // STORE ERRORS (STORE_*)
    // ================================================================
    STORE_NOT_FOUND: 'STORE_NOT_FOUND',
    STORE_ACCESS_DENIED: 'STORE_ACCESS_DENIED',
    STORE_CREATION_FAILED: 'STORE_CREATION_FAILED',
    STORE_UPDATE_FAILED: 'STORE_UPDATE_FAILED',
    STORE_LIMIT_REACHED: 'STORE_LIMIT_REACHED',

    // ================================================================
    // ORDER ERRORS (ORDER_*)
    // ================================================================
    ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
    ORDER_CREATION_FAILED: 'ORDER_CREATION_FAILED',
    ORDER_UPDATE_FAILED: 'ORDER_UPDATE_FAILED',
    ORDER_DELETION_BLOCKED: 'ORDER_DELETION_BLOCKED',
    ORDER_INVALID_STATUS: 'ORDER_INVALID_STATUS',
    ORDER_LIMIT_REACHED: 'ORDER_LIMIT_REACHED',
    ORDER_ALREADY_SHIPPED: 'ORDER_ALREADY_SHIPPED',
    ORDER_STOCK_INSUFFICIENT: 'ORDER_STOCK_INSUFFICIENT',

    // ================================================================
    // PRODUCT ERRORS (PROD_*)
    // ================================================================
    PROD_NOT_FOUND: 'PROD_NOT_FOUND',
    PROD_CREATION_FAILED: 'PROD_CREATION_FAILED',
    PROD_UPDATE_FAILED: 'PROD_UPDATE_FAILED',
    PROD_DELETION_BLOCKED: 'PROD_DELETION_BLOCKED',
    PROD_SKU_EXISTS: 'PROD_SKU_EXISTS',
    PROD_LIMIT_REACHED: 'PROD_LIMIT_REACHED',
    PROD_INVALID_STOCK: 'PROD_INVALID_STOCK',
    PROD_SYNC_FAILED: 'PROD_SYNC_FAILED',

    // ================================================================
    // INVENTORY ERRORS (INV_*)
    // ================================================================
    INV_INSUFFICIENT_STOCK: 'INV_INSUFFICIENT_STOCK',
    INV_UPDATE_FAILED: 'INV_UPDATE_FAILED',
    INV_NEGATIVE_STOCK: 'INV_NEGATIVE_STOCK',

    // ================================================================
    // WAREHOUSE ERRORS (WH_*)
    // ================================================================
    WH_SESSION_NOT_FOUND: 'WH_SESSION_NOT_FOUND',
    WH_SESSION_CREATION_FAILED: 'WH_SESSION_CREATION_FAILED',
    WH_SESSION_ALREADY_COMPLETED: 'WH_SESSION_ALREADY_COMPLETED',
    WH_INVALID_TRANSITION: 'WH_INVALID_TRANSITION',
    WH_ORDER_NOT_IN_SESSION: 'WH_ORDER_NOT_IN_SESSION',

    // ================================================================
    // DISPATCH/SETTLEMENT ERRORS (DISP_*)
    // ================================================================
    DISP_SESSION_NOT_FOUND: 'DISP_SESSION_NOT_FOUND',
    DISP_ORDER_ALREADY_DISPATCHED: 'DISP_ORDER_ALREADY_DISPATCHED',
    DISP_CARRIER_NO_ZONES: 'DISP_CARRIER_NO_ZONES',
    DISP_SETTLEMENT_FAILED: 'DISP_SETTLEMENT_FAILED',
    DISP_CSV_PARSE_ERROR: 'DISP_CSV_PARSE_ERROR',

    // ================================================================
    // CARRIER ERRORS (CARRIER_*)
    // ================================================================
    CARRIER_NOT_FOUND: 'CARRIER_NOT_FOUND',
    CARRIER_DELETION_BLOCKED: 'CARRIER_DELETION_BLOCKED',
    CARRIER_NO_ZONES: 'CARRIER_NO_ZONES',

    // ================================================================
    // SHOPIFY ERRORS (SHOPIFY_*)
    // ================================================================
    SHOPIFY_NOT_CONNECTED: 'SHOPIFY_NOT_CONNECTED',
    SHOPIFY_SYNC_FAILED: 'SHOPIFY_SYNC_FAILED',
    SHOPIFY_RATE_LIMITED: 'SHOPIFY_RATE_LIMITED',
    SHOPIFY_WEBHOOK_INVALID: 'SHOPIFY_WEBHOOK_INVALID',
    SHOPIFY_IMPORT_FAILED: 'SHOPIFY_IMPORT_FAILED',
    SHOPIFY_API_ERROR: 'SHOPIFY_API_ERROR',

    // ================================================================
    // BILLING ERRORS (BILL_*)
    // ================================================================
    BILL_SUBSCRIPTION_NOT_FOUND: 'BILL_SUBSCRIPTION_NOT_FOUND',
    BILL_PLAN_LIMIT_REACHED: 'BILL_PLAN_LIMIT_REACHED',
    BILL_FEATURE_NOT_AVAILABLE: 'BILL_FEATURE_NOT_AVAILABLE',
    BILL_PAYMENT_FAILED: 'BILL_PAYMENT_FAILED',
    BILL_TRIAL_ALREADY_USED: 'BILL_TRIAL_ALREADY_USED',
    BILL_DOWNGRADE_BLOCKED: 'BILL_DOWNGRADE_BLOCKED',

    // ================================================================
    // VALIDATION ERRORS (VAL_*)
    // ================================================================
    VAL_MISSING_FIELDS: 'VAL_MISSING_FIELDS',
    VAL_INVALID_FORMAT: 'VAL_INVALID_FORMAT',
    VAL_INVALID_VALUE: 'VAL_INVALID_VALUE',
    VAL_CONSTRAINT_VIOLATION: 'VAL_CONSTRAINT_VIOLATION',

    // ================================================================
    // DATABASE ERRORS (DB_*)
    // ================================================================
    DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
    DB_QUERY_ERROR: 'DB_QUERY_ERROR',
    DB_CONSTRAINT_VIOLATION: 'DB_CONSTRAINT_VIOLATION',
    DB_DUPLICATE_KEY: 'DB_DUPLICATE_KEY',
    DB_FOREIGN_KEY_ERROR: 'DB_FOREIGN_KEY_ERROR',

    // ================================================================
    // RATE LIMITING ERRORS (RATE_*)
    // ================================================================
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    RATE_AUTH_LIMIT_EXCEEDED: 'RATE_AUTH_LIMIT_EXCEEDED',
    RATE_WEBHOOK_LIMIT_EXCEEDED: 'RATE_WEBHOOK_LIMIT_EXCEEDED',

    // ================================================================
    // EXTERNAL SERVICE ERRORS (EXT_*)
    // ================================================================
    EXT_SERVICE_UNAVAILABLE: 'EXT_SERVICE_UNAVAILABLE',
    EXT_TIMEOUT: 'EXT_TIMEOUT',
    EXT_INVALID_RESPONSE: 'EXT_INVALID_RESPONSE',

    // ================================================================
    // INTERNAL ERRORS (INT_*)
    // ================================================================
    INT_INTERNAL_ERROR: 'INT_INTERNAL_ERROR',
    INT_NOT_IMPLEMENTED: 'INT_NOT_IMPLEMENTED',
    INT_CONFIGURATION_ERROR: 'INT_CONFIGURATION_ERROR',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/**
 * User-friendly error messages in Spanish
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
    // Auth
    [ERROR_CODES.AUTH_MISSING_CREDENTIALS]: 'Por favor ingresa tu email y contraseña',
    [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 'Email o contraseña incorrectos',
    [ERROR_CODES.AUTH_ACCOUNT_INACTIVE]: 'Tu cuenta ha sido desactivada',
    [ERROR_CODES.AUTH_ACCESS_REVOKED]: 'Tu acceso ha sido revocado. Contacta al administrador.',
    [ERROR_CODES.AUTH_TOKEN_EXPIRED]: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
    [ERROR_CODES.AUTH_TOKEN_INVALID]: 'Sesión inválida. Por favor inicia sesión nuevamente.',
    [ERROR_CODES.AUTH_UNAUTHORIZED]: 'No tienes permiso para realizar esta acción',
    [ERROR_CODES.AUTH_SESSION_EXPIRED]: 'Tu sesión ha expirado',

    // Registration
    [ERROR_CODES.REG_MISSING_FIELDS]: 'Por favor completa todos los campos requeridos',
    [ERROR_CODES.REG_EMAIL_EXISTS]: 'Este email ya está registrado',
    [ERROR_CODES.REG_PHONE_EXISTS]: 'Este teléfono ya está registrado con otra cuenta',
    [ERROR_CODES.REG_PASSWORD_TOO_SHORT]: 'La contraseña debe tener al menos 8 caracteres',
    [ERROR_CODES.REG_INVALID_EMAIL]: 'Por favor ingresa un email válido',

    // User
    [ERROR_CODES.USER_NOT_FOUND]: 'Usuario no encontrado',
    [ERROR_CODES.USER_UPDATE_FAILED]: 'No se pudo actualizar el usuario',
    [ERROR_CODES.USER_CREATION_FAILED]: 'No se pudo crear el usuario',
    [ERROR_CODES.USER_DELETION_FAILED]: 'No se pudo eliminar el usuario',

    // Store
    [ERROR_CODES.STORE_NOT_FOUND]: 'Tienda no encontrada',
    [ERROR_CODES.STORE_ACCESS_DENIED]: 'No tienes acceso a esta tienda',
    [ERROR_CODES.STORE_CREATION_FAILED]: 'No se pudo crear la tienda',
    [ERROR_CODES.STORE_UPDATE_FAILED]: 'No se pudo actualizar la tienda',
    [ERROR_CODES.STORE_LIMIT_REACHED]: 'Has alcanzado el límite de tiendas de tu plan',

    // Order
    [ERROR_CODES.ORDER_NOT_FOUND]: 'Pedido no encontrado',
    [ERROR_CODES.ORDER_CREATION_FAILED]: 'No se pudo crear el pedido',
    [ERROR_CODES.ORDER_UPDATE_FAILED]: 'No se pudo actualizar el pedido',
    [ERROR_CODES.ORDER_DELETION_BLOCKED]: 'No se puede eliminar este pedido',
    [ERROR_CODES.ORDER_INVALID_STATUS]: 'Estado de pedido inválido',
    [ERROR_CODES.ORDER_LIMIT_REACHED]: 'Has alcanzado el límite de pedidos de tu plan',
    [ERROR_CODES.ORDER_ALREADY_SHIPPED]: 'Este pedido ya fue despachado',
    [ERROR_CODES.ORDER_STOCK_INSUFFICIENT]: 'Stock insuficiente para este pedido',

    // Product
    [ERROR_CODES.PROD_NOT_FOUND]: 'Producto no encontrado',
    [ERROR_CODES.PROD_CREATION_FAILED]: 'No se pudo crear el producto',
    [ERROR_CODES.PROD_UPDATE_FAILED]: 'No se pudo actualizar el producto',
    [ERROR_CODES.PROD_DELETION_BLOCKED]: 'No se puede eliminar este producto',
    [ERROR_CODES.PROD_SKU_EXISTS]: 'Este SKU ya existe',
    [ERROR_CODES.PROD_LIMIT_REACHED]: 'Has alcanzado el límite de productos de tu plan',
    [ERROR_CODES.PROD_INVALID_STOCK]: 'El stock no puede ser negativo',
    [ERROR_CODES.PROD_SYNC_FAILED]: 'No se pudo sincronizar con Shopify',

    // Inventory
    [ERROR_CODES.INV_INSUFFICIENT_STOCK]: 'Stock insuficiente',
    [ERROR_CODES.INV_UPDATE_FAILED]: 'No se pudo actualizar el inventario',
    [ERROR_CODES.INV_NEGATIVE_STOCK]: 'El stock no puede ser negativo',

    // Warehouse
    [ERROR_CODES.WH_SESSION_NOT_FOUND]: 'Sesión de picking no encontrada',
    [ERROR_CODES.WH_SESSION_CREATION_FAILED]: 'No se pudo crear la sesión de picking',
    [ERROR_CODES.WH_SESSION_ALREADY_COMPLETED]: 'Esta sesión ya fue completada',
    [ERROR_CODES.WH_INVALID_TRANSITION]: 'Transición de estado inválida',
    [ERROR_CODES.WH_ORDER_NOT_IN_SESSION]: 'El pedido no está en esta sesión',

    // Dispatch
    [ERROR_CODES.DISP_SESSION_NOT_FOUND]: 'Sesión de despacho no encontrada',
    [ERROR_CODES.DISP_ORDER_ALREADY_DISPATCHED]: 'Este pedido ya fue despachado',
    [ERROR_CODES.DISP_CARRIER_NO_ZONES]: 'El transportista no tiene zonas configuradas',
    [ERROR_CODES.DISP_SETTLEMENT_FAILED]: 'No se pudo procesar la liquidación',
    [ERROR_CODES.DISP_CSV_PARSE_ERROR]: 'Error al procesar el archivo CSV',

    // Carrier
    [ERROR_CODES.CARRIER_NOT_FOUND]: 'Transportista no encontrado',
    [ERROR_CODES.CARRIER_DELETION_BLOCKED]: 'No se puede eliminar este transportista',
    [ERROR_CODES.CARRIER_NO_ZONES]: 'El transportista no tiene zonas configuradas',

    // Shopify
    [ERROR_CODES.SHOPIFY_NOT_CONNECTED]: 'No hay conexión con Shopify',
    [ERROR_CODES.SHOPIFY_SYNC_FAILED]: 'No se pudo sincronizar con Shopify',
    [ERROR_CODES.SHOPIFY_RATE_LIMITED]: 'Shopify está limitando las solicitudes. Intenta en unos minutos.',
    [ERROR_CODES.SHOPIFY_WEBHOOK_INVALID]: 'Webhook de Shopify inválido',
    [ERROR_CODES.SHOPIFY_IMPORT_FAILED]: 'No se pudo importar desde Shopify',
    [ERROR_CODES.SHOPIFY_API_ERROR]: 'Error de comunicación con Shopify',

    // Billing
    [ERROR_CODES.BILL_SUBSCRIPTION_NOT_FOUND]: 'Suscripción no encontrada',
    [ERROR_CODES.BILL_PLAN_LIMIT_REACHED]: 'Has alcanzado el límite de tu plan actual',
    [ERROR_CODES.BILL_FEATURE_NOT_AVAILABLE]: 'Esta función no está disponible en tu plan',
    [ERROR_CODES.BILL_PAYMENT_FAILED]: 'El pago no pudo ser procesado',
    [ERROR_CODES.BILL_TRIAL_ALREADY_USED]: 'Ya utilizaste tu período de prueba',
    [ERROR_CODES.BILL_DOWNGRADE_BLOCKED]: 'Debes reducir tu uso antes de cambiar de plan',

    // Validation
    [ERROR_CODES.VAL_MISSING_FIELDS]: 'Faltan campos requeridos',
    [ERROR_CODES.VAL_INVALID_FORMAT]: 'Formato inválido',
    [ERROR_CODES.VAL_INVALID_VALUE]: 'Valor inválido',
    [ERROR_CODES.VAL_CONSTRAINT_VIOLATION]: 'El valor no cumple con las restricciones',

    // Database
    [ERROR_CODES.DB_CONNECTION_ERROR]: 'Error de conexión con la base de datos',
    [ERROR_CODES.DB_QUERY_ERROR]: 'Error al procesar la solicitud',
    [ERROR_CODES.DB_CONSTRAINT_VIOLATION]: 'La operación viola una restricción',
    [ERROR_CODES.DB_DUPLICATE_KEY]: 'Ya existe un registro con estos datos',
    [ERROR_CODES.DB_FOREIGN_KEY_ERROR]: 'El registro referenciado no existe',

    // Rate Limiting
    [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 'Demasiadas solicitudes. Intenta en unos minutos.',
    [ERROR_CODES.RATE_AUTH_LIMIT_EXCEEDED]: 'Demasiados intentos. Espera 15 minutos.',
    [ERROR_CODES.RATE_WEBHOOK_LIMIT_EXCEEDED]: 'Límite de webhooks excedido',

    // External
    [ERROR_CODES.EXT_SERVICE_UNAVAILABLE]: 'El servicio externo no está disponible',
    [ERROR_CODES.EXT_TIMEOUT]: 'La solicitud tardó demasiado. Intenta nuevamente.',
    [ERROR_CODES.EXT_INVALID_RESPONSE]: 'Respuesta inválida del servicio externo',

    // Internal
    [ERROR_CODES.INT_INTERNAL_ERROR]: 'Ha ocurrido un error. Por favor intenta nuevamente.',
    [ERROR_CODES.INT_NOT_IMPLEMENTED]: 'Esta función aún no está disponible',
    [ERROR_CODES.INT_CONFIGURATION_ERROR]: 'Error de configuración del sistema',
};

/**
 * HTTP status codes for each error
 */
export const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
    // Auth - 401/403
    [ERROR_CODES.AUTH_MISSING_CREDENTIALS]: 400,
    [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 401,
    [ERROR_CODES.AUTH_ACCOUNT_INACTIVE]: 401,
    [ERROR_CODES.AUTH_ACCESS_REVOKED]: 403,
    [ERROR_CODES.AUTH_TOKEN_EXPIRED]: 401,
    [ERROR_CODES.AUTH_TOKEN_INVALID]: 401,
    [ERROR_CODES.AUTH_UNAUTHORIZED]: 403,
    [ERROR_CODES.AUTH_SESSION_EXPIRED]: 401,

    // Registration - 400/409
    [ERROR_CODES.REG_MISSING_FIELDS]: 400,
    [ERROR_CODES.REG_EMAIL_EXISTS]: 409,
    [ERROR_CODES.REG_PHONE_EXISTS]: 409,
    [ERROR_CODES.REG_PASSWORD_TOO_SHORT]: 400,
    [ERROR_CODES.REG_INVALID_EMAIL]: 400,

    // User - 404/500
    [ERROR_CODES.USER_NOT_FOUND]: 404,
    [ERROR_CODES.USER_UPDATE_FAILED]: 500,
    [ERROR_CODES.USER_CREATION_FAILED]: 500,
    [ERROR_CODES.USER_DELETION_FAILED]: 500,

    // Store - 403/404/500
    [ERROR_CODES.STORE_NOT_FOUND]: 404,
    [ERROR_CODES.STORE_ACCESS_DENIED]: 403,
    [ERROR_CODES.STORE_CREATION_FAILED]: 500,
    [ERROR_CODES.STORE_UPDATE_FAILED]: 500,
    [ERROR_CODES.STORE_LIMIT_REACHED]: 403,

    // Order
    [ERROR_CODES.ORDER_NOT_FOUND]: 404,
    [ERROR_CODES.ORDER_CREATION_FAILED]: 500,
    [ERROR_CODES.ORDER_UPDATE_FAILED]: 500,
    [ERROR_CODES.ORDER_DELETION_BLOCKED]: 409,
    [ERROR_CODES.ORDER_INVALID_STATUS]: 400,
    [ERROR_CODES.ORDER_LIMIT_REACHED]: 403,
    [ERROR_CODES.ORDER_ALREADY_SHIPPED]: 409,
    [ERROR_CODES.ORDER_STOCK_INSUFFICIENT]: 409,

    // Product
    [ERROR_CODES.PROD_NOT_FOUND]: 404,
    [ERROR_CODES.PROD_CREATION_FAILED]: 500,
    [ERROR_CODES.PROD_UPDATE_FAILED]: 500,
    [ERROR_CODES.PROD_DELETION_BLOCKED]: 409,
    [ERROR_CODES.PROD_SKU_EXISTS]: 409,
    [ERROR_CODES.PROD_LIMIT_REACHED]: 403,
    [ERROR_CODES.PROD_INVALID_STOCK]: 400,
    [ERROR_CODES.PROD_SYNC_FAILED]: 500,

    // Inventory
    [ERROR_CODES.INV_INSUFFICIENT_STOCK]: 409,
    [ERROR_CODES.INV_UPDATE_FAILED]: 500,
    [ERROR_CODES.INV_NEGATIVE_STOCK]: 400,

    // Warehouse
    [ERROR_CODES.WH_SESSION_NOT_FOUND]: 404,
    [ERROR_CODES.WH_SESSION_CREATION_FAILED]: 500,
    [ERROR_CODES.WH_SESSION_ALREADY_COMPLETED]: 409,
    [ERROR_CODES.WH_INVALID_TRANSITION]: 400,
    [ERROR_CODES.WH_ORDER_NOT_IN_SESSION]: 404,

    // Dispatch
    [ERROR_CODES.DISP_SESSION_NOT_FOUND]: 404,
    [ERROR_CODES.DISP_ORDER_ALREADY_DISPATCHED]: 409,
    [ERROR_CODES.DISP_CARRIER_NO_ZONES]: 400,
    [ERROR_CODES.DISP_SETTLEMENT_FAILED]: 500,
    [ERROR_CODES.DISP_CSV_PARSE_ERROR]: 400,

    // Carrier
    [ERROR_CODES.CARRIER_NOT_FOUND]: 404,
    [ERROR_CODES.CARRIER_DELETION_BLOCKED]: 409,
    [ERROR_CODES.CARRIER_NO_ZONES]: 400,

    // Shopify
    [ERROR_CODES.SHOPIFY_NOT_CONNECTED]: 400,
    [ERROR_CODES.SHOPIFY_SYNC_FAILED]: 500,
    [ERROR_CODES.SHOPIFY_RATE_LIMITED]: 429,
    [ERROR_CODES.SHOPIFY_WEBHOOK_INVALID]: 400,
    [ERROR_CODES.SHOPIFY_IMPORT_FAILED]: 500,
    [ERROR_CODES.SHOPIFY_API_ERROR]: 502,

    // Billing
    [ERROR_CODES.BILL_SUBSCRIPTION_NOT_FOUND]: 404,
    [ERROR_CODES.BILL_PLAN_LIMIT_REACHED]: 403,
    [ERROR_CODES.BILL_FEATURE_NOT_AVAILABLE]: 403,
    [ERROR_CODES.BILL_PAYMENT_FAILED]: 402,
    [ERROR_CODES.BILL_TRIAL_ALREADY_USED]: 409,
    [ERROR_CODES.BILL_DOWNGRADE_BLOCKED]: 409,

    // Validation - 400
    [ERROR_CODES.VAL_MISSING_FIELDS]: 400,
    [ERROR_CODES.VAL_INVALID_FORMAT]: 400,
    [ERROR_CODES.VAL_INVALID_VALUE]: 400,
    [ERROR_CODES.VAL_CONSTRAINT_VIOLATION]: 400,

    // Database - 500
    [ERROR_CODES.DB_CONNECTION_ERROR]: 503,
    [ERROR_CODES.DB_QUERY_ERROR]: 500,
    [ERROR_CODES.DB_CONSTRAINT_VIOLATION]: 409,
    [ERROR_CODES.DB_DUPLICATE_KEY]: 409,
    [ERROR_CODES.DB_FOREIGN_KEY_ERROR]: 400,

    // Rate Limiting - 429
    [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 429,
    [ERROR_CODES.RATE_AUTH_LIMIT_EXCEEDED]: 429,
    [ERROR_CODES.RATE_WEBHOOK_LIMIT_EXCEEDED]: 429,

    // External - 502/503/504
    [ERROR_CODES.EXT_SERVICE_UNAVAILABLE]: 503,
    [ERROR_CODES.EXT_TIMEOUT]: 504,
    [ERROR_CODES.EXT_INVALID_RESPONSE]: 502,

    // Internal - 500/501
    [ERROR_CODES.INT_INTERNAL_ERROR]: 500,
    [ERROR_CODES.INT_NOT_IMPLEMENTED]: 501,
    [ERROR_CODES.INT_CONFIGURATION_ERROR]: 500,
};

/**
 * Create a standardized API error response
 */
export function createErrorResponse(
    code: ErrorCode,
    additionalDetails?: Record<string, any>
): {
    success: false;
    error: string;
    code: ErrorCode;
    details?: Record<string, any>;
    timestamp: string;
} {
    return {
        success: false,
        error: ERROR_MESSAGES[code],
        code,
        ...(additionalDetails && { details: additionalDetails }),
        timestamp: new Date().toISOString(),
    };
}

/**
 * Get HTTP status code for an error code
 */
export function getStatusCode(code: ErrorCode): number {
    return ERROR_STATUS_CODES[code] || 500;
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
    public readonly code: ErrorCode;
    public readonly statusCode: number;
    public readonly details?: Record<string, any>;

    constructor(code: ErrorCode, details?: Record<string, any>) {
        super(ERROR_MESSAGES[code]);
        this.code = code;
        this.statusCode = ERROR_STATUS_CODES[code];
        this.details = details;
        this.name = 'ApiError';

        // Maintains proper stack trace for where error was thrown
        Error.captureStackTrace(this, ApiError);
    }

    toResponse() {
        return createErrorResponse(this.code, this.details);
    }
}

export default ERROR_CODES;
