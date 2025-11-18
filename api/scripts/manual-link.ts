/**
 * MANUAL LINK: Link existing store to existing user
 *
 * Usage: npx tsx api/scripts/manual-link.ts
 */

import { supabase } from '../db/connection';

async function manualLink() {
    console.log('🔗 MANUALLY LINKING STORES TO USERS\n');
    console.log('='.repeat(60));

    try {
        // Get all users and stores
        const { data: users } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: true });

        const { data: stores } = await supabase
            .from('stores')
            .select('*')
            .order('created_at', { ascending: true });

        const { data: existingAssociations } = await supabase
            .from('user_stores')
            .select('user_id, store_id');

        console.log(`\n📊 Current State:`);
        console.log(`   - Users: ${users?.length || 0}`);
        console.log(`   - Stores: ${stores?.length || 0}`);
        console.log(`   - Existing Associations: ${existingAssociations?.length || 0}`);

        if (!users || !stores || users.length === 0 || stores.length === 0) {
            console.log('\n⚠️  No users or stores found to link');
            return;
        }

        // Delete the duplicate store that was just created
        console.log('\n🗑️  Deleting duplicate stores...');
        const { data: duplicates } = await supabase
            .from('stores')
            .select('id, name, created_at')
            .order('created_at', { ascending: false })
            .limit(10);

        if (duplicates && duplicates.length > 1) {
            // Find stores without users
            for (const store of duplicates) {
                const { data: hasUsers } = await supabase
                    .from('user_stores')
                    .select('id')
                    .eq('store_id', store.id)
                    .limit(1);

                if (hasUsers && hasUsers.length > 0) {
                    console.log(`   ✅ Store "${store.name}" has users, keeping it`);
                } else {
                    // Check if this is the older store (we want to keep the older one)
                    const storeDate = new Date(store.created_at);
                    const firstStoreDate = new Date(duplicates[duplicates.length - 1].created_at);

                    if (storeDate > firstStoreDate) {
                        console.log(`   🗑️  Deleting newer duplicate: "${store.name}" (${store.id})`);
                        await supabase.from('stores').delete().eq('id', store.id);
                    }
                }
            }
        }

        // Link all users to the oldest store
        console.log('\n🔗 Linking users to stores...');
        const oldestStore = stores[0]; // The oldest store is what we want to keep

        for (const user of users) {
            // Check if user already has this store
            const { data: existingLink } = await supabase
                .from('user_stores')
                .select('id')
                .eq('user_id', user.id)
                .eq('store_id', oldestStore.id)
                .limit(1);

            if (existingLink && existingLink.length > 0) {
                console.log(`   ✅ User "${user.email}" already linked to "${oldestStore.name}"`);
            } else {
                console.log(`   🔗 Linking "${user.email}" to "${oldestStore.name}"`);
                const { error } = await supabase
                    .from('user_stores')
                    .insert({
                        user_id: user.id,
                        store_id: oldestStore.id,
                        role: 'owner',
                    });

                if (error) {
                    console.error(`   ❌ Failed to link:`, error.message);
                } else {
                    console.log(`   ✅ Successfully linked`);
                }
            }
        }

        // Final verification
        console.log('\n📊 Final State:');
        const { count: finalUserCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        const { count: finalStoreCount } = await supabase
            .from('stores')
            .select('*', { count: 'exact', head: true });

        const { count: finalAssocCount } = await supabase
            .from('user_stores')
            .select('*', { count: 'exact', head: true });

        console.log(`   - Users: ${finalUserCount}`);
        console.log(`   - Stores: ${finalStoreCount}`);
        console.log(`   - Associations: ${finalAssocCount}`);

        console.log('\n' + '='.repeat(60));
        console.log('✅ MANUAL LINKING COMPLETE\n');

    } catch (error) {
        console.error('💥 Unexpected error:', error);
        process.exit(1);
    }
}

manualLink().then(() => {
    process.exit(0);
});
