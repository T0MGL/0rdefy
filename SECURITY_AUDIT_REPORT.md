# 🔐 Ordefy Security Audit Report - Pre-Production
**Fecha:** 13 de Febrero, 2026
**Auditor:** Claude Sonnet 4.5
**Scope:** API Security, Input Validation, Credentials Management
**Severidad:** 1 CRITICAL, 3 HIGH, 2 MEDIUM

---

## 📊 Resumen Ejecutivo

Se encontraron **6 problemas de seguridad** que deben ser resueltos antes del lanzamiento a producción:

| Severidad | Cantidad | Status |
|-----------|----------|--------|
| 🔴 CRITICAL | 1 | **REQUIERE ACCIÓN INMEDIATA** |
| 🟠 HIGH | 3 | **RESOLVER ANTES DE PRODUCCIÓN** |
| 🟡 MEDIUM | 2 | **RECOMENDADO** |
| 🟢 LOW | 0 | - |

**Tiempo estimado de fix total:** 4-6 horas

---

## 🔴 CRITICAL: Credenciales Hardcodeadas en package.json

### Problema
Password de PostgreSQL hardcodeado en `package.json` líneas 17-18:

```json
"db:migrate": "PGPASSWORD=REDACTED_DB_PASSWORD psql..."
"db:seed": "PGPASSWORD=REDACTED_DB_PASSWORD psql..."
```

### Impacto
- 🔴 **SEVERIDAD MÁXIMA**
- Password de base de datos expuesto en repositorio Git
- Si el repositorio es público → **acceso total a la base de datos**
- Atacantes pueden:
  - Leer todos los datos (usuarios, pedidos, pagos)
  - Modificar/eliminar datos
  - Crear cuentas administrativas
  - Inyectar malware

### Solución

#### Opción 1: Variables de Entorno (RECOMENDADA)
```json
// package.json
"db:migrate": "psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f db/migrations/001_create_base_schema.sql",
"db:seed": "psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f db/seed.sql"
```

```bash
# .env (NO commitear)
PGHOST=REDACTED_DB_HOST
PGUSER=postgres
PGDATABASE=postgres
PGPASSWORD=REDACTED_DB_PASSWORD
```

#### Opción 2: .pgpass file (más segura)
```bash
# ~/.pgpass (chmod 600)
REDACTED_DB_HOST:5432:postgres:postgres:REDACTED_DB_PASSWORD
```

```json
// package.json (sin password)
"db:migrate": "psql -h REDACTED_DB_HOST -U postgres -d postgres -f db/migrations/001_create_base_schema.sql"
```

#### Opción 3: Script wrapper
```bash
# scripts/db-migrate.sh
#!/bin/bash
source .env
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f db/migrations/001_create_base_schema.sql
```

```json
// package.json
"db:migrate": "./scripts/db-migrate.sh"
```

### Acciones Inmediatas
1. ✅ Cambiar password de base de datos INMEDIATAMENTE
2. ✅ Implementar una de las soluciones arriba
3. ✅ Verificar si el repositorio es público → si sí, rotar TODAS las credenciales
4. ✅ Revisar logs de acceso a la base de datos para detectar accesos no autorizados
5. ✅ Agregar pre-commit hook para detectar secrets

**Prioridad:** 🔴 URGENTE
**Tiempo estimado:** 30 minutos
**Bloqueante para producción:** SÍ

---

## 🟠 HIGH #1: Falta Validación UUID en 14+ Endpoints

### Problema
Los siguientes endpoints NO validan que `:id` sea un UUID válido:

```typescript
// api/routes/suppliers.ts
suppliersRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    const { id } = req.params;  // ❌ NO validación
    // ...
});

// api/routes/merchandise.ts
merchandiseRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    const { id } = req.params;  // ❌ NO validación
    // ...
});
```

**Endpoints afectados:**
- `GET /api/suppliers/:id`
- `PUT /api/suppliers/:id`
- `DELETE /api/suppliers/:id`
- `GET /api/suppliers/:id/products`
- `GET /api/merchandise/:id`
- `PATCH /api/merchandise/:id`
- `POST /api/merchandise/:id/receive`
- `DELETE /api/merchandise/:id`
- `GET /api/incidents/:id`
- `POST /api/incidents/:id/schedule-retry`
- `POST /api/incidents/:id/resolve`
- `DELETE /api/incidents/:id`
- `PUT /api/incidents/:id/retry/:retry_id`
- `GET /api/inventory/movements/product/:id`
- **+2 más**

