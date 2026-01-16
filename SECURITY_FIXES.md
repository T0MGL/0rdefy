# Security Fixes - Enterprise Level Prompts

> **CONTEXTO:** Este es un sistema SaaS de e-commerce valorado en $100K USD que maneja datos financieros (pagos COD, Stripe), información de clientes (direcciones, teléfonos), e integraciones críticas (Shopify, WhatsApp). Las soluciones deben ser production-ready, seguir estándares OWASP Top 10, y estar al nivel de sistemas financieros enterprise.

---

## CRÍTICO 1: Rate Limiting en Endpoints Públicos de Orders

```
CONTEXTO ENTERPRISE:
Este es un sistema de $100K USD en producción. Los endpoints públicos de órdenes
exponen información de clientes y entregas. Sin rate limiting, un atacante puede
enumerar tokens de entrega y extraer datos de clientes. La solución debe estar
al nivel de sistemas bancarios - defense in depth.

PROBLEMA:
- Archivo: api/routes/orders.ts
- Endpoints SIN rate limiting:
  - GET /token/:token (línea ~46)
  - POST /token/:token/delivery-confirm (línea ~162)
  - POST /token/:token/delivery-fail (línea ~340)
  - POST /token/:token/rate-delivery (línea ~468)

VECTOR DE ATAQUE:
curl -X GET "https://api.ordefy.io/api/orders/token/$(openssl rand -hex 16)"
# Repetir 10,000 veces = enumeración de tokens válidos

SOLUCIÓN REQUERIDA:

1. Crear middleware de rate limiting específico para endpoints públicos:

const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 30,                    // 30 requests por ventana
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit por IP + token (previene bypass con múltiples tokens)
    return `${req.ip}:public-order`;
  },
  handler: (req, res) => {
    logger.security('ORDERS', 'Rate limit exceeded on public endpoint', {
      ip: req.ip,
      path: req.path
    });
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: 900 // 15 min en segundos
    });
  }
});

2. Aplicar a los 4 endpoints públicos

3. Agregar validación de formato de token ANTES de query a BD:
if (!/^[a-f0-9]{32,64}$/i.test(token)) {
  return res.status(400).json({ error: 'Invalid token format' });
}

NO cambiar la lógica de negocio, solo agregar seguridad.
```

---

## CRÍTICO 2: Timeout en WhatsApp API

```
CONTEXTO ENTERPRISE:
Sistema de $100K que usa WhatsApp para verificación de usuarios. Una request
colgada a Meta API puede bloquear el onboarding de nuevos clientes = pérdida
directa de ingresos. La solución debe manejar fallos de red como lo haría
un sistema de pagos - fail fast, retry inteligente.

PROBLEMA:
- Archivo: api/services/whatsapp.service.ts
- Línea ~85-92: fetch() sin timeout
- Si Meta API es lenta, la conexión permanece abierta indefinidamente
- Puede agotar connection pool del servidor

SOLUCIÓN REQUERIDA:

1. Agregar AbortController con timeout de 30 segundos:

async sendVerificationCode(phone: string, code: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal  // AGREGAR
    });

    clearTimeout(timeoutId);
    // ... resto del código
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      logger.error('WHATSAPP', 'Request timeout after 30s', { phone: phone.slice(-4) });
      throw new Error('WhatsApp service timeout');
    }
    throw error;
  }
}

2. Sanitizar logs - NO loguear teléfono completo:
// ANTES: console.log(`Sent to ${phone}`)
// DESPUÉS: logger.info('WHATSAPP', 'Code sent', { phoneLast4: phone.slice(-4) })

Aplicar el mismo patrón a TODOS los métodos que hacen fetch() en este archivo.
```

---

## CRÍTICO 3: Sanitizar Error Messages en Webhooks

