-- ============================================================================
-- ORDEFY — Priority 1 RLS Fix
-- Verified by: Ax (ORDEFY CEO Review)
-- Date: 2026-03-14
-- Veredicto: APROBADO CON MODIFICACIONES
--
-- CAMBIOS RESPECTO AL ORIGINAL:
-- 1. subscriptions — WITH CHECK modificado: miembros pueden UPDATE (ej. cancelar)
--    pero no cambiar store_id a una tienda que no les pertenece. Se mantiene
--    restriccion de role para operaciones criticas a nivel de Express middleware,
--    no a nivel RLS, porque el frontend NO hace INSERT/UPDATE directo en esta tabla.
--    Sin embargo, por seguridad defensiva, el WITH CHECK original es CORRECTO
--    para bloquear cualquier escritura directa con anon_key. APROBADO como esta.
--
-- 2. additional_values y recurring_additional_values — WITH CHECK original
--    no tiene restriccion de role (cualquier miembro puede escribir). Esto es
--    CORRECTO porque el backend filtra por permisos de modulo (Module.ANALYTICS)
--    via middleware. A nivel RLS, cualquier usuario de la tienda puede crear
--    valores adicionales. Sin cambio necesario.
--
-- 3. phone_verification_codes — UNICO CAMBIO REAL: la politica FOR ALL permite
--    SELECT desde el frontend. El frontend NO lee esta tabla directamente (solo
--    el backend via supabaseAdmin/service_role). Cambiado a solo INSERT para
--    bloquear lectura de OTPs via anon_key. El backend usa service_role y no
--    le afecta.
--
-- NOTA: Todo el backend Express usa supabaseAdmin (SERVICE_ROLE_KEY) que bypasea
-- RLS completamente. Ningun route del backend se rompe con estos cambios.
-- ============================================================================


-- ============================================================================
-- 1. SUBSCRIPTIONS
-- USING: correcto — usuario ve solo sus tiendas
-- WITH CHECK: correcto — solo owner/admin pueden escribir directamente
-- Nota: el frontend NO hace INSERT/UPDATE directo (va por /billing/*)
-- El backend usa service_role, no le aplica
-- ============================================================================
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_store_access" ON public.subscriptions FOR ALL
USING (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()))
WITH CHECK (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));


-- ============================================================================
-- 2. SUBSCRIPTION_HISTORY
-- FOR SELECT only: correcto — el frontend solo lee historial
-- El backend (service_role) inserta via Stripe webhooks — no se rompe
-- ============================================================================
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscription_history_store_access" ON public.subscription_history FOR SELECT
USING (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()));


-- ============================================================================
-- 3. USAGE_TRACKING
-- FOR SELECT only: correcto — el frontend solo lee usage para mostrar limites
-- El backend (service_role) actualiza contadores — no se rompe
-- ============================================================================
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_tracking_store_access" ON public.usage_tracking FOR SELECT
USING (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()));


-- ============================================================================
-- 4. ADDITIONAL_VALUES
-- FOR ALL sin restriccion de role en WITH CHECK: correcto
-- El backend middleware (requireModule ANALYTICS) controla acceso por plan
-- Cualquier usuario autenticado de la tienda puede CRUD — coherente con el codigo
-- ============================================================================
ALTER TABLE public.additional_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "additional_values_store_access" ON public.additional_values FOR ALL
USING (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()))
WITH CHECK (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()));


-- ============================================================================
-- 5. RECURRING_ADDITIONAL_VALUES
-- Idem additional_values — mismo patron, mismo razonamiento
-- ============================================================================
ALTER TABLE public.recurring_additional_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recurring_additional_values_store_access" ON public.recurring_additional_values FOR ALL
USING (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()))
WITH CHECK (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()));


-- ============================================================================
-- 6. PHONE_VERIFICATION_CODES — MODIFICADO
-- PROBLEMA ORIGINAL: FOR ALL permite SELECT de OTPs via anon_key desde frontend
-- El frontend nunca lee esta tabla directamente (confirmado en codigo)
-- El backend usa supabaseAdmin (service_role) — bypasea RLS, no se rompe
-- SOLUCION: Eliminar SELECT del scope de la politica publica
-- Solo se permite INSERT del propio usuario por si el frontend alguna vez
-- necesita insertar (actualmente no lo hace, pero es defensivamente seguro)
-- El backend con service_role sigue teniendo acceso total sin restriccion
-- ============================================================================
ALTER TABLE public.phone_verification_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "phone_verification_own_user" ON public.phone_verification_codes FOR INSERT
WITH CHECK (user_id = auth.uid());


-- ============================================================================
-- 7. EXTERNAL_WEBHOOK_CONFIGS
-- USING: correcto — usuario ve configs de su tienda
-- WITH CHECK: correcto — solo owner/admin configuran webhooks (dashboard lo valida
-- tambien via extractUserRole + permisos, pero RLS agrega capa defensiva)
-- ============================================================================
ALTER TABLE public.external_webhook_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "external_webhook_configs_store_access" ON public.external_webhook_configs FOR ALL
USING (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()))
WITH CHECK (store_id IN (SELECT store_id FROM public.user_stores WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));
