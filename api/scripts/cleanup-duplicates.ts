/**
 * CLEANUP: Remove duplicate stores and keep only the original
 *
 * Usage: npx tsx api/scripts/cleanup-duplicates.ts
 */

import { supabase } from '../db/connection';

async function cleanupDuplicates() {
    console.log('🧹 CLEANING UP DUPLICATE STORES\n');
    console.log('='.repeat(60));

    try {
        // Get all stores ordered by creation date
        const { data: stores } = await supabase
            .from('stores')
            .select('*')
            .order('created_at', { ascending: true });

        console.log(`\n📊 Found ${stores?.length || 0} stores:`);
        if (stores) {
            stores.forEach((store, index) => {
                console.log(`   ${index + 1}. "${store.name}" (${store.id}) - ${store.created_at}`);
            });
        }

        if (!stores || stores.length <= 1) {
            console.log('\n✅ No duplicates to clean up');
            return;
        }

        // Keep the oldest store (index 0)
        const storeToKeep = stores[0];
        const storesToDelete = stores.slice(1);

        console.log(`\n✅ Keeping: "${storeToKeep.name}" (${storeToKeep.id})`);
        console.log(`🗑️  Will delete ${storesToDelete.length} duplicate(s):`);

        for (const store of storesToDelete) {
            console.log(`\n   🗑️  Deleting: "${store.name}" (${store.id})`);

            // First, move any associations from this store to the store we're keeping
            const { data: associations } = await supabase
                .from('user_stores')
                .select('user_id, role')
                .eq('store_id', store.id);

            if (associations && associations.length > 0) {
                console.log(`      📦 Found ${associations.length} associations to migrate`);

                for (const assoc of associations) {
                    // Check if user already has association with the kept store
                    const { data: existing } = await supabase
                        .from('user_stores')
                        .select('id')
                        .eq('user_id', assoc.user_id)
                        .eq('store_id', storeToKeep.id)
                        .limit(1);

                    if (existing && existing.length > 0) {
                        console.log(`      ✅ User already linked to kept store, will delete duplicate association`);
                        // Delete the duplicate association
                        await supabase
                            .from('user_stores')
                            .delete()
                            .eq('user_id', assoc.user_id)
                            .eq('store_id', store.id);
                    } else {
                        console.log(`      🔗 Migrating association to kept store`);
                        // Update the association to point to the kept store
                        await supabase
                            .from('user_stores')
                            .update({ store_id: storeToKeep.id })
                            .eq('user_id', assoc.user_id)
                            .eq('store_id', store.id);
                    }
                }
            }

            // Now delete the duplicate store
            const { error: deleteError } = await supabase
                .from('stores')
                .delete()
                .eq('id', store.id);

            if (deleteError) {
                console.error(`      ❌ Failed to delete store:`, deleteError.message);
            } else {
                console.log(`      ✅ Store deleted successfully`);
            }
        }

        // Final verification
        console.log('\n📊 Final State:');
        const { count: finalStoreCount } = await supabase
            .from('stores')
            .select('*', { count: 'exact', head: true });

        const { count: finalAssocCount } = await supabase
            .from('user_stores')
            .select('*', { count: 'exact', head: true });

        console.log(`   - Stores: ${finalStoreCount}`);
        console.log(`   - Associations: ${finalAssocCount}`);

        // Show final associations
        const { data: finalAssociations } = await supabase
            .from('user_stores')
            .select(`
                role,
                users (
                    email,
                    name
                ),
                stores (
                    name
                )
            `);

        console.log('\n📋 Final Associations:');
        if (finalAssociations && finalAssociations.length > 0) {
            finalAssociations.forEach((assoc: any) => {
                console.log(`   - ${assoc.users.email} → ${assoc.stores.name} [${assoc.role}]`);
            });
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ CLEANUP COMPLETE\n');

    } catch (error) {
        console.error('💥 Unexpected error:', error);
        process.exit(1);
    }
}

cleanupDuplicates().then(() => {
    process.exit(0);
});
