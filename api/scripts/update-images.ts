// Update product images
import { supabase } from '../db/connection';

const STORE_1_ID = '11111111-1111-1111-1111-111111111111';

const imageUpdates = [
    { sku: 'AUR-BT-001', image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop' },
    { sku: 'SW-S5-001', image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=300&fit=crop' },
    { sku: 'TEC-RGB-001', image_url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&h=300&fit=crop' },
    { sku: 'MOU-GAM-001', image_url: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400&h=300&fit=crop' },
    { sku: 'WEB-HD-001', image_url: 'https://images.unsplash.com/photo-1564466809058-bf4114d55352?w=400&h=300&fit=crop' },
    { sku: 'MOC-LAP-001', image_url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=300&fit=crop' },
    { sku: 'CAB-USC-001', image_url: 'https://images.unsplash.com/photo-1625948515291-69613efd103f?w=400&h=300&fit=crop' },
    { sku: 'PWR-20K-001', image_url: 'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&h=300&fit=crop' },
    { sku: 'SOP-LAP-001', image_url: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400&h=300&fit=crop' },
    { sku: 'HUB-USB-001', image_url: 'https://images.unsplash.com/photo-1625948515291-69613efd103f?w=400&h=300&fit=crop' }
];

async function updateImages() {
    console.log('🖼️  Updating product images...\n');

    for (const update of imageUpdates) {
        const { data, error } = await supabase
            .from('products')
            .update({ image_url: update.image_url })
            .eq('sku', update.sku)
            .eq('store_id', STORE_1_ID)
            .select();

        if (error) {
            console.error(`❌ Failed to update ${update.sku}:`, error.message);
        } else {
            console.log(`✅ Updated ${update.sku}`);
        }
    }

    console.log('\n✅ All images updated!');
}

updateImages();