```
CONTEXTO ENTERPRISE:
Los webhooks de Stripe y Shopify son endpoints públicos que reciben requests
de servicios externos. Exponer mensajes de error internos permite a atacantes
hacer reconnaissance de la arquitectura. Un sistema de $100K debe seguir
OWASP A01:2021 - nunca exponer detalles de implementación.

PROBLEMA:
- api/routes/billing.ts línea 48: expone err.message de Stripe
- api/routes/shopify.ts líneas 466, 471, 484: expone detalles de middleware

CÓDIGO VULNERABLE:
return res.status(400).json({ error: `Webhook Error: ${err.message}` });
// Puede retornar: "Webhook Error: No signatures found matching the expected signature"
// Revela: que usamos Stripe SDK, versión aproximada, estructura de validación

SOLUCIÓN REQUERIDA:

1. En billing.ts, reemplazar TODOS los error responses en webhook handler:

// ANTES
return res.status(400).json({ error: `Webhook Error: ${err.message}` });

// DESPUÉS
logger.error('BILLING', 'Webhook signature verification failed', {
  errorType: err.name,
  // NO incluir err.message en log público
});
return res.status(400).json({ error: 'Webhook verification failed' });

2. En shopify.ts, sanitizar errores de configuración:

// ANTES
return res.status(500).json({ error: 'Server configuration error - rawBody middleware not working' });

// DESPUÉS
logger.error('SHOPIFY', 'rawBody middleware not configured');
return res.status(500).json({ error: 'Internal server error' });

3. Crear constantes para mensajes de error genéricos:
const WEBHOOK_ERRORS = {
  VERIFICATION_FAILED: 'Webhook verification failed',
  INTERNAL_ERROR: 'Internal server error',
  INVALID_PAYLOAD: 'Invalid webhook payload'
};

Aplicar a TODOS los catch blocks en billing.ts y shopify.ts.
```

---

## ALTO 1: Remover HMAC Hashes de Logs

```
CONTEXTO ENTERPRISE:
Los logs de producción van a CloudWatch/Datadog donde múltiples personas tienen
acceso. Loguear hashes HMAC esperados permite a un insider falsificar webhooks.
Un sistema de $100K debe tratar secrets con el mismo cuidado que passwords.

PROBLEMA:
- Archivo: api/services/shopify-webhook.service.ts
- Líneas 594-596: loguea hashes HMAC esperados vs recibidos

CÓDIGO VULNERABLE:
console.error('❌ HMAC verification failed - neither base64 nor hex format matched');
console.error(`   Expected base64: ${hashBase64}`);
console.error(`   Expected hex: ${hashHex.substring(0, 64)}`);
console.error(`   Received HMAC: ${hmacHeader}`);

SOLUCIÓN REQUERIDA:

Reemplazar con:

logger.security('SHOPIFY', 'HMAC verification failed', {
  shopDomain: req.headers['x-shopify-shop-domain'],
  topic: req.headers['x-shopify-topic'],
  // NO incluir hashes - son secrets
  receivedHmacLength: hmacHeader?.length || 0,
  matchedFormat: 'none'
});

// Para debugging en desarrollo SOLAMENTE:
if (process.env.NODE_ENV === 'development') {
  console.debug('HMAC debug (DEV ONLY):', {
    expectedLength: hashBase64.length,
    receivedLength: hmacHeader?.length
  });
}

Buscar y corregir TODOS los lugares donde se loguean secrets/hashes/tokens.
```

---

## ALTO 2: Validar N8N Webhook Secret en Startup

```
CONTEXTO ENTERPRISE:
n8n recibe datos de órdenes y clientes. Si el secret está vacío, cualquiera
puede enviar webhooks falsos a n8n y disparar automatizaciones maliciosas.
Un sistema de $100K debe validar configuración crítica al iniciar.

PROBLEMA:
- Archivo: api/services/shopify-webhook.service.ts líneas 1519-1523
- Si N8N_WEBHOOK_SECRET y N8N_API_KEY están vacíos, la firma HMAC es inútil

SOLUCIÓN REQUERIDA:

1. En api/index.ts, agregar validación de startup:

// Después de cargar dotenv
const REQUIRED_SECRETS = [
  'JWT_SECRET',
  'SUPABASE_SERVICE_KEY',
];

const RECOMMENDED_SECRETS = [
  'N8N_WEBHOOK_SECRET',
  'STRIPE_WEBHOOK_SECRET',
  'SHOPIFY_API_SECRET',
];

// Validar requeridos
for (const secret of REQUIRED_SECRETS) {
  if (!process.env[secret]) {
    console.error(`❌ FATAL: Missing required secret: ${secret}`);
    process.exit(1);
  }
}

// Advertir sobre recomendados
for (const secret of RECOMMENDED_SECRETS) {
  if (!process.env[secret]) {
    console.warn(`⚠️ WARNING: Missing recommended secret: ${secret}`);
  }
}

2. En shopify-webhook.service.ts, validar antes de enviar:

const n8nSecret = process.env.N8N_WEBHOOK_SECRET;
if (!n8nSecret) {
  logger.warn('SHOPIFY', 'N8N webhook secret not configured, skipping n8n notification');
  return; // No enviar sin firma válida
}
```

