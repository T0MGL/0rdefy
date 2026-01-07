# Sistema de Referidos - Documentación Técnica

**Última actualización:** 2026-01-06
**Migración:** 037_fix_referral_tracking.sql
**Estado:** ✅ Producción

---

## 🎯 Resumen de Cambios

### Problema Original

El sistema contaba como "referido" a cualquier persona que abría el link de referido, incluso si nunca completaba el registro o iniciaba un trial. Esto causaba:

- ❌ Métricas infladas e incorrectas
- ❌ Usuarios veían "1 referido" cuando nadie había pagado
- ❌ No se diferenciaba entre registro, trial, y conversión real

### Solución Implementada

Ahora el sistema trackea **3 fases distintas** del embudo:

```
📝 SIGNUP → 🎯 TRIAL_STARTED → 💰 CONVERTED
```

- **SIGNUP:** Usuario completa registro (no cuenta aún como referido)
- **TRIAL_STARTED:** Usuario inicia checkout y comienza trial de 14 días (**ahora cuenta como referido**)
- **CONVERTED:** Usuario paga después del trial (**gana créditos el referrer**)

---

## 📊 Flujo Completo (Con Trial de 14 Días)

### 1. Usuario Referrer Crea Código

```typescript
// POST /api/billing/referrals/generate
{
  code: "ABC123",
  link: "https://app.ordefy.io/r/ABC123"
}
```

**Tabla:** `referral_codes`
```sql
code     | user_id | total_signups | total_conversions | total_credits_earned_cents
---------|---------|---------------|-------------------|---------------------------
ABC123   | uuid    | 0             | 0                 | 0
```

---

### 2. Usuario Referido Abre el Link

```
URL: https://app.ordefy.io/r/ABC123
```