### Impacto
- 🟠 **ALTA SEVERIDAD**
- Potencial injection attacks
- Errores inesperados de base de datos
- Exposición de stack traces
- Posible DoS con valores muy largos
- Logs contaminados con garbage data

### Ejemplos de Exploit
```bash
# Path traversal attempt
GET /api/suppliers/../../../etc/passwd

# SQL injection attempt
GET /api/suppliers/' OR '1'='1

# DoS con string largo
GET /api/suppliers/AAAAAAAAAA... (10MB de A's)

# Exposición de errores de DB
GET /api/suppliers/not-a-uuid
→ Response: { error: "invalid input syntax for type uuid: \"not-a-uuid\"" }
```

### Solución
Agregar middleware `validateUUIDParam` a todos los endpoints:

```typescript
import { validateUUIDParam } from '../middleware/validate';

// ✅ CORRECTO
suppliersRouter.get('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    // ...
});
```

### Fix Masivo (Script)
```bash
# Crear archivo fix-uuid-validation.sh
cat > fix-uuid-validation.sh << 'EOF'
#!/bin/bash
files=(
    "api/routes/suppliers.ts"
    "api/routes/merchandise.ts"
    "api/routes/incidents.ts"
    "api/routes/inventory.ts"
)

for file in "${files[@]}"; do
    # Agregar import si no existe
    if ! grep -q "validateUUIDParam" "$file"; then
        sed -i "1i import { validateUUIDParam } from '../middleware/validate';" "$file"
    fi

    # Agregar validación a endpoints
    sed -i "s/Router\.\(get\|put\|patch\|delete\|post\)('\/:id'/&, validateUUIDParam('id')/g" "$file"
done
EOF

chmod +x fix-uuid-validation.sh
./fix-uuid-validation.sh
```

**Prioridad:** 🟠 ALTA
**Tiempo estimado:** 2 horas
**Bloqueante para producción:** SÍ

---

## 🟠 HIGH #2: Exposición de error.message en Múltiples Endpoints

### Problema
Múltiples endpoints exponen `error.message` directamente al cliente:

```typescript
// api/routes/inventory.ts:141
return res.status(500).json({ error: error.message });

// api/routes/incidents.ts:321
res.status(500).json({ error: 'Error interno del servidor' });
```

### Impacto
- 🟠 **ALTA SEVERIDAD**
- Exposición de detalles internos del sistema
- Nombres de tablas y columnas visibles
- Stack traces potencialmente expuestos
- Information disclosure que facilita otros ataques
- Violación de OWASP Top 10 (Security Misconfiguration)

### Ejemplos de Información Expuesta
```json
// ❌ MAL - Expone estructura de BD
{
  "error": "null value in column \"customer_id\" violates not-null constraint"
}

// ❌ MAL - Expone paths internos
{
  "error": "ENOENT: no such file or directory, open '/var/app/uploads/invoice.pdf'"
}

// ✅ BIEN - Mensaje genérico
{
  "error": "Error al procesar solicitud",
  "code": "INTERNAL_ERROR"
}
```

### Solución

#### Crear Error Handler Centralizado
```typescript
// api/utils/errorHandler.ts
export function sanitizeError(error: any): { error: string; code: string } {
    // Log completo para debugging (solo servidor)
    logger.error('API', 'Error:', {
        message: error.message,
        stack: error.stack,
        code: error.code
    });

    // Mensaje sanitizado para cliente
    const clientErrors: Record<string, string> = {
        '23505': 'DUPLICATE_ENTRY',
        '23503': 'REFERENCE_ERROR',
        '23502': 'REQUIRED_FIELD',
        'PGRST116': 'NOT_FOUND'
    };

    const code = clientErrors[error.code] || 'INTERNAL_ERROR';

    return {
        error: getClientMessage(code),
        code
    };
}

function getClientMessage(code: string): string {
    const messages: Record<string, string> = {
        'DUPLICATE_ENTRY': 'El registro ya existe',
        'REFERENCE_ERROR': 'Referencia inválida',
        'REQUIRED_FIELD': 'Campos requeridos faltantes',
        'NOT_FOUND': 'Recurso no encontrado',
        'INTERNAL_ERROR': 'Error interno del servidor'
    };

    return messages[code] || messages.INTERNAL_ERROR;
}
```

#### Usar en Endpoints
```typescript
import { sanitizeError } from '../utils/errorHandler';

// ✅ CORRECTO
try {
    // ... operación
} catch (error: any) {
    const sanitized = sanitizeError(error);
    res.status(500).json(sanitized);
}
```