---

## ALTO 3: User Enumeration en Register

```
CONTEXTO ENTERPRISE:
El endpoint de registro revela si un email existe. Un atacante puede enumerar
usuarios válidos para ataques de phishing dirigido o credential stuffing.
OWASP A07:2021 requiere que la autenticación no revele información de usuarios.

PROBLEMA:
- Archivo: api/routes/auth.ts línea ~105-119
- Retorna "Este email ya está registrado" si el email existe

SOLUCIÓN REQUERIDA:

1. Cambiar respuesta para NO revelar si email existe:

// ANTES
if (existingUser) {
  return res.status(400).json({
    success: false,
    error: 'Este email ya está registrado',
    code: 'EMAIL_EXISTS'
  });
}

// DESPUÉS
if (existingUser) {
  logger.security('AUTH', 'Registration attempt with existing email', {
    emailHash: crypto.createHash('sha256').update(email).digest('hex').substring(0, 8)
  });

  // Retornar el MISMO mensaje que si fuera exitoso
  // El usuario recibirá email de "ya tienes cuenta" en vez de "verifica tu cuenta"
  return res.json({
    success: true,
    message: 'Si el email es válido, recibirás instrucciones por correo.',
    requiresVerification: true
  });
}

2. Aplicar el mismo patrón a forgot-password si existe

NOTA: Esto requiere implementar email verification para ser completo.
Por ahora, al menos NO retornar error diferente.
```

---

## MEDIO 1: Validar Parámetros de Query en Orders

```
CONTEXTO ENTERPRISE:
Aunque Supabase previene SQL injection, aceptar valores arbitrarios es un
anti-patrón de seguridad. Un sistema de $100K debe validar TODOS los inputs
en la capa de aplicación - defense in depth.

PROBLEMA:
- Archivo: api/routes/orders.ts línea ~727
- El filtro de status acepta cualquier valor sin validar

SOLUCIÓN REQUERIDA:

1. Definir constantes de estados válidos:

const VALID_ORDER_STATUSES = [
  'pending', 'confirmed', 'in_preparation', 'ready_to_ship',
  'shipped', 'in_transit', 'delivered', 'cancelled', 'returned'
] as const;

2. Validar antes de usar en query:

if (status) {
  if (!VALID_ORDER_STATUSES.includes(status as any)) {
    return res.status(400).json({
      error: 'Invalid status value',
      validStatuses: VALID_ORDER_STATUSES
    });
  }
  query = query.eq('sleeves_status', status);
}

3. Validar fechas:

if (startDate) {
  const parsed = new Date(startDate as string);
  if (isNaN(parsed.getTime())) {
    return res.status(400).json({ error: 'Invalid startDate format' });
  }
  query = query.gte('created_at', parsed.toISOString());
}

Aplicar validación similar a TODOS los query params en el archivo.
```

---

## Checklist de Ejecución

### Críticos (Antes del lanzamiento)
- [ ] Rate limiting en endpoints públicos de orders
- [ ] Timeout en WhatsApp API
- [ ] Sanitizar error messages en webhooks

### Altos (Primera semana)
- [ ] Remover HMAC hashes de logs
- [ ] Validar N8N secret en startup
- [ ] User enumeration en register

### Medios (Segunda semana)
- [ ] Validar query params en orders
