# 🚀 Quick Start - Activar Verificación por WhatsApp

## ⚡ Opción 1: Modo Demo (INMEDIATO - Sin configuración)

**YA ESTÁ ACTIVO** ✅

El sistema funciona inmediatamente en modo demo:
- Los códigos se muestran en la consola del backend
- No necesitas WhatsApp Business configurado
- Perfecto para testing

**No hagas nada, ya funciona!** 🎉

---

## 📱 Opción 2: Modo Producción (WhatsApp Real)

### Paso 1: Crear Meta Business Account (5 min)

1. Ve a https://business.facebook.com
2. Click "Crear cuenta"
3. Completa información de tu empresa

### Paso 2: Configurar WhatsApp API (10 min)

1. Ve a https://developers.facebook.com
2. "Mis Apps" → "Crear app"
3. Tipo: **Business**
4. Agrega producto: **WhatsApp**
5. Sigue wizard de configuración

### Paso 3: Obtener Credenciales (5 min)

En el Dashboard de WhatsApp:

1. **Phone Number ID:**
   - API Setup → Phone number ID
   - Copia el número largo (ej: `123456789012345`)

2. **Access Token (Temporal - 24h):**
   - API Setup → Temporary access token
   - Copia el token (empieza con `EAAA...`)

### Paso 4: Configurar .env (1 min)

Agrega al archivo `.env`:

```bash
WHATSAPP_PHONE_NUMBER_ID=pega_aqui_tu_phone_number_id
WHATSAPP_ACCESS_TOKEN=pega_aqui_tu_access_token
WHATSAPP_VERIFICATION_ENABLED=true
```

### Paso 5: Aplicar Migración (1 min)

```bash
# Conectar a Supabase
psql -h your-supabase-url -U postgres -d postgres

# Aplicar migración
\i db/migrations/034_phone_verification_system.sql
```

O desde Supabase Dashboard:
1. SQL Editor
2. Pega contenido de `034_phone_verification_system.sql`
3. Run

### Paso 6: Reiniciar Backend (10 seg)

```bash
npm run dev
```

### Paso 7: Testing (2 min)

1. Agrega tu número en Meta Dashboard:
   - WhatsApp → API Setup → "To" section
   - Add recipient → Tu número
   - Verifica con código

2. Registra un usuario con tu número

3. ¡Deberías recibir el WhatsApp! 🎊

---

## 🔄 Cambiar de Demo a Producción

Solo cambia esto en `.env`:

```bash
# Antes (Demo)
WHATSAPP_VERIFICATION_ENABLED=false

# Después (Producción)
WHATSAPP_VERIFICATION_ENABLED=true
```

Reinicia el backend y listo!

---

## 🆘 Problemas Comunes

### "No llega el WhatsApp"

**Solución:**
1. Verifica que `WHATSAPP_VERIFICATION_ENABLED=true`
2. Revisa logs del backend
3. Confirma que tu número esté en la lista permitida (Meta Dashboard)

### "Error de autenticación"

**Solución:**
1. Verifica que el `WHATSAPP_ACCESS_TOKEN` sea correcto
2. El token temporal expira en 24h → genera uno permanente

### "Invalid phone number"

**Solución:**
- Debe incluir código de país: `+595981234567`
- No usar espacios ni guiones

---

## 📞 Generar Access Token Permanente (Recomendado)

El token temporal expira en 24 horas. Para producción:

1. Meta Dashboard → Settings → System Users
2. Create System User → Nombre: "WhatsApp API"
3. Add Assets → Tu WhatsApp Business Account → Full control
4. Generate Token:
   - Selecciona tu App
   - Permisos: `whatsapp_business_messaging`, `whatsapp_business_management`
   - Expiration: **Never expire**
5. Copia y guarda en `.env`

---

## 💰 ¿Cuánto cuesta?

**Tier Gratuito:**
- 1,000 conversaciones/mes **GRATIS**

**Si superas 1,000/mes:**
- ~$0.012 - $0.015 USD por verificación (LATAM)

**Ejemplos:**
- 100 registros/mes = **$0**
- 1,000 registros/mes = **$0**
- 2,000 registros/mes = **~$15 USD**
- 10,000 registros/mes = **~$135 USD**

---

## 📚 Documentación Completa

- [WHATSAPP_VERIFICATION_SETUP.md](WHATSAPP_VERIFICATION_SETUP.md) - Setup detallado
- [PHONE_VERIFICATION_SUMMARY.md](PHONE_VERIFICATION_SUMMARY.md) - Resumen técnico

---

## ✅ Checklist

- [ ] Meta Business Account creada
- [ ] WhatsApp API configurado
- [ ] Phone Number ID obtenido
- [ ] Access Token obtenido
- [ ] Variables en `.env` configuradas
- [ ] Migración 034 aplicada
- [ ] Backend reiniciado
- [ ] Testing con tu número personal
- [ ] `WHATSAPP_VERIFICATION_ENABLED=true`
- [ ] ¡LISTO PARA PRODUCCIÓN! 🚀

---

**Tiempo total estimado:** 20-30 minutos

**Dificultad:** Media (requiere aprobación de Meta)

**Costo inicial:** $0 (tier gratuito)
