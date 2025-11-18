/**
 * FIX SCRIPT: Repair Store-User Associations
 *
 * This script automatically fixes orphaned stores and users
 * by creating the proper associations in user_stores table
 *
 * Usage: npx tsx api/scripts/fix-associations.ts
 */

import { supabase } from '../db/connection';

async function fixAssociations() {
    console.log('🔧 FIXING STORE-USER ASSOCIATIONS\n');
    console.log('='.repeat(60));

    try {
        let fixCount = 0;

        // 1. Find orphaned stores and match to users by creation time
        console.log('\n📊 1. Finding orphaned stores...');
        const { data: allStores } = await supabase
            .from('stores')
            .select(`
                id,
                name,
                created_at,
                user_stores (
                    id
                )
            `)
            .order('created_at', { ascending: true });

        const orphanedStores = allStores?.filter(
            (store: any) => !store.user_stores || store.user_stores.length === 0
        );

        if (orphanedStores && orphanedStores.length > 0) {
            console.log(`⚠️  Found ${orphanedStores.length} orphaned stores`);

            for (const store of orphanedStores) {
                // Find users created within 5 seconds of this store
                const storeTime = new Date(store.created_at);
                const timeBefore = new Date(storeTime.getTime() - 5000);
                const timeAfter = new Date(storeTime.getTime() + 5000);

                const { data: candidateUsers } = await supabase
                    .from('users')
                    .select('id, email, name, created_at')
                    .gte('created_at', timeBefore.toISOString())
                    .lte('created_at', timeAfter.toISOString())
                    .limit(1);

                if (candidateUsers && candidateUsers.length > 0) {
                    const user = candidateUsers[0];
                    console.log(`   🔗 Linking store "${store.name}" to user "${user.email}"`);

                    const { error } = await supabase
                        .from('user_stores')
                        .insert({
                            user_id: user.id,
                            store_id: store.id,
                            role: 'owner',
                        });

                    if (error) {
                        console.error(`   ❌ Failed to link:`, error.message);
                    } else {
                        console.log(`   ✅ Successfully linked`);
                        fixCount++;
                    }
                } else {
                    console.log(`   ⚠️  No matching user found for store "${store.name}"`);
                }
            }
        } else {
            console.log('✅ No orphaned stores found');
        }

        // 2. Find orphaned users and create stores for them
        console.log('\n📊 2. Finding orphaned users...');
        const { data: allUsers } = await supabase
            .from('users')
            .select(`
                id,
                email,
                name,
                user_stores (
                    id
                )
            `)
            .order('created_at', { ascending: true });

        const orphanedUsers = allUsers?.filter(
            (user: any) => !user.user_stores || user.user_stores.length === 0
        );

        if (orphanedUsers && orphanedUsers.length > 0) {
            console.log(`⚠️  Found ${orphanedUsers.length} orphaned users`);

            for (const user of orphanedUsers) {
                console.log(`   🏪 Creating store for user "${user.email}"`);

                // Create a new store
                const { data: newStore, error: storeError } = await supabase
                    .from('stores')
                    .insert({
                        name: `${user.name}'s Store`,
                        country: 'PY',
                        timezone: 'America/Asuncion',
                        currency: 'USD',
                        is_active: true,
                    })
                    .select()
                    .single();

                if (storeError) {
                    console.error(`   ❌ Failed to create store:`, storeError.message);
                    continue;
                }

                console.log(`   ✅ Store created: ${newStore.id}`);

                // Link user to store
                const { error: linkError } = await supabase
                    .from('user_stores')
                    .insert({
                        user_id: user.id,
                        store_id: newStore.id,
                        role: 'owner',
                    });

                if (linkError) {
                    console.error(`   ❌ Failed to link user to store:`, linkError.message);
                } else {
                    console.log(`   ✅ User linked to store`);
                    fixCount++;
                }
            }
        } else {
            console.log('✅ No orphaned users found');
        }

        // 3. Verify all associations are now correct
        console.log('\n📊 3. Verifying fixes...');

        const { data: verifyStores } = await supabase
            .from('stores')
            .select(`
                id,
                user_stores (
                    id
                )
            `);

        const storesWithoutUsers = verifyStores?.filter(
            (store: any) => !store.user_stores || store.user_stores.length === 0
        ).length || 0;

        const { data: verifyUsers } = await supabase
            .from('users')
            .select(`
                id,
                user_stores (
                    id
                )
            `);

        const usersWithoutStores = verifyUsers?.filter(
            (user: any) => !user.user_stores || user.user_stores.length === 0
        ).length || 0;

        if (storesWithoutUsers === 0 && usersWithoutStores === 0) {
            console.log('✅ All stores and users have proper associations');
        } else {
            console.log(`⚠️  Still have issues:`);
            console.log(`   - Stores without users: ${storesWithoutUsers}`);
            console.log(`   - Users without stores: ${usersWithoutStores}`);
        }

        console.log('\n' + '='.repeat(60));
        console.log(`✅ FIX COMPLETE - ${fixCount} associations created\n`);

    } catch (error) {
        console.error('💥 Unexpected error:', error);
        process.exit(1);
    }
}

// Run fix
fixAssociations().then(() => {
    process.exit(0);
});
