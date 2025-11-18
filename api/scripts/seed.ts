// ================================================================
// SEED SCRIPT - Populate database with test data
// ================================================================
import { supabase } from '../db/connection';

const STORE_1_ID = '11111111-1111-1111-1111-111111111111';
const STORE_2_ID = '22222222-2222-2222-2222-222222222222';

async function seed() {
    console.log('🌱 Starting database seed...\n');

    try {
        // ================================================================
        // 1. SEED STORES
        // ================================================================
        console.log('📦 Seeding stores...');
        const { data: stores, error: storesError } = await supabase
            .from('stores')
            .upsert([
                {
                    id: STORE_1_ID,
                    name: 'Park Lofts',
                    country: 'PY',
                    timezone: 'America/Asuncion',
                    currency: 'USD',
                    is_active: true
                },
                {
                    id: STORE_2_ID,
                    name: 'Tienda Ciudad 2',
                    country: 'PY',
                    timezone: 'America/Asuncion',
                    currency: 'USD',
                    is_active: true
                }
            ], { onConflict: 'id' })
            .select();

        if (storesError) throw storesError;
        console.log(`✅ ${stores?.length || 0} stores seeded\n`);

        // ================================================================
        // 2. SEED PRODUCTS
        // ================================================================
        console.log('📦 Seeding products...');

        // First, check if products already exist
        const { data: existingProducts } = await supabase
            .from('products')
            .select('id')
            .eq('store_id', STORE_1_ID)
            .limit(1);

        let products;
        if (existingProducts && existingProducts.length > 0) {
            console.log('⚠️  Products already exist, skipping...');
            products = existingProducts;
        } else {
            const { data: insertedProducts, error: productsError } = await supabase
                .from('products')
                .insert([
                {
                    store_id: STORE_1_ID,
                    name: 'Auriculares Bluetooth Premium',
                    description: 'Auriculares inalámbricos con cancelación de ruido',
                    price: 250000,
                    cost: 150000,
                    stock: 50,
                    category: 'Electrónica',
                    sku: 'AUR-BT-001',
                    image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Smart Watch Serie 5',
                    description: 'Reloj inteligente con monitor de salud',
                    price: 450000,
                    cost: 280000,
                    stock: 30,
                    category: 'Electrónica',
                    sku: 'SW-S5-001',
                    image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Teclado Mecánico RGB',
                    description: 'Teclado gaming con switches mecánicos',
                    price: 180000,
                    cost: 100000,
                    stock: 25,
                    category: 'Electrónica',
                    sku: 'TEC-RGB-001',
                    image_url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Mouse Gamer Inalámbrico',
                    description: 'Mouse con 6 botones programables',
                    price: 120000,
                    cost: 70000,
                    stock: 40,
                    category: 'Electrónica',
                    sku: 'MOU-GAM-001',
                    image_url: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Webcam HD 1080p',
                    description: 'Cámara web para streaming y videollamadas',
                    price: 200000,
                    cost: 120000,
                    stock: 20,
                    category: 'Electrónica',
                    sku: 'WEB-HD-001',
                    image_url: 'https://images.unsplash.com/photo-1564466809058-bf4114d55352?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Mochila para Laptop 17"',
                    description: 'Mochila resistente al agua con múltiples compartimentos',
                    price: 95000,
                    cost: 50000,
                    stock: 35,
                    category: 'Accesorios',
                    sku: 'MOC-LAP-001',
                    image_url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Cable USB-C 2m',
                    description: 'Cable de carga rápida USB-C a USB-C',
                    price: 35000,
                    cost: 15000,
                    stock: 100,
                    category: 'Accesorios',
                    sku: 'CAB-USC-001',
                    image_url: 'https://images.unsplash.com/photo-1625948515291-69613efd103f?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Power Bank 20000mAh',
                    description: 'Batería portátil de alta capacidad',
                    price: 150000,
                    cost: 90000,
                    stock: 45,
                    category: 'Accesorios',
                    sku: 'PWR-20K-001',
                    image_url: 'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Soporte para Laptop',
                    description: 'Soporte ergonómico ajustable de aluminio',
                    price: 85000,
                    cost: 45000,
                    stock: 28,
                    category: 'Accesorios',
                    sku: 'SOP-LAP-001',
                    image_url: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400&h=300&fit=crop',
                    is_active: true
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Hub USB 7 Puertos',
                    description: 'Hub USB 3.0 con 7 puertos y alimentación',
                    price: 65000,
                    cost: 35000,
                    stock: 32,
                    category: 'Accesorios',
                    sku: 'HUB-USB-001',
                    image_url: 'https://images.unsplash.com/photo-1625948515291-69613efd103f?w=400&h=300&fit=crop',
                    is_active: true
                }
            ])
            .select();

            if (productsError) throw productsError;
            products = insertedProducts;
        }
        console.log(`✅ ${products?.length || 0} products seeded\n`);

        // ================================================================
        // 3. SEED CUSTOMERS
        // ================================================================
        console.log('📦 Seeding customers...');
        const { data: customers, error: customersError } = await supabase
            .from('customers')
            .insert([
                {
                    store_id: STORE_1_ID,
                    first_name: 'Juan',
                    last_name: 'Pérez',
                    email: 'juan.perez@example.com',
                    phone: '+595981234567',
                    total_orders: 0,
                    total_spent: 0,
                    accepts_marketing: true
                },
                {
                    store_id: STORE_1_ID,
                    first_name: 'María',
                    last_name: 'González',
                    email: 'maria.gonzalez@example.com',
                    phone: '+595981234568',
                    total_orders: 0,
                    total_spent: 0,
                    accepts_marketing: true
                },
                {
                    store_id: STORE_1_ID,
                    first_name: 'Carlos',
                    last_name: 'Rodríguez',
                    email: 'carlos.rodriguez@example.com',
                    phone: '+595981234569',
                    total_orders: 0,
                    total_spent: 0,
                    accepts_marketing: false
                },
                {
                    store_id: STORE_1_ID,
                    first_name: 'Ana',
                    last_name: 'Martínez',
                    email: 'ana.martinez@example.com',
                    phone: '+595981234570',
                    total_orders: 0,
                    total_spent: 0,
                    accepts_marketing: true
                },
                {
                    store_id: STORE_1_ID,
                    first_name: 'Luis',
                    last_name: 'Fernández',
                    email: 'luis.fernandez@example.com',
                    phone: '+595981234571',
                    total_orders: 0,
                    total_spent: 0,
                    accepts_marketing: true
                },
                {
                    store_id: STORE_1_ID,
                    first_name: 'Laura',
                    last_name: 'López',
                    email: 'laura.lopez@example.com',
                    phone: '+595981234572',
                    total_orders: 0,
                    total_spent: 0,
                    accepts_marketing: false
                }
            ])
            .select();

        if (customersError) throw customersError;
        console.log(`✅ ${customers?.length || 0} customers seeded\n`);

        // ================================================================
        // SUCCESS
        // ================================================================
        console.log('════════════════════════════════════════════════');
        console.log('✅ DATABASE SEED COMPLETED SUCCESSFULLY');
        console.log('════════════════════════════════════════════════');
        console.log(`📊 Summary:`);
        console.log(`   - Stores: ${stores?.length || 0}`);
        console.log(`   - Products: ${products?.length || 0}`);
        console.log(`   - Customers: ${customers?.length || 0}`);
        console.log('════════════════════════════════════════════════\n');

    } catch (error: any) {
        console.error('❌ Seed failed:', error.message);
        console.error('Details:', error);
        process.exit(1);
    }
}

// Run seed
seed();
