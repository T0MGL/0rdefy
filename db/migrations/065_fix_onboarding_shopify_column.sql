-- Quick fix: Update get_onboarding_progress to use correct Shopify column
-- shopify_integrations has 'status' column, not 'is_active'

CREATE OR REPLACE FUNCTION get_onboarding_progress(p_store_id UUID, p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_has_carrier BOOLEAN;
    v_has_product BOOLEAN;
    v_has_order BOOLEAN;
    v_has_shopify BOOLEAN;
    v_has_customer BOOLEAN;
    v_checklist_dismissed BOOLEAN := FALSE;
    v_visited_modules JSONB := '[]'::jsonb;
    v_steps JSON;
    v_completed_count INT := 0;
    v_total_count INT := 4;
BEGIN
    SELECT COALESCE(checklist_dismissed, FALSE), COALESCE(visited_modules, '[]'::jsonb)
    INTO v_checklist_dismissed, v_visited_modules
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    SELECT EXISTS(SELECT 1 FROM carriers WHERE store_id = p_store_id AND is_active = TRUE LIMIT 1) INTO v_has_carrier;
    SELECT EXISTS(SELECT 1 FROM products WHERE store_id = p_store_id AND is_active = TRUE LIMIT 1) INTO v_has_product;
    SELECT EXISTS(SELECT 1 FROM customers WHERE store_id = p_store_id LIMIT 1) INTO v_has_customer;
    SELECT EXISTS(SELECT 1 FROM orders WHERE store_id = p_store_id AND deleted_at IS NULL LIMIT 1) INTO v_has_order;
    -- FIX: Use status = 'active' instead of is_active = TRUE
    SELECT EXISTS(SELECT 1 FROM shopify_integrations WHERE store_id = p_store_id AND status = 'active' LIMIT 1) INTO v_has_shopify;

    IF v_has_carrier THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_product THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_customer OR v_has_shopify THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_order THEN v_completed_count := v_completed_count + 1; END IF;

    v_steps := json_build_array(
        json_build_object('id', 'create-carrier', 'title', 'Agregar transportadora', 'description', 'Configura al menos una transportadora para enviar pedidos', 'completed', v_has_carrier, 'route', '/carriers', 'priority', 1, 'category', 'setup'),
        json_build_object('id', 'add-product', 'title', 'Agregar primer producto', 'description', 'Crea un producto o importa desde Shopify', 'completed', v_has_product, 'route', '/products', 'priority', 2, 'category', 'setup'),
        json_build_object('id', 'add-customer', 'title', CASE WHEN v_has_shopify THEN 'Clientes de Shopify' ELSE 'Agregar cliente' END, 'description', CASE WHEN v_has_shopify AND v_has_customer THEN 'Clientes importados automáticamente desde Shopify' WHEN v_has_shopify THEN 'Los clientes se crearán al recibir pedidos de Shopify' ELSE 'Registra tu primer cliente para crear pedidos' END, 'completed', v_has_customer OR v_has_shopify, 'route', '/customers', 'priority', 3, 'category', 'setup'),
        json_build_object('id', 'first-order', 'title', 'Crear primer pedido', 'description', 'Crea tu primer pedido para ver el flujo completo', 'completed', v_has_order, 'route', '/orders', 'priority', 4, 'category', 'operation')
    );

    RETURN json_build_object(
        'steps', v_steps,
        'completedCount', v_completed_count,
        'totalCount', v_total_count,
        'percentage', ROUND((v_completed_count::DECIMAL / v_total_count) * 100),
        'isComplete', v_completed_count = v_total_count,
        'hasShopify', v_has_shopify,
        'hasDismissed', v_checklist_dismissed,
        'visitedModules', v_visited_modules
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