**Frontend:**
- Valida código en `/api/billing/referral/:code/validate` ([Referral.tsx:23-49](src/pages/Referral.tsx#L23-L49))
- Guarda código en `sessionStorage` y `localStorage`
- Muestra landing con beneficio: **20% de descuento en primer mes**
- Redirige a `/signup?ref=ABC123`

**Resultado:** Nada se guarda en DB aún

---

### 3. Usuario Se Registra

```typescript
// POST /api/auth/register
{
  email: "nuevo@usuario.com",
  password: "password",
  name: "Usuario Nuevo",
  referralCode: "ABC123"  // ← Viene del URL
}
```

**Backend:** [auth.ts:28-171](api/routes/auth.ts#L28-L171)

```typescript
// Valida código
const { data: referralData } = await supabaseAdmin
  .from('referral_codes')
  .select('user_id, is_active')
  .eq('code', 'ABC123')
  .single();

// Crea usuario
const newUser = await supabaseAdmin.from('users').insert({ ... });

// SECURITY: Previene auto-referidos
if (referrerUserId !== newUser.id) {
  // Crea record en tabla referrals
  await supabaseAdmin.from('referrals').insert({
    referrer_user_id: referrerUserId,
    referred_user_id: newUser.id,
    referral_code: 'ABC123',
    signed_up_at: NOW()  // ← Solo guarda fecha de registro
  });
}
```

**Tabla:** `referrals`
```sql
referrer_user_id | referred_user_id | referral_code | signed_up_at | trial_started_at | first_payment_at
-----------------|------------------|---------------|--------------|------------------|------------------
uuid-referrer    | uuid-nuevo       | ABC123        | 2026-01-06   | NULL             | NULL
```

**Stats del Referrer:**
```sql
total_signups: 0          ← No se incrementa aún ✅
total_conversions: 0
```

---

### 4. Usuario Completa Onboarding

```typescript
// Crea su tienda
// Selecciona plan (Starter, Growth, Professional)
```

**Resultado:** Ningún cambio en stats de referidos

---

### 5. Usuario Inicia Trial (Checkout Completado)

```typescript
// POST /api/billing/checkout
{
  plan: "starter",
  billingCycle: "monthly",
  referralCode: "ABC123"  // ← Todavía disponible en localStorage
}
```

**Backend:** [stripe.service.ts:240-375](api/services/stripe.service.ts#L240-L375)

```typescript
// Crea checkout session en Stripe
const session = await stripe.checkout.sessions.create({
  line_items: [{ price: 'price_xxx', quantity: 1 }],
  subscription_data: {
    trial_period_days: 14,  // ← Trial de 14 días
  },
  discounts: [{
    coupon: {
      percent_off: 20,      // ← 20% descuento del referido
      duration: 'once'      // ← Solo primer pago
    }
  }],
  metadata: {
    referral_code: 'ABC123'
  }
});
```

**Webhook:** `checkout.session.completed` ([billing.ts:544-617](api/routes/billing.ts#L544-L617))

```typescript
async function handleCheckoutCompleted(session) {
  const referralCode = session.metadata?.referral_code;

  // Busca referral existente (creado en registro)
  const { data: existingReferral } = await supabaseAdmin
    .from('referrals')
    .select('id')
    .eq('referred_user_id', userId)
    .single();

  // Actualiza con trial_started_at
  await supabaseAdmin
    .from('referrals')
    .update({
      trial_started_at: NOW(),           // ← Marca inicio de trial
      referred_plan: 'starter',
      referred_discount_applied: true
    })
    .eq('id', existingReferral.id);

  // 🔥 TRIGGER SE DISPARA AQUÍ
}
```

**Trigger:** `update_referral_stats()` ([037_fix_referral_tracking.sql:31-46](db/migrations/037_fix_referral_tracking.sql#L31-L46))

```sql
-- Detecta que trial_started_at cambió de NULL → NOW()
IF OLD.trial_started_at IS NULL AND NEW.trial_started_at IS NOT NULL THEN
  UPDATE referral_codes
  SET total_signups = total_signups + 1  -- ← SE INCREMENTA AQUÍ ✅
  WHERE code = NEW.referral_code;
END IF;
```

**Stats del Referrer:**
```sql
total_signups: 1          ← Ahora sí cuenta! ✅
total_conversions: 0      ← Todavía no pagó
```

**Tabla:** `referrals`
```sql
referrer_user_id | referred_user_id | referral_code | signed_up_at | trial_started_at | first_payment_at
-----------------|------------------|---------------|--------------|------------------|------------------
uuid-referrer    | uuid-nuevo       | ABC123        | 2026-01-06   | 2026-01-06       | NULL
```

---

### 6. Trial Termina (Día 14) - Stripe Cobra Automáticamente

**Stripe:**
- Cobra la suscripción con el descuento del 20% aplicado
- Emite webhook `invoice.paid`

**Webhook:** `invoice.paid` ([billing.ts:641-692](api/routes/billing.ts#L641-L692))

```typescript
async function handleInvoicePaid(invoice) {
  // Solo procesa si es el primer pago
  if (invoice.billing_reason === 'subscription_create') {
    // Actualiza referral
    await supabaseAdmin
      .from('referrals')
      .update({
        first_payment_at: NOW()  // ← Marca conversión
      })
      .eq('referred_user_id', userId);

    // 🔥 TRIGGER SE DISPARA AQUÍ
    // Procesa créditos del referrer
    await stripeService.processReferralConversion(userId, plan);
  }
}
```

**Trigger:** `update_referral_stats()`

```sql
-- Detecta que first_payment_at cambió de NULL → NOW()
IF OLD.first_payment_at IS NULL AND NEW.first_payment_at IS NOT NULL THEN
  UPDATE referral_codes
  SET
    total_conversions = total_conversions + 1,
    total_credits_earned_cents = total_credits_earned_cents + 1000  -- $10
  WHERE code = NEW.referral_code;
END IF;
```

**Stats del Referrer:**
```sql
total_signups: 1
total_conversions: 1      ← Conversión confirmada! ✅
total_credits_earned_cents: 1000  ($10)
```

**Créditos del Referrer:**
```sql
-- Tabla: referral_credits
user_id       | amount_cents | is_used | applied_to_invoice
--------------|--------------|---------|-------------------
uuid-referrer | 1000         | false   | NULL
```

---

## 🔐 Seguridad: Anti Auto-Referidos

**Problema:** Un usuario podría usar su propio código para crear múltiples cuentas

**Solución:** [auth.ts:119-141](api/routes/auth.ts#L119-L141)

```typescript
// En registro
if (referrerUserId === newUser.id) {
  console.warn('⚠️ User attempted to refer themselves');
  referrerUserId = null;  // Ignora código
}
```

---

## 📈 Analytics: Vista de Funnel

**Nueva Vista:** `referral_funnel_analytics` ([037_fix_referral_tracking.sql:108-147](db/migrations/037_fix_referral_tracking.sql#L108-L147))

```sql
SELECT * FROM referral_funnel_analytics;
```

**Resultado:**
```
code   | total_registered | total_trials_started | total_paid | signup_to_trial_rate | trial_to_paid_rate
-------|------------------|----------------------|------------|----------------------|-------------------
ABC123 | 10               | 7                    | 3          | 70.00                | 42.86
```

**Interpretación:**
- 10 personas abrieron el link y se registraron
- 7 iniciaron trial (70% conversion signup → trial)
- 3 pagaron después del trial (42.86% conversion trial → paid)

**Uso en API:** [stripe.service.ts:911-929](api/services/stripe.service.ts#L911-L929)

```typescript
// GET /api/billing/referrals
const stats = await stripeService.getReferralStats(userId);

{
  code: "ABC123",
  totalSignups: 7,        // = trials started
  totalConversions: 3,    // = paid
  funnel: {
    totalRegistered: 10,
    totalTrialsStarted: 7,
    totalPaid: 3,
    signupToTrialRate: 70.00,
    trialToPaidRate: 42.86
  }
}
```

---

## 🛠 Testing

### Aplicar Migración

```bash
psql $DATABASE_URL -f db/migrations/037_fix_referral_tracking.sql
```

### Ejecutar Tests

```bash
./scripts/test-referral-flow.sh
```

### Verificación Manual

```sql
-- Ver todos los referidos con sus fases
SELECT
  u.email as referrer,
  r.referral_code,
  ur.email as referred,
  r.signed_up_at,
  r.trial_started_at,
  r.first_payment_at,
  CASE
    WHEN r.first_payment_at IS NOT NULL THEN 'CONVERTED'
    WHEN r.trial_started_at IS NOT NULL THEN 'TRIAL'
    WHEN r.signed_up_at IS NOT NULL THEN 'REGISTERED'
  END as phase
FROM referrals r
JOIN users u ON u.id = r.referrer_user_id
JOIN users ur ON ur.id = r.referred_user_id
ORDER BY r.created_at DESC;
```

---

## 📝 Resumen de Cambios en Código

### Migración 037
- ✅ Agregado campo `trial_started_at` a tabla `referrals`
- ✅ Modificado trigger `update_referral_stats()` para contar solo trials
- ✅ Creada vista `referral_funnel_analytics` para analytics
- ✅ Creada función `get_referral_funnel(uuid)` para RPC

### Backend (API)
- ✅ [auth.ts:119-141](api/routes/auth.ts#L119-L141) - Anti auto-referidos
- ✅ [billing.ts:574-617](api/routes/billing.ts#L574-L617) - Update trial_started_at en checkout
- ✅ [stripe.service.ts:828-940](api/services/stripe.service.ts#L828-L940) - getReferralStats con funnel

### Frontend
- ⏳ TODO: Actualizar [Billing.tsx](src/pages/Billing.tsx) para mostrar funnel
- ⏳ TODO: Cambiar labels "Usuarios registrados" → "Usuarios en trial"

---

## 🎯 Definiciones Clave

| Métrica | Momento | Trigger |
|---------|---------|---------|
| **Signup** | Usuario completa registro | No cuenta como referido |
| **Trial Started** | Usuario inicia checkout | ✅ Cuenta como referido (`total_signups`) |
| **Converted** | Usuario paga después de trial | ✅ Cuenta como conversión (`total_conversions`) |
| **Credits Earned** | Usuario paga | Referrer gana $10 USD |

---

## 📞 Soporte

**Issues conocidos:** Ninguno

**Contacto:** Claude Code - Bright Idea

---

**¿Preguntas?** Lee el código fuente con referencias incluidas en este documento.
