/**
 * Error Message Formatter
 * Converts technical errors into user-friendly, actionable messages
 */

export interface ErrorContext {
  module?: string;
  action?: string;
  entity?: string;
  variant?: 'default' | 'destructive';
  details?: Record<string, any>;
}

export interface FormattedError {
  title: string;
  message: string;
  action?: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * Error codes that indicate user flow issues (not technical problems)
 */
const USER_ERROR_CODES: Record<string, (ctx: ErrorContext) => FormattedError> = {
  // Stock & Inventory
  INSUFFICIENT_STOCK: (ctx) => ({
    title: 'Stock insuficiente',
    message: `No hay suficiente stock de "${ctx.details?.productName || 'este producto'}". Stock actual: ${ctx.details?.currentStock || 0}, necesitas: ${ctx.details?.required || 0}.`,
    action: 'Ve a Productos → Encuentra el producto → Aumenta el stock o recibe mercadería pendiente en Mercadería.',
    severity: 'warning',
  }),

  NO_STOCK_TO_DECREASE: (ctx) => ({
    title: 'Stock en cero',
    message: `El producto "${ctx.details?.productName}" no tiene stock disponible para decrementar.`,
    action: 'Ve a Mercadería → Crea una recepción de inventario para este producto.',
    severity: 'warning',
  }),

  PRODUCT_NOT_FOUND: (ctx) => ({
    title: 'Producto no encontrado',
    message: ctx.details?.shopifyProduct
      ? `El producto de Shopify "${ctx.details.productName}" no está vinculado en tu inventario.`
      : `No se encontró el producto "${ctx.details?.productName || ctx.details?.productId}".`,
    action: ctx.details?.shopifyProduct
      ? 'Ve a Integraciones → Shopify → Importa el producto o créalo manualmente en Productos.'
      : 'Verifica que el producto exista en la sección Productos.',
    severity: 'error',
  }),

  // Orders
  ORDER_ALREADY_PROCESSED: (ctx) => ({
    title: 'Pedido ya procesado',
    message: `Este pedido ya fue procesado y se encuentra en estado "${ctx.details?.status}".`,
    action: 'No puedes modificar pedidos que ya están en preparación o enviados. Si necesitas hacer cambios, contacta al cliente.',
    severity: 'warning',
  }),

  ORDER_CANNOT_BE_DELETED: (ctx) => ({
    title: 'No se puede eliminar',
    message: `Los pedidos en estado "${ctx.details?.status}" no pueden eliminarse porque ya se descontó el inventario.`,
    action: 'Si necesitas cancelar este pedido, usa el botón "Cancelar Pedido" para restaurar el stock automáticamente.',
    severity: 'error',
  }),

  INVALID_STATUS_TRANSITION: (ctx) => ({
    title: 'Cambio de estado no permitido',
    message: ctx.details?.message || `No puedes cambiar de "${ctx.details?.fromLabel || ctx.details?.from}" a "${ctx.details?.toLabel || ctx.details?.to}".`,
    action: ctx.details?.suggestion || `Flujo normal: Pendiente → Confirmado → En Preparación → Listo para Enviar → En Tránsito → Entregado.\n\nPuedes cancelar pedidos en cualquier momento antes de la entrega.`,
    severity: 'warning',
  }),

  ORDER_MISSING_CUSTOMER: (ctx) => ({
    title: 'Falta información del cliente',
    message: 'No puedes crear un pedido sin seleccionar un cliente.',
    action: 'Ve a Clientes → Crea el cliente primero, o selecciona uno existente.',
    severity: 'error',
  }),

  ORDER_MISSING_PRODUCTS: (ctx) => ({
    title: 'Pedido sin productos',
    message: 'Debes agregar al menos un producto al pedido.',
    action: 'Haz clic en "Agregar Producto" y selecciona los productos que el cliente ordenó.',
    severity: 'error',
  }),

  // Warehouse
  SESSION_ALREADY_COMPLETED: (ctx) => ({
    title: 'Sesión ya completada',
    message: `La sesión ${ctx.details?.sessionCode} ya fue completada anteriormente.`,
    action: 'No puedes modificar sesiones completadas. Crea una nueva sesión para procesar más pedidos.',
    severity: 'info',
  }),

  NO_ORDERS_SELECTED: (ctx) => ({
    title: 'No hay pedidos seleccionados',
    message: 'Debes seleccionar al menos un pedido para crear una sesión de picking.',
    action: 'En el Dashboard de Almacén, marca los pedidos que quieres procesar y luego haz clic en "Crear Sesión".',
    severity: 'warning',
  }),

  ORDERS_NOT_CONFIRMED: (ctx) => ({
    title: 'Pedidos no confirmados',
    message: `${ctx.details?.count || 'Algunos'} pedidos seleccionados no están confirmados.`,
    action: 'Solo puedes procesar pedidos en estado "Confirmado". Ve a Pedidos → Confirma los pedidos pendientes primero.',
    severity: 'warning',
  }),

  PICKING_INCOMPLETE: (ctx) => ({
    title: 'Picking incompleto',
    message: `Faltan ${ctx.details?.remaining || 0} productos por recoger.`,
    action: 'Completa el picking de todos los productos antes de pasar al empaque.',
    severity: 'warning',
  }),

  PACKING_INCOMPLETE: (ctx) => ({
    title: 'Empaque incompleto',
    message: `Hay ${ctx.details?.count || 0} items pendientes de empacar.`,
    action: 'Asegúrate de empacar todos los productos de cada pedido antes de finalizar la sesión.',
    severity: 'warning',
  }),

  WAREHOUSE_STOCK_INSUFFICIENT: (ctx) => ({
    title: 'Stock insuficiente',
    message: ctx.details?.productName
      ? `No hay suficiente stock de "${ctx.details.productName}".`
      : 'Uno o más productos no tienen stock suficiente.',
    action: 'Ve a Mercadería → Crea una recepción de inventario, o ajusta el stock en Productos.',
    severity: 'warning',
  }),

  WAREHOUSE_STOCK_CHANGED: (ctx) => ({
    title: 'Stock modificado',
    message: 'El stock cambió mientras preparabas los pedidos.',
    action: 'Cancela esta sesión y crea una nueva con los pedidos actualizados, o recibe mercadería para reponer el stock.',
    severity: 'warning',
  }),

  // Shopify Integration
  SHOPIFY_NOT_CONNECTED: (ctx) => ({
    title: 'Shopify no conectado',
    message: 'Tu tienda no está conectada a Shopify.',
    action: 'Ve a Integraciones → Shopify → Haz clic en "Conectar con Shopify" y sigue los pasos.',
    severity: 'error',
  }),

  SHOPIFY_IMPORT_IN_PROGRESS: (ctx) => ({
    title: 'Importación en progreso',
    message: 'Ya hay una importación de Shopify en curso.',
    action: 'Espera a que termine la importación actual (puede tomar varios minutos). Revisa el progreso en la sección Integraciones.',
    severity: 'info',
  }),

  SHOPIFY_SYNC_FAILED: (ctx) => ({
    title: 'Sincronización fallida',
    message: `No se pudo sincronizar "${ctx.details?.productName}" con Shopify.`,
    action: ctx.details?.reason === 'not_found'
      ? 'El producto fue eliminado en Shopify. Crea uno nuevo o vuelve a importar desde Shopify.'
      : 'Verifica que el producto tenga SKU y que tu integración de Shopify esté activa.',
    severity: 'warning',
  }),

  // Team & Permissions
  PERMISSION_DENIED: (ctx) => ({
    title: 'Sin permisos',
    message: `Tu rol "${ctx.details?.role}" no tiene acceso a ${ctx.details?.module || 'esta función'}.`,
    action: 'Contacta al dueño de la cuenta para solicitar permisos adicionales o cambio de rol.',
    severity: 'error',
  }),

  USER_LIMIT_REACHED: (ctx) => ({
    title: 'Límite de usuarios alcanzado',
    message: `Tu plan "${ctx.details?.plan}" permite máximo ${ctx.details?.max} usuarios. Actualmente tienes ${ctx.details?.current}.`,
    action: 'Ve a Facturación → Actualiza tu plan para agregar más miembros al equipo.',
    severity: 'warning',
  }),

  INVALID_INVITATION_TOKEN: (ctx) => ({
    title: 'Invitación inválida',
    message: 'Este enlace de invitación expiró o ya fue usado.',
    action: 'Solicita una nueva invitación al administrador de la cuenta.',
    severity: 'error',
  }),

  // Billing
  SUBSCRIPTION_EXPIRED: (ctx) => ({
    title: 'Suscripción vencida',
    message: 'Tu suscripción ha expirado.',
    action: 'Ve a Facturación → Reactiva tu suscripción para continuar usando todas las funciones.',
    severity: 'error',
  }),

  FEATURE_NOT_AVAILABLE: (ctx) => ({
    title: 'Función no disponible',
    message: `"${ctx.details?.feature}" no está disponible en tu plan "${ctx.details?.plan}".`,
    action: `Ve a Facturación → Actualiza a plan ${ctx.details?.requiredPlan} para desbloquear esta función.`,
    severity: 'warning',
  }),

  TRIAL_EXPIRED: (ctx) => ({
    title: 'Prueba gratuita terminada',
    message: 'Tu periodo de prueba de 14 días ha finalizado.',
    action: 'Ve a Facturación → Selecciona un plan para continuar usando Ordefy.',
    severity: 'warning',
  }),

  // Phone Verification
  PHONE_ALREADY_VERIFIED: (ctx) => ({
    title: 'Teléfono ya verificado',
    message: 'Tu número de teléfono ya está verificado.',
    action: 'Puedes continuar usando la plataforma normalmente.',
    severity: 'info',
  }),

  PHONE_IN_USE: (ctx) => ({
    title: 'Número en uso',
    message: 'Este número de teléfono ya está registrado en otra cuenta.',
    action: 'Si es tu cuenta, ve a Recuperación de Cuenta. Si no, usa otro número de teléfono.',
    severity: 'error',
  }),

  INVALID_VERIFICATION_CODE: (ctx) => ({
    title: 'Código incorrecto',
    message: `Código de verificación inválido. Te quedan ${ctx.details?.attemptsLeft || 0} intentos.`,
    action: ctx.details?.attemptsLeft === 0
      ? 'Se agotaron los intentos. Solicita un nuevo código de verificación.'
      : 'Verifica el código enviado por WhatsApp e intenta nuevamente.',
    severity: 'warning',
  }),

  VERIFICATION_CODE_EXPIRED: (ctx) => ({
    title: 'Código expirado',
    message: 'El código de verificación expiró (válido por 10 minutos).',
    action: 'Solicita un nuevo código de verificación.',
    severity: 'warning',
  }),

  RATE_LIMIT_EXCEEDED: (ctx) => ({
    title: 'Demasiados intentos',
    message: `Debes esperar ${ctx.details?.waitTime || 60} segundos antes de solicitar otro código.`,
    action: 'Revisa tu WhatsApp, es posible que el código ya haya llegado.',
    severity: 'info',
  }),

  // Returns
  ORDER_NOT_ELIGIBLE_FOR_RETURN: (ctx) => ({
    title: 'No elegible para devolución',
    message: `Los pedidos en estado "${ctx.details?.status}" no pueden ser devueltos.`,
    action: 'Solo puedes procesar devoluciones de pedidos Entregados, Enviados o Cancelados.',
    severity: 'warning',
  }),

  RETURN_SESSION_EMPTY: (ctx) => ({
    title: 'Sesión de devolución vacía',
    message: 'No hay productos para procesar en esta sesión.',
    action: 'Agrega al menos un pedido con productos para devolver.',
    severity: 'warning',
  }),

  // Generic validation
  MISSING_REQUIRED_FIELDS: (ctx) => ({
    title: 'Campos requeridos faltantes',
    message: `Faltan campos obligatorios: ${ctx.details?.fields?.join(', ') || 'varios campos'}.`,
    action: 'Completa todos los campos marcados con asterisco (*) antes de continuar.',
    severity: 'warning',
  }),

  INVALID_INPUT: (ctx) => ({
    title: 'Datos inválidos',
    message: ctx.details?.field
      ? `El campo "${ctx.details.field}" tiene un formato inválido.`
      : 'Algunos datos ingresados no son válidos.',
    action: ctx.details?.expectedFormat
      ? `Formato esperado: ${ctx.details.expectedFormat}`
      : 'Revisa que todos los campos tengan el formato correcto.',
    severity: 'warning',
  }),

  DUPLICATE_ENTRY: (ctx) => ({
    title: 'Registro duplicado',
    message: `Ya existe ${ctx.details?.entity || 'un registro'} con ${ctx.details?.field}: "${ctx.details?.value}".`,
    action: 'Usa un valor diferente o edita el registro existente.',
    severity: 'warning',
  }),
};

/**
 * Technical error messages (for infrastructure/code issues)
 */
const TECHNICAL_ERROR_CODES: Record<string, string> = {
  DATABASE_ERROR: 'Error de base de datos. Intenta nuevamente en unos segundos.',
  NETWORK_ERROR: 'Error de conexión. Verifica tu internet e intenta nuevamente.',
  TIMEOUT: 'La operación tardó demasiado. Intenta nuevamente.',
  UNAUTHORIZED: 'Tu sesión expiró. Por favor inicia sesión nuevamente.',
  SERVER_ERROR: 'Error del servidor. Nuestro equipo fue notificado.',
  RATE_LIMITED: 'Demasiadas solicitudes. Espera un momento e intenta nuevamente.',
};

/**
 * Formats an error into a user-friendly message
 */
export function formatError(
  error: any,
  context: ErrorContext = {}
): FormattedError {
  // If error is already formatted
  if (error?.title && error?.message) {
    return error;
  }

  // Extract error code from various formats
  const errorCode =
    error?.code ||
    error?.error?.code ||
    error?.response?.data?.code ||
    error?.response?.data?.error?.code;

  // User flow errors (actionable)
  if (errorCode && USER_ERROR_CODES[errorCode]) {
    return USER_ERROR_CODES[errorCode](context);
  }

  // Technical errors
  if (errorCode && TECHNICAL_ERROR_CODES[errorCode]) {
    return {
      title: 'Error técnico',
      message: TECHNICAL_ERROR_CODES[errorCode],
      severity: 'error',
    };
  }

  // HTTP status code errors
  const status = error?.response?.status || error?.status;
  if (status) {
    if (status === 401) {
      return {
        title: 'Sesión expirada',
        message: 'Tu sesión expiró. Por favor inicia sesión nuevamente.',
        action: 'Haz clic en tu perfil → Cerrar Sesión → Vuelve a iniciar sesión.',
        severity: 'error',
      };
    }
    if (status === 403) {
      return USER_ERROR_CODES.PERMISSION_DENIED(context);
    }
    if (status === 404) {
      return {
        title: 'No encontrado',
        message: error?.response?.data?.message || `No se encontró ${context.entity || 'el recurso'}.`,
        action: 'Verifica que el elemento exista o contacta a soporte.',
        severity: 'error',
      };
    }
    if (status >= 500) {
      return {
        title: 'Error del servidor',
        message: 'Ocurrió un problema en nuestros servidores. Nuestro equipo fue notificado.',
        action: 'Intenta nuevamente en unos minutos. Si el problema persiste, contacta a soporte.',
        severity: 'error',
      };
    }
  }

  // Network errors
  if (error?.message?.includes('Network Error') || error?.message?.includes('ECONNREFUSED')) {
    return {
      title: 'Error de conexión',
      message: 'No se pudo conectar al servidor.',
      action: 'Verifica tu conexión a internet e intenta nuevamente.',
      severity: 'error',
    };
  }

  // Extract message from backend error
  // Priority: details (specific) > message > error (generic label) > client message
  const backendMessage =
    error?.response?.data?.details ||
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message;

  // Detect specific backend error patterns and provide appropriate titles
  if (backendMessage) {
    // Stock-related errors from warehouse service
    if (backendMessage.includes('Stock insuficiente') || backendMessage.includes('stock')) {
      return {
        title: 'Stock insuficiente',
        message: backendMessage.replace(/^⚠️\s*/, ''),
        severity: 'warning',
      };
    }

    // Packing/picking errors
    if (backendMessage.includes('pendientes de empacar') || backendMessage.includes('No se puede completar la sesión')) {
      return {
        title: 'Sesión incompleta',
        message: backendMessage.replace(/^⚠️\s*/, ''),
        severity: 'warning',
      };
    }

    // If backend provides a helpful message (longer than 10 chars and not just "Error"), use it
    if (backendMessage.length > 10 && !backendMessage.match(/^Error$/i)) {
      // Include suggestion from context if available
      const suggestion = context.details?.suggestion;
      // Clean up emoji prefixes for cleaner display but preserve the rest
      const cleanMessage = backendMessage.replace(/^⚠️\s*/, '');
      return {
        title: cleanMessage.includes('\n') ? cleanMessage.split('\n')[0].substring(0, 50) : 'Error',
        message: cleanMessage,
        action: suggestion,
        severity: 'error',
      };
    }
  }

  // Default fallback (last resort)
  return {
    title: 'Error inesperado',
    message: backendMessage || 'Ocurrió un error inesperado.',
    action: 'Intenta nuevamente. Si el problema persiste, contacta a soporte técnico.',
    severity: 'error',
  };
}

/**
 * Helper to show formatted error in toast
 */
export function showErrorToast(
  toast: any,
  error: any,
  context: ErrorContext = {}
) {
  const formatted = formatError(error, context);

  const description = formatted.action
    ? `${formatted.message}\n\n💡 ${formatted.action}`
    : formatted.message;

  toast({
    title: formatted.title,
    description,
    variant: 'destructive',
    duration: formatted.severity === 'info' ? 5000 : 8000, // More time for actionable errors
  });
}

/**
 * Helper to create error responses in backend
 */
export function createErrorResponse(
  code: keyof typeof USER_ERROR_CODES | keyof typeof TECHNICAL_ERROR_CODES,
  details?: Record<string, any>,
  httpStatus = 400
) {
  return {
    status: httpStatus,
    body: {
      code,
      details,
      timestamp: new Date().toISOString(),
    },
  };
}
