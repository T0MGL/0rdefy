-- ================================================================
-- NEONFLOW - SEED DATA
-- ================================================================
-- Test data for MVP development and demo
-- 2 Stores | 10 Products | 6 Customers | 12 Orders
-- ================================================================

-- ================================================================
-- SEED 1: Stores
-- ================================================================

INSERT INTO stores (id, name, country, timezone, currency, is_active, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'Park Lofts', 'PY', 'America/Asuncion', 'USD', TRUE, NOW(), NOW()),
    ('22222222-2222-2222-2222-222222222222', 'Tienda Ciudad 2', 'PY', 'America/Asuncion', 'USD', TRUE, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = NOW();

-- ================================================================
-- SEED 2: Store Configurations
-- ================================================================

INSERT INTO store_config (
    id,
    store_id,
    whatsapp_business_account_id,
    whatsapp_phone_number_id,
    whatsapp_api_token,
    shopify_store_url,
    shopify_access_token,
    agent_name,
    follow_up_template_1,
    follow_up_template_2,
    follow_up_template_3,
    follow_up_1_delay_hours,
    follow_up_2_delay_hours,
    follow_up_3_delay_hours,
    follow_up_enabled,
    created_at,
    updated_at
)
VALUES
    (
        'c1111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        'WA_ACCOUNT_PARK_LOFTS',
        'WA_PHONE_PARK_LOFTS',
        'demo_token_park_lofts',
        'park-lofts.myshopify.com',
        'shpat_demo_park_lofts',
        'Ana',
        'Hola {{customer_name}}! 👋 Soy Ana de Park Lofts. Vimos que realizaste un pedido (#{{order_number}}) por {{total_price}}. ¿Confirmas tu compra? Responde SÍ para continuar o NO si quieres cancelar.',
        'Hola {{customer_name}}! 😊 Seguimos esperando tu confirmación del pedido #{{order_number}}. Si tienes dudas, estamos aquí para ayudarte. ¿Confirmamos tu pedido?',
        '¡Última oportunidad! {{customer_name}}, tu pedido #{{order_number}} está a punto de cancelarse. ¿Lo confirmamos ahora? Responde SÍ o contáctanos al 0981-123456.',
        24,
        48,
        72,
        TRUE,
        NOW(),
        NOW()
    ),
    (
        'c2222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222',
        'WA_ACCOUNT_CIUDAD2',
        'WA_PHONE_CIUDAD2',
        'demo_token_ciudad2',
        'tienda-ciudad2.myshopify.com',
        'shpat_demo_ciudad2',
        'Carlos',
        'Hola {{customer_name}}! Soy Carlos de Tienda Ciudad 2. Tu pedido #{{order_number}} de {{total_price}} está listo. ¿Confirmamos? Responde SÍ o NO.',
        '{{customer_name}}, aún no confirmaste tu pedido #{{order_number}}. ¿Alguna pregunta? Estamos para ayudarte. ¿Procedemos?',
        'Último recordatorio {{customer_name}} 🔔 Tu pedido #{{order_number}} se cancelará pronto. Responde SÍ para confirmar o llámanos al 0982-654321.',
        24,
        48,
        72,
        TRUE,
        NOW(),
        NOW()
    )
ON CONFLICT (store_id) DO UPDATE SET
    agent_name = EXCLUDED.agent_name,
    updated_at = NOW();

-- ================================================================
-- SEED 3: Products
-- ================================================================

INSERT INTO products (id, store_id, name, description, price, cost, stock, image_url, sku, category, is_active, modified_by, created_at, updated_at)
VALUES
    -- Park Lofts Products
    ('p1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Reloj Inteligente Pro', 'Smartwatch con monitor de frecuencia cardíaca y GPS integrado', 299.00, 150.00, 45, 'https://via.placeholder.com/300', 'SKU-WATCH-001', 'Electrónicos', TRUE, 'shopify_sync', NOW(), NOW()),
    ('p1111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'Audífonos Bluetooth Elite', 'Cancelación de ruido activa y 30 horas de batería', 79.00, 35.00, 78, 'https://via.placeholder.com/300', 'SKU-AUD-002', 'Electrónicos', TRUE, 'shopify_sync', NOW(), NOW()),
    ('p1111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', 'Cámara HD 4K', 'Cámara deportiva resistente al agua con estabilización', 450.00, 220.00, 23, 'https://via.placeholder.com/300', 'SKU-CAM-003', 'Electrónicos', TRUE, 'dashboard', NOW(), NOW()),
    ('p1111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111111', 'Power Bank 20000mAh', 'Carga rápida para múltiples dispositivos simultáneos', 45.00, 22.00, 120, 'https://via.placeholder.com/300', 'SKU-PB-004', 'Accesorios', TRUE, 'shopify_sync', NOW(), NOW()),
    ('p1111111-1111-1111-1111-111111111115', '11111111-1111-1111-1111-111111111111', 'Lámpara LED Inteligente', 'Control por app, 16 millones de colores', 35.00, 18.00, 65, 'https://via.placeholder.com/300', 'SKU-LAMP-005', 'Hogar', TRUE, 'dashboard', NOW(), NOW()),

    -- Tienda Ciudad 2 Products
    ('p2222222-2222-2222-2222-222222222221', '22222222-2222-2222-2222-222222222222', 'Zapatillas Running Pro', 'Calzado deportivo con tecnología de amortiguación avanzada', 120.00, 60.00, 50, 'https://via.placeholder.com/300', 'SKU-ZAP-001', 'Deportes', TRUE, 'shopify_sync', NOW(), NOW()),
    ('p2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Mochila Urban Style', 'Compartimento para laptop 15" y puerto USB', 65.00, 30.00, 85, 'https://via.placeholder.com/300', 'SKU-MOCH-002', 'Accesorios', TRUE, 'shopify_sync', NOW(), NOW()),
    ('p2222222-2222-2222-2222-222222222223', '22222222-2222-2222-2222-222222222222', 'Botella Térmica Steel', 'Mantiene temperatura 24 horas, 1 litro', 28.00, 12.00, 150, 'https://via.placeholder.com/300', 'SKU-BOT-003', 'Deportes', TRUE, 'dashboard', NOW(), NOW()),
    ('p2222222-2222-2222-2222-222222222224', '22222222-2222-2222-2222-222222222222', 'Gorra Snapback Edition', 'Diseño urbano, ajuste universal', 22.00, 10.00, 200, 'https://via.placeholder.com/300', 'SKU-GOR-004', 'Moda', TRUE, 'shopify_sync', NOW(), NOW()),
    ('p2222222-2222-2222-2222-222222222225', '22222222-2222-2222-2222-222222222222', 'Cinturón Táctico', 'Material resistente, hebilla de liberación rápida', 38.00, 18.00, 95, 'https://via.placeholder.com/300', 'SKU-CINT-005', 'Accesorios', TRUE, 'dashboard', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    stock = EXCLUDED.stock,
    updated_at = NOW();

-- ================================================================
-- SEED 4: Customers
-- ================================================================

INSERT INTO customers (id, store_id, shopify_customer_id, email, phone, first_name, last_name, total_orders, total_spent, last_order_at, accepts_marketing, created_at, updated_at)
VALUES
    -- Park Lofts Customers
    ('cu111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'SHOP_CUST_001', 'maria.gonzalez@email.com', '+595981234567', 'María', 'González', 2, 378.00, NOW() - INTERVAL '2 days', TRUE, NOW() - INTERVAL '30 days', NOW()),
    ('cu111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'SHOP_CUST_002', 'carlos.rodriguez@email.com', '+595982345678', 'Carlos', 'Rodríguez', 1, 79.00, NOW() - INTERVAL '5 days', FALSE, NOW() - INTERVAL '15 days', NOW()),
    ('cu111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', 'SHOP_CUST_003', 'ana.martinez@email.com', '+595983456789', 'Ana', 'Martínez', 1, 450.00, NOW() - INTERVAL '1 day', TRUE, NOW() - INTERVAL '60 days', NOW()),

    -- Tienda Ciudad 2 Customers
    ('cu222222-2222-2222-2222-222222222221', '22222222-2222-2222-2222-222222222222', 'SHOP_CUST_101', 'pedro.benitez@email.com', '+595984567890', 'Pedro', 'Benítez', 2, 185.00, NOW() - INTERVAL '3 days', TRUE, NOW() - INTERVAL '45 days', NOW()),
    ('cu222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'SHOP_CUST_102', 'lucia.fernandez@email.com', '+595985678901', 'Lucía', 'Fernández', 1, 28.00, NOW() - INTERVAL '7 days', FALSE, NOW() - INTERVAL '20 days', NOW()),
    ('cu222222-2222-2222-2222-222222222223', '22222222-2222-2222-2222-222222222222', 'SHOP_CUST_103', 'jorge.silva@email.com', '+595986789012', 'Jorge', 'Silva', 1, 120.00, NOW() - INTERVAL '1 day', TRUE, NOW() - INTERVAL '10 days', NOW())
ON CONFLICT (id) DO UPDATE SET
    total_orders = EXCLUDED.total_orders,
    total_spent = EXCLUDED.total_spent,
    updated_at = NOW();

-- ================================================================
-- SEED 5: Orders
-- ================================================================

INSERT INTO orders (
    id, store_id, customer_id, shopify_order_id, shopify_order_number,
    customer_email, customer_phone, customer_first_name, customer_last_name,
    billing_address, shipping_address, line_items,
    total_price, subtotal_price, total_tax, total_shipping, currency,
    financial_status, fulfillment_status, sleeves_status,
    confirmed_at, confirmation_method, confirmed_by,
    follow_up_1_sent_at, follow_up_2_sent_at, follow_up_3_sent_at,
    n8n_processed_at, rejection_reason, created_at, updated_at
)
VALUES
    -- Park Lofts Orders
    (
        'o1111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        'cu111111-1111-1111-1111-111111111111',
        'SHOP_ORD_1001',
        1001,
        'maria.gonzalez@email.com',
        '+595981234567',
        'María',
        'González',
        '{"address1":"Av. España 123","city":"Asunción","country":"Paraguay","zip":"1234"}'::jsonb,
        '{"address1":"Av. España 123","city":"Asunción","country":"Paraguay","zip":"1234"}'::jsonb,
        '[{"product_id":"p1111111-1111-1111-1111-111111111111","quantity":1,"price":299.00,"name":"Reloj Inteligente Pro"}]'::jsonb,
        299.00, 299.00, 0.00, 0.00, 'USD',
        'paid', NULL, 'confirmed',
        NOW() - INTERVAL '2 days 1 hour', 'whatsapp', 'whatsapp_ai',
        NOW() - INTERVAL '2 days 2 hours', NULL, NULL,
        NOW() - INTERVAL '2 days', NULL,
        NOW() - INTERVAL '2 days', NOW()
    ),
    (
        'o1111111-1111-1111-1111-111111111112',
        '11111111-1111-1111-1111-111111111111',
        'cu111111-1111-1111-1111-111111111112',
        'SHOP_ORD_1002',
        1002,
        'carlos.rodriguez@email.com',
        '+595982345678',
        'Carlos',
        'Rodríguez',
        '{"address1":"Calle Palma 456","city":"Asunción","country":"Paraguay","zip":"1235"}'::jsonb,
        '{"address1":"Calle Palma 456","city":"Asunción","country":"Paraguay","zip":"1235"}'::jsonb,
        '[{"product_id":"p1111111-1111-1111-1111-111111111112","quantity":1,"price":79.00,"name":"Audífonos Bluetooth Elite"}]'::jsonb,
        79.00, 79.00, 0.00, 0.00, 'USD',
        'pending', NULL, 'pending',
        NULL, NULL, NULL,
        NOW() - INTERVAL '5 days 12 hours', NULL, NULL,
        NOW() - INTERVAL '5 days', NULL,
        NOW() - INTERVAL '5 days', NOW()
    ),
    (
        'o1111111-1111-1111-1111-111111111113',
        '11111111-1111-1111-1111-111111111111',
        'cu111111-1111-1111-1111-111111111113',
        'SHOP_ORD_1003',
        1003,
        'ana.martinez@email.com',
        '+595983456789',
        'Ana',
        'Martínez',
        '{"address1":"Mcal. López 789","city":"Asunción","country":"Paraguay","zip":"1236"}'::jsonb,
        '{"address1":"Mcal. López 789","city":"Asunción","country":"Paraguay","zip":"1236"}'::jsonb,
        '[{"product_id":"p1111111-1111-1111-1111-111111111113","quantity":1,"price":450.00,"name":"Cámara HD 4K"}]'::jsonb,
        450.00, 450.00, 0.00, 0.00, 'USD',
        'paid', 'fulfilled', 'delivered',
        NOW() - INTERVAL '1 day 2 hours', 'whatsapp', 'whatsapp_ai',
        NOW() - INTERVAL '1 day 3 hours', NULL, NULL,
        NOW() - INTERVAL '1 day', NULL,
        NOW() - INTERVAL '1 day', NOW()
    ),
    (
        'o1111111-1111-1111-1111-111111111114',
        '11111111-1111-1111-1111-111111111111',
        'cu111111-1111-1111-1111-111111111111',
        'SHOP_ORD_1004',
        1004,
        'maria.gonzalez@email.com',
        '+595981234567',
        'María',
        'González',
        '{"address1":"Av. España 123","city":"Asunción","country":"Paraguay","zip":"1234"}'::jsonb,
        '{"address1":"Av. España 123","city":"Asunción","country":"Paraguay","zip":"1234"}'::jsonb,
        '[{"product_id":"p1111111-1111-1111-1111-111111111112","quantity":1,"price":79.00,"name":"Audífonos Bluetooth Elite"}]'::jsonb,
        79.00, 79.00, 0.00, 0.00, 'USD',
        'paid', NULL, 'rejected',
        NULL, 'whatsapp', 'whatsapp_ai',
        NOW() - INTERVAL '3 days 12 hours', NOW() - INTERVAL '2 days', NULL,
        NOW() - INTERVAL '3 days', 'Cliente indicó que compró en otro lugar',
        NOW() - INTERVAL '3 days', NOW()
    ),
    (
        'o1111111-1111-1111-1111-111111111115',
        '11111111-1111-1111-1111-111111111111',
        NULL,
        'SHOP_ORD_1005',
        1005,
        'nuevo@email.com',
        '+595987890123',
        'Nuevo',
        'Cliente',
        '{"address1":"Av. Boggiani 321","city":"Asunción","country":"Paraguay","zip":"1237"}'::jsonb,
        '{"address1":"Av. Boggiani 321","city":"Asunción","country":"Paraguay","zip":"1237"}'::jsonb,
        '[{"product_id":"p1111111-1111-1111-1111-111111111114","quantity":2,"price":45.00,"name":"Power Bank 20000mAh"}]'::jsonb,
        90.00, 90.00, 0.00, 0.00, 'USD',
        'pending', NULL, 'pending',
        NULL, NULL, NULL,
        NOW() - INTERVAL '12 hours', NULL, NULL,
        NOW() - INTERVAL '12 hours', NULL,
        NOW() - INTERVAL '12 hours', NOW()
    ),
    (
        'o1111111-1111-1111-1111-111111111116',
        '11111111-1111-1111-1111-111111111111',
        NULL,
        'SHOP_ORD_1006',
        1006,
        'test@email.com',
        '+595988901234',
        'Test',
        'User',
        '{"address1":"Calle Test 999","city":"Asunción","country":"Paraguay","zip":"1238"}'::jsonb,
        '{"address1":"Calle Test 999","city":"Asunción","country":"Paraguay","zip":"1238"}'::jsonb,
        '[{"product_id":"p1111111-1111-1111-1111-111111111115","quantity":1,"price":35.00,"name":"Lámpara LED Inteligente"}]'::jsonb,
        35.00, 35.00, 0.00, 0.00, 'USD',
        'pending', NULL, 'confirmed',
        NOW() - INTERVAL '6 hours', 'manual', 'dashboard_user@neonflow.com',
        NULL, NULL, NULL,
        NOW() - INTERVAL '6 hours', NULL,
        NOW() - INTERVAL '6 hours', NOW()
    ),

    -- Tienda Ciudad 2 Orders
    (
        'o2222222-2222-2222-2222-222222222221',
        '22222222-2222-2222-2222-222222222222',
        'cu222222-2222-2222-2222-222222222221',
        'SHOP_ORD_2001',
        2001,
        'pedro.benitez@email.com',
        '+595984567890',
        'Pedro',
        'Benítez',
        '{"address1":"Av. República 111","city":"Ciudad del Este","country":"Paraguay","zip":"7000"}'::jsonb,
        '{"address1":"Av. República 111","city":"Ciudad del Este","country":"Paraguay","zip":"7000"}'::jsonb,
        '[{"product_id":"p2222222-2222-2222-2222-222222222221","quantity":1,"price":120.00,"name":"Zapatillas Running Pro"}]'::jsonb,
        120.00, 120.00, 0.00, 0.00, 'USD',
        'paid', NULL, 'confirmed',
        NOW() - INTERVAL '3 days 1 hour', 'whatsapp', 'whatsapp_ai',
        NOW() - INTERVAL '3 days 2 hours', NULL, NULL,
        NOW() - INTERVAL '3 days', NULL,
        NOW() - INTERVAL '3 days', NOW()
    ),
    (
        'o2222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222',
        'cu222222-2222-2222-2222-222222222221',
        'SHOP_ORD_2002',
        2002,
        'pedro.benitez@email.com',
        '+595984567890',
        'Pedro',
        'Benítez',
        '{"address1":"Av. República 111","city":"Ciudad del Este","country":"Paraguay","zip":"7000"}'::jsonb,
        '{"address1":"Av. República 111","city":"Ciudad del Este","country":"Paraguay","zip":"7000"}'::jsonb,
        '[{"product_id":"p2222222-2222-2222-2222-222222222222","quantity":1,"price":65.00,"name":"Mochila Urban Style"}]'::jsonb,
        65.00, 65.00, 0.00, 0.00, 'USD',
        'paid', 'fulfilled', 'shipped',
        NOW() - INTERVAL '1 day 5 hours', 'whatsapp', 'whatsapp_ai',
        NOW() - INTERVAL '1 day 6 hours', NULL, NULL,
        NOW() - INTERVAL '1 day', NULL,
        NOW() - INTERVAL '1 day', NOW()
    ),
    (
        'o2222222-2222-2222-2222-222222222223',
        '22222222-2222-2222-2222-222222222222',
        'cu222222-2222-2222-2222-222222222222',
        'SHOP_ORD_2003',
        2003,
        'lucia.fernandez@email.com',
        '+595985678901',
        'Lucía',
        'Fernández',
        '{"address1":"Calle Mariscal 222","city":"Ciudad del Este","country":"Paraguay","zip":"7001"}'::jsonb,
        '{"address1":"Calle Mariscal 222","city":"Ciudad del Este","country":"Paraguay","zip":"7001"}'::jsonb,
        '[{"product_id":"p2222222-2222-2222-2222-222222222223","quantity":1,"price":28.00,"name":"Botella Térmica Steel"}]'::jsonb,
        28.00, 28.00, 0.00, 0.00, 'USD',
        'pending', NULL, 'pending',
        NULL, NULL, NULL,
        NOW() - INTERVAL '7 days', NULL, NULL,
        NOW() - INTERVAL '7 days', NULL,
        NOW() - INTERVAL '7 days', NOW()
    ),
    (
        'o2222222-2222-2222-2222-222222222224',
        '22222222-2222-2222-2222-222222222222',
        'cu222222-2222-2222-2222-222222222223',
        'SHOP_ORD_2004',
        2004,
        'jorge.silva@email.com',
        '+595986789012',
        'Jorge',
        'Silva',
        '{"address1":"Av. Pioneros 333","city":"Ciudad del Este","country":"Paraguay","zip":"7002"}'::jsonb,
        '{"address1":"Av. Pioneros 333","city":"Ciudad del Este","country":"Paraguay","zip":"7002"}'::jsonb,
        '[{"product_id":"p2222222-2222-2222-2222-222222222221","quantity":1,"price":120.00,"name":"Zapatillas Running Pro"}]'::jsonb,
        120.00, 120.00, 0.00, 0.00, 'USD',
        'paid', NULL, 'confirmed',
        NOW() - INTERVAL '1 day 3 hours', 'manual', 'dashboard_user@neonflow.com',
        NULL, NULL, NULL,
        NOW() - INTERVAL '1 day', NULL,
        NOW() - INTERVAL '1 day', NOW()
    ),
    (
        'o2222222-2222-2222-2222-222222222225',
        '22222222-2222-2222-2222-222222222222',
        NULL,
        'SHOP_ORD_2005',
        2005,
        'nuevo2@email.com',
        '+595989012345',
        'Nuevo2',
        'Cliente2',
        '{"address1":"Calle Nueva 444","city":"Ciudad del Este","country":"Paraguay","zip":"7003"}'::jsonb,
        '{"address1":"Calle Nueva 444","city":"Ciudad del Este","country":"Paraguay","zip":"7003"}'::jsonb,
        '[{"product_id":"p2222222-2222-2222-2222-222222222224","quantity":2,"price":22.00,"name":"Gorra Snapback Edition"}]'::jsonb,
        44.00, 44.00, 0.00, 0.00, 'USD',
        'pending', NULL, 'pending',
        NULL, NULL, NULL,
        NOW() - INTERVAL '2 hours', NULL, NULL,
        NOW() - INTERVAL '2 hours', NULL,
        NOW() - INTERVAL '2 hours', NOW()
    ),
    (
        'o2222222-2222-2222-2222-222222222226',
        '22222222-2222-2222-2222-222222222222',
        NULL,
        'SHOP_ORD_2006',
        2006,
        'test2@email.com',
        '+595980123456',
        'Test2',
        'User2',
        '{"address1":"Calle Test2 555","city":"Ciudad del Este","country":"Paraguay","zip":"7004"}'::jsonb,
        '{"address1":"Calle Test2 555","city":"Ciudad del Este","country":"Paraguay","zip":"7004"}'::jsonb,
        '[{"product_id":"p2222222-2222-2222-2222-222222222225","quantity":1,"price":38.00,"name":"Cinturón Táctico"}]'::jsonb,
        38.00, 38.00, 0.00, 0.00, 'USD',
        'pending', NULL, 'rejected',
        NULL, 'whatsapp', 'whatsapp_ai',
        NOW() - INTERVAL '18 hours', NOW() - INTERVAL '6 hours', NULL,
        NOW() - INTERVAL '18 hours', 'Cliente no reconoce el pedido',
        NOW() - INTERVAL '18 hours', NOW()
    )
ON CONFLICT (id) DO UPDATE SET
    sleeves_status = EXCLUDED.sleeves_status,
    updated_at = NOW();

-- ================================================================
-- SEED 6: Suppliers
-- ================================================================

INSERT INTO suppliers (id, store_id, name, contact_person, email, phone, rating, products_count, modified_by, created_at, updated_at)
VALUES
    ('s1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'TechSupply Paraguay', 'Juan Pérez', 'juan@techsupply.py', '+595971111111', 4.80, 5, 'dashboard', NOW(), NOW()),
    ('s1111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'Electronics Import SA', 'María López', 'maria@electroimport.com', '+595972222222', 4.50, 3, 'dashboard', NOW(), NOW()),
    ('s2222222-2222-2222-2222-222222222221', '22222222-2222-2222-2222-222222222222', 'Distribuidora Ciudad', 'Carlos Gómez', 'carlos@distciudad.py', '+595973333333', 4.90, 5, 'dashboard', NOW(), NOW()),
    ('s2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'ImportPro SA', 'Ana Silva', 'ana@importpro.py', '+595974444444', 4.20, 2, 'dashboard', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = NOW();

-- ================================================================
-- SEED 7: Campaigns
-- ================================================================

INSERT INTO campaigns (id, store_id, platform, campaign_name, investment, clicks, conversions, roas, status, modified_by, created_at, updated_at)
VALUES
    ('ca111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Facebook', 'Relojes Verano 2025', 1200.00, 4500, 145, 3.20, 'active', 'dashboard', NOW(), NOW()),
    ('ca111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', 'Instagram', 'Audífonos Promo', 800.00, 3200, 89, 2.80, 'active', 'dashboard', NOW(), NOW()),
    ('ca111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111111', 'Google', 'Cámaras Deportivas', 1500.00, 2100, 67, 4.50, 'paused', 'dashboard', NOW(), NOW()),
    ('ca222222-2222-2222-2222-222222222221', '22222222-2222-2222-2222-222222222222', 'Facebook', 'Zapatillas Running', 900.00, 3800, 112, 3.50, 'active', 'dashboard', NOW(), NOW()),
    ('ca222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'TikTok', 'Accesorios Urbanos', 600.00, 5200, 78, 2.40, 'active', 'dashboard', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    investment = EXCLUDED.investment,
    updated_at = NOW();

-- ================================================================
-- SEEDING COMPLETE
-- ================================================================
-- NeonFlow Test Data v1.0
-- 2 Stores | 10 Products | 6 Customers | 12 Orders | 6 Suppliers | 5 Campaigns
-- Ready for Testing and Demo
-- ================================================================