**Archivos afectados:**
- `api/routes/inventory.ts` (3 ocurrencias)
- `api/routes/incidents.ts` (15+ ocurrencias)
- `api/routes/cod-metrics.ts` (9 ocurrencias)
- Otros endpoints

**Prioridad:** 🟠 ALTA
**Tiempo estimado:** 2 horas
**Bloqueante para producción:** SÍ

---

## 🟠 HIGH #3: Archivos de Test con Passwords en console.log

### Problema
Archivos de test logean passwords en consola:

```typescript
// api/test-login.ts:13
console.log('🔑 [TEST] Test password:', testPassword);

// api/test-login.ts:42
console.log('🔑 [TEST] Password hash from DB:', user.password_hash);

// api/create-test-user.ts:17
console.log('🔑 Password:', password);
```

### Impacto
- 🟠 **ALTA SEVERIDAD (si se ejecuta en producción)**
- Passwords logueados en archivos de log
- Logs pueden ser accedidos por atacantes
- Hashes expuestos facilitan ataques de rainbow table
- Violación de compliance (GDPR, PCI-DSS)

### Solución

#### Opción 1: Eliminar archivos de test de producción
```json
// package.json
"scripts": {
    "build": "vite build --mode production",
    "build:clean": "rm -rf api/test-*.ts api/create-test-user.ts api/reset-password.ts"
}
```

#### Opción 2: Conditional logging
```typescript
// api/test-login.ts
if (process.env.NODE_ENV !== 'production') {
    console.log('🔑 [TEST] Test password:', testPassword);
}
```

#### Opción 3: Mover a carpeta /tests
```bash
mkdir -p api/tests
mv api/test-*.ts api/create-test-user.ts api/reset-password.ts api/tests/
```

```json
// tsconfig.json
{
    "exclude": ["api/tests/**/*"]
}
```

### Archivos afectados
- `api/test-login.ts`
- `api/create-test-user.ts`
- `api/reset-password.ts`

**Prioridad:** 🟠 ALTA
**Tiempo estimado:** 30 minutos
**Bloqueante para producción:** SÍ

---

## 🟡 MEDIUM #1: Shopify API Key Hardcodeada (Pública)

### Problema
API Key de Shopify hardcodeada en código:

```typescript
// src/components/ShopifyAppBridgeProvider.tsx:10
const API_KEY = 'SHOPIFY_API_KEY_REDACTED';
```

### Impacto
- 🟡 **MEDIA SEVERIDAD**
- Esta es una API Key **pública** (OAuth Public App), NO es un secret
- Sin embargo, hardcodear credenciales es mala práctica
- Dificulta el manejo de múltiples ambientes (dev, staging, prod)
- Si se cambia la key, requiere rebuild del frontend

### Solución
```typescript
// vite.config.ts
export default defineConfig({
    define: {
        'import.meta.env.VITE_SHOPIFY_API_KEY': JSON.stringify(process.env.VITE_SHOPIFY_API_KEY)
    }
});

// src/components/ShopifyAppBridgeProvider.tsx
const API_KEY = import.meta.env.VITE_SHOPIFY_API_KEY || 'SHOPIFY_API_KEY_REDACTED';
```

```bash
# .env
VITE_SHOPIFY_API_KEY=your-shopify-api-key

# .env.production
VITE_SHOPIFY_API_KEY=<production_key>
```

**Prioridad:** 🟡 MEDIA
**Tiempo estimado:** 15 minutos
**Bloqueante para producción:** NO (pero recomendado)

---

## 🟡 MEDIUM #2: Console.log Excesivos en Producción

### Problema
Según `MEMORY.md`, hay **456 console.log statements** en el código de producción.

### Impacto
- 🟡 **MEDIA SEVERIDAD**
- Performance degradation (cada log tiene costo)
- Logs contaminados dificultan debugging
- Potencial exposición de información sensible
- Storage waste en sistemas de logging

### Solución

#### Opción 1: Logger condicional (ya existe en `api/utils/logger.ts`)
```typescript
// Reemplazar console.log con logger
import { logger } from '@/utils/logger';

// ❌ console.log('User logged in:', user);
// ✅ logger.log('AUTH', 'User logged in:', { userId: user.id });
```

#### Opción 2: Build-time stripping
```javascript
// vite.config.ts
export default defineConfig({
    esbuild: {
        drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : []
    }
});
```

