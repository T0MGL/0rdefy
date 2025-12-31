# WhatsApp Phone Verification System

Sistema de verificación de números de teléfono vía WhatsApp para prevenir multicuentas.

## 🎯 Características

- ✅ Verificación por código de 6 dígitos enviado por WhatsApp
- ✅ Prevención de multicuentas (un número = una cuenta)
- ✅ Recuperación de cuenta para números duplicados
- ✅ Rate limiting para prevenir spam
- ✅ Modo demo (funciona sin configurar WhatsApp)
- ✅ Códigos con expiración (10 minutos)
- ✅ Máximo 5 intentos de verificación por código

## 📋 Requisitos Previos

1. **Meta Business Account** (gratuito)
2. **WhatsApp Business API** (requiere verificación)
3. **Número de WhatsApp Business** (diferente al personal)

## 🚀 Configuración Paso a Paso

### 1. Crear Meta Business Account

1. Ve a [Meta Business Suite](https://business.facebook.com)
2. Crea una cuenta de negocio (si no tienes una)
3. Completa la información de tu empresa

### 2. Configurar WhatsApp Business API

1. Accede al [Meta for Developers](https://developers.facebook.com)
2. Crea una nueva App:
   - Tipo: **Business**
   - Categoría: **Comunicación**
3. En el dashboard, selecciona **WhatsApp** → **Get Started**
4. Sigue el wizard de configuración:
   - Acepta términos y condiciones
   - Vincula tu Meta Business Account
   - Configura un número de teléfono de prueba (temporal)

### 3. Obtener Credenciales

#### A. Phone Number ID
1. En el dashboard de WhatsApp API
2. Sección **"API Setup"**
3. Busca **"Phone number ID"**
4. Copia el ID (ejemplo: `123456789012345`)

#### B. Access Token (Temporal - Para Testing)
1. En la misma sección "API Setup"
2. Busca **"Temporary access token"**
3. Copia el token (válido 24 horas)

#### C. Access Token (Permanente - Para Producción)
1. En el dashboard, ve a **Settings** → **System Users**
2. Crea un nuevo System User:
   - Nombre: `WhatsApp API Service`
   - Rol: **Admin**
3. Agrega assets:
   - Selecciona tu WhatsApp Business Account
   - Permisos: **Full control**
4. Genera Access Token:
   - Selecciona tu App
   - Permisos necesarios:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
   - Expiration: **Never expire**
5. Copia y guarda el token de forma segura

### 4. Verificar Número de Teléfono (Producción)

Para enviar mensajes a usuarios reales (no solo números de prueba):

1. En WhatsApp API dashboard → **Phone Numbers**
2. Click **"Add phone number"**
3. Opciones:
   - **Usar número existente:** Si tienes WhatsApp Business en un móvil
   - **Nuevo número:** Meta te asignará uno (requiere proceso de verificación)
4. Completa verificación:
   - SMS o llamada de voz
   - Ingresa código de verificación
5. Configura perfil del negocio:
   - Nombre de negocio: **Ordefy**
   - Categoría: **Servicios de tecnología**
   - Descripción: Tu descripción
   - Logo: Logo de Ordefy
6. Espera aprobación (24-48 horas típicamente)

### 5. Configurar Variables de Entorno

Agrega al archivo `.env`:

```bash
# WhatsApp Verification (Meta Business API)
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_ACCESS_TOKEN=your_access_token_here
WHATSAPP_VERIFICATION_ENABLED=false  # Set to 'true' when ready
```

**Importante:**
- `WHATSAPP_VERIFICATION_ENABLED=false` → Modo demo (muestra código en consola)
- `WHATSAPP_VERIFICATION_ENABLED=true` → Modo producción (envía WhatsApp real)

### 6. Aplicar Migración de Base de Datos

```bash
# Conectarse a PostgreSQL (Supabase)
psql -h your-supabase-url -U postgres -d postgres

# Aplicar migración
\i db/migrations/034_phone_verification_system.sql
```

O desde Supabase Dashboard:
1. SQL Editor
2. Pega contenido de `db/migrations/034_phone_verification_system.sql`
3. Run

### 7. Testing en Modo Demo

1. Asegúrate de tener `WHATSAPP_VERIFICATION_ENABLED=false`
2. Reinicia el servidor backend
3. Registra un usuario nuevo
4. El código de verificación aparecerá en:
   - Consola del backend
   - Respuesta del API (solo en demo mode)
5. Usa ese código para verificar

### 8. Testing con Número Real

Antes de ir a producción, prueba con números de WhatsApp de prueba:

1. En WhatsApp API Dashboard → **API Setup**
2. Sección **"To"** (números receptores)
3. Agrega tu número personal de WhatsApp
4. Verifica el número (recibirás código por WhatsApp)
5. Configura `WHATSAPP_VERIFICATION_ENABLED=true`
6. Prueba registro con tu número

### 9. Ir a Producción

Una vez que todo funcione:

1. ✅ Número de negocio verificado
2. ✅ Access token permanente configurado
3. ✅ Testing completo
4. ✅ Variables de entorno en producción
5. Cambia `WHATSAPP_VERIFICATION_ENABLED=true`
6. Deploy

## 📊 Límites y Costos

### Tier Gratuito (Meta)
- **1,000 conversaciones/mes gratis**
- Conversación = ventana de 24 horas desde primer mensaje

### Precios después del tier gratuito
- **$0.005 - $0.09 USD** por conversación (varía por país)
- Argentina: ~$0.015 por conversación
- Paraguay: ~$0.012 por conversación

### Rate Limits
- **80 mensajes/segundo** por número
- **1,000 mensajes/minuto** por Business Account

### Cálculo de costos para Ordefy
Si envías 1 código de verificación por registro:
- 100 registros/mes = 100 conversaciones = **GRATIS**
- 1,000 registros/mes = 1,000 conversaciones = **GRATIS**
- 2,000 registros/mes = 1,000 gratis + 1,000 pagadas = **~$15 USD**
- 10,000 registros/mes = 1,000 gratis + 9,000 pagadas = **~$135 USD**

## 🔧 Troubleshooting

### Error: "Invalid phone number"
- Verifica formato: debe incluir código de país (ej: `+595981234567`)
- No usar espacios, guiones, paréntesis

### Error: "Recipient phone number not in allowed list"
- Estás en modo desarrollo
- Agrega el número en WhatsApp Dashboard → "To" section

### Error: "Access token expired"
- Token temporal expira en 24 horas
- Genera un token permanente (System User)

### No llegan mensajes
1. Verifica número de negocio esté aprobado
2. Revisa logs del backend (consola)
3. Verifica saldo de Meta Business Account
4. Confirma que recipient esté en lista permitida (dev mode)

### "Too many requests"
- Rate limit activado
- Espera 60 segundos antes de reintentar
- Verifica que no haya bucle de requests

## 🔒 Seguridad

### Protecciones Implementadas
- ✅ Rate limiting: 5 requests/15min por IP en `/request`
- ✅ Expiración de códigos: 10 minutos
- ✅ Máximo 5 intentos por código
- ✅ Códigos de un solo uso
- ✅ Limpieza automática de códigos expirados

### Recomendaciones Adicionales
- Nunca expongas `WHATSAPP_ACCESS_TOKEN` en frontend
- Usa HTTPS en producción
- Monitorea logs de uso sospechoso
- Implementa CAPTCHA si hay abuso

## 📱 Flujo de Usuario

1. Usuario se registra → ingresa email, contraseña, nombre
2. Sistema crea cuenta → `phone_verified: false`
3. Usuario ingresa número de teléfono
4. Sistema valida número único
5. Si duplicado → redirige a recuperación de cuenta
6. Si nuevo → envía código por WhatsApp
7. Usuario ingresa código de 6 dígitos
8. Sistema valida código
9. Si correcto → `phone_verified: true` → acceso completo
10. Si incorrecto → permite 4 reintentos más

## 📚 Recursos

- [Meta WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Get Started Guide](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [Best Practices](https://developers.facebook.com/docs/whatsapp/business-management-api/guides)

## 🎨 Personalización

### Cambiar mensaje de verificación
Edita [api/services/whatsapp.service.ts:49](api/services/whatsapp.service.ts#L49):

```typescript
private buildVerificationMessage(code: string): string {
  return `🔐 *Tu Empresa - Código de Verificación*\n\n` +
         `Tu código es: *${code}*\n\n` +
         `Expira en 10 minutos.`;
}
```

### Cambiar tiempo de expiración
Edita [api/routes/phone-verification.ts:58](api/routes/phone-verification.ts#L58):

```typescript
const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
```

### Cambiar rate limit
Edita [db/migrations/034_phone_verification_system.sql:52](db/migrations/034_phone_verification_system.sql#L52):

```sql
RETURN (last_request IS NULL OR last_request < NOW() - INTERVAL '120 seconds');
```

## ✅ Checklist de Deploy

- [ ] Meta Business Account creada
- [ ] WhatsApp Business API configurado
- [ ] Número de negocio verificado
- [ ] Access token permanente generado
- [ ] Variables de entorno configuradas
- [ ] Migración 034 aplicada en producción
- [ ] Testing con números reales completo
- [ ] `WHATSAPP_VERIFICATION_ENABLED=true` en producción
- [ ] Logs configurados para monitoreo
- [ ] Webhooks de WhatsApp configurados (opcional)

## 🆘 Soporte

Si tienes problemas:
1. Revisa logs del backend
2. Verifica configuración en Meta Dashboard
3. Consulta documentación oficial de Meta
4. Contacta a soporte de Meta (si es problema de API)
