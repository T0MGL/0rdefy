// ================================================================
// SEED SCRIPT - Populate suppliers table with test data
// ================================================================
import { supabase } from '../db/connection';

const STORE_1_ID = '11111111-1111-1111-1111-111111111111';

async function seedSuppliers() {
    console.log('🌱 Seeding suppliers...\\n');

    try {
        // Check if suppliers already exist
        const { data: existingSuppliers } = await supabase
            .from('suppliers')
            .select('id')
            .eq('store_id', STORE_1_ID)
            .limit(1);

        if (existingSuppliers && existingSuppliers.length > 0) {
            console.log('⚠️  Suppliers already exist, skipping...');
            return;
        }

        const { data: suppliers, error: suppliersError } = await supabase
            .from('suppliers')
            .insert([
                {
                    store_id: STORE_1_ID,
                    name: 'TechSupply LATAM',
                    contact_person: 'Juan Pérez',
                    email: 'juan@techsupply.com',
                    phone: '+595981111111',
                    rating: 4.5
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Electronics Wholesale',
                    contact_person: 'Laura Silva',
                    email: 'laura@electronics.com',
                    phone: '+595982222222',
                    rating: 4.8
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Global Tech Distributors',
                    contact_person: 'Carlos Mendoza',
                    email: 'carlos@globaltech.com',
                    phone: '+595983333333',
                    rating: 4.2
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Smart Devices Inc',
                    contact_person: 'Ana Rodríguez',
                    email: 'ana@smartdevices.com',
                    phone: '+595984444444',
                    rating: 4.7
                },
                {
                    store_id: STORE_1_ID,
                    name: 'Accessories Pro',
                    contact_person: 'Miguel Torres',
                    email: 'miguel@accessoriespro.com',
                    phone: '+595985555555',
                    rating: 3.9
                }
            ])
            .select();

        if (suppliersError) throw suppliersError;

        console.log(`✅ ${suppliers?.length || 0} suppliers seeded\\n`);
        console.log('════════════════════════════════════════════════');
        console.log('✅ SUPPLIERS SEED COMPLETED SUCCESSFULLY');
        console.log('════════════════════════════════════════════════\\n');

    } catch (error: any) {
        console.error('❌ Seed failed:', error.message);
        console.error('Details:', error);
        process.exit(1);
    }
}

// Run seed
seedSuppliers();