#### Opción 3: ESLint rule
```json
// .eslintrc.json
{
    "rules": {
        "no-console": ["error", { "allow": ["warn", "error"] }]
    }
}
```

**Prioridad:** 🟡 MEDIA
**Tiempo estimado:** 1 hora (automated refactor)
**Bloqueante para producción:** NO

---

## 📋 Plan de Acción Priorizado

### FASE 1: CRITICAL (Ejecutar HOY)
**Tiempo total:** 30 minutos

1. ✅ **Cambiar password de PostgreSQL** (5 min)
2. ✅ **Mover credenciales a .env** (10 min)
3. ✅ **Actualizar package.json scripts** (5 min)
4. ✅ **Verificar si repo es público** (5 min)
5. ✅ **Si público → rotar TODAS las credenciales** (5 min)

### FASE 2: HIGH (Antes de Producción)
**Tiempo total:** 4.5 horas

1. ✅ **Agregar validateUUIDParam a 14 endpoints** (2 horas)
2. ✅ **Implementar error sanitization** (2 horas)
3. ✅ **Remover/proteger archivos de test** (30 minutos)

### FASE 3: MEDIUM (Recomendado)
**Tiempo total:** 1.25 horas

1. ⚠️ **Mover Shopify API Key a env** (15 minutos)
2. ⚠️ **Implementar logger condicional** (1 hora)

---

## 🛡️ Recomendaciones de Seguridad Adicionales

### 1. Pre-commit Hooks
```bash
# .git/hooks/pre-commit
#!/bin/bash
# Detectar secrets antes de commit
if git diff --cached | grep -E "(password|secret|key).*=.*['\"]"; then
    echo "❌ Posible secret detectado. Commit bloqueado."
    exit 1
fi
```

### 2. Dependency Scanning
```bash
npm audit
npm audit fix
```

### 3. Rate Limiting Review
Verificar que todos los endpoints públicos tengan rate limiting:
- `/api/auth/login` ✅ (5 req/15min)
- `/api/phone-verification` ✅ (5 req/15min)
- `/api/orders/:id/rate-delivery` ❓ (verificar)

### 4. CORS Configuration
Revisar orígenes permitidos en `api/index.ts`:
```typescript
// ⚠️ Verificar que no haya '*' en producción
cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://ordefy.io']
})
```

### 5. Security Headers
```typescript
// api/index.ts
import helmet from 'helmet';
app.use(helmet({
    contentSecurityPolicy: true,
    hsts: true,
    noSniff: true
}));
```

---

## 📊 Scorecard de Seguridad

| Categoría | Score | Status |
|-----------|-------|--------|
| **Credential Management** | 2/10 | 🔴 CRÍTICO |
| **Input Validation** | 6/10 | 🟠 NECESITA MEJORA |
| **Error Handling** | 6/10 | 🟠 NECESITA MEJORA |
| **Logging Security** | 7/10 | 🟡 ACEPTABLE |
| **Dependency Security** | 9/10 | 🟢 BUENO |
| **Authentication** | 9/10 | 🟢 BUENO |
| **Authorization** | 9/10 | 🟢 BUENO |
| **Rate Limiting** | 8/10 | 🟢 BUENO |

**Score General:** **6.5/10** (NECESITA MEJORAS ANTES DE PRODUCCIÓN)

---

## ✅ Checklist Pre-Producción

### Seguridad
- [ ] Password de PostgreSQL movido a .env
- [ ] Todos los endpoints con validateUUIDParam
- [ ] Error sanitization implementado
- [ ] Archivos de test removidos de build
- [ ] Pre-commit hooks configurados
- [ ] npm audit ejecutado y resuelto
- [ ] CORS configurado correctamente
- [ ] Helmet headers implementados
- [ ] Rate limiting en endpoints públicos

### Configuración
- [ ] Variables de entorno documentadas en .env.example
- [ ] .gitignore actualizado
- [ ] Secrets rotados si repo fue público
- [ ] Logs de acceso revisados para detectar accesos no autorizados

### Testing
- [ ] Security tests ejecutados
- [ ] Penetration testing básico
- [ ] Error scenarios testeados
- [ ] Rate limiting verificado

---

## 🔗 Referencias

- [OWASP Top 10 2021](https://owasp.org/www-project-top-ten/)
- [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html)
- [CWE-209: Information Exposure Through Error Message](https://cwe.mitre.org/data/definitions/209.html)
- [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)

---

**FIN DEL REPORTE**

**Próximos pasos:** Ejecutar FASE 1 (CRITICAL) inmediatamente antes de cualquier deploy a producción.
