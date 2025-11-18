/**
 * DIAGNOSTIC SCRIPT: Check Store-User Associations
 *
 * Run this to diagnose the store-user association issue
 *
 * Usage: npx tsx api/scripts/diagnose-associations.ts
 */

import { supabase } from '../db/connection';

async function diagnoseAssociations() {
    console.log('🔍 DIAGNOSING STORE-USER ASSOCIATIONS\n');
    console.log('='.repeat(60));

    try {
        // 1. Check for stores without users
        console.log('\n📊 1. Checking for orphaned stores (stores without users)...');
        const { data: orphanedStores, error: storesError } = await supabase
            .from('stores')
            .select(`
                id,
                name,
                created_at,
                user_stores (
                    id
                )
            `);

        if (storesError) {
            console.error('❌ Error fetching stores:', storesError);
        } else {
            const storesWithoutUsers = orphanedStores?.filter(
                (store: any) => !store.user_stores || store.user_stores.length === 0
            );

            if (storesWithoutUsers && storesWithoutUsers.length > 0) {
                console.log(`⚠️  Found ${storesWithoutUsers.length} orphaned stores:`);
                storesWithoutUsers.forEach((store: any) => {
                    console.log(`   - ${store.name} (${store.id}) created ${store.created_at}`);
                });
            } else {
                console.log('✅ All stores have associated users');
            }
        }

        // 2. Check for users without stores
        console.log('\n📊 2. Checking for orphaned users (users without stores)...');
        const { data: orphanedUsers, error: usersError } = await supabase
            .from('users')
            .select(`
                id,
                email,
                name,
                created_at,
                user_stores (
                    id
                )
            `);

        if (usersError) {
            console.error('❌ Error fetching users:', usersError);
        } else {
            const usersWithoutStores = orphanedUsers?.filter(
                (user: any) => !user.user_stores || user.user_stores.length === 0
            );

            if (usersWithoutStores && usersWithoutStores.length > 0) {
                console.log(`⚠️  Found ${usersWithoutStores.length} orphaned users:`);
                usersWithoutStores.forEach((user: any) => {
                    console.log(`   - ${user.email} (${user.name}) created ${user.created_at}`);
                });
            } else {
                console.log('✅ All users have associated stores');
            }
        }

        // 3. Show association statistics
        console.log('\n📊 3. Association Statistics:');

        const { count: userCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        const { count: storeCount } = await supabase
            .from('stores')
            .select('*', { count: 'exact', head: true });

        const { count: associationCount } = await supabase
            .from('user_stores')
            .select('*', { count: 'exact', head: true });

        console.log(`   - Total Users: ${userCount}`);
        console.log(`   - Total Stores: ${storeCount}`);
        console.log(`   - Total Associations: ${associationCount}`);

        // 4. Show detailed associations
        console.log('\n📊 4. Detailed Associations:');
        const { data: associations, error: assocError } = await supabase
            .from('user_stores')
            .select(`
                role,
                users (
                    email,
                    name
                ),
                stores (
                    name,
                    country
                )
            `);

        if (assocError) {
            console.error('❌ Error fetching associations:', assocError);
        } else {
            if (associations && associations.length > 0) {
                associations.forEach((assoc: any) => {
                    console.log(`   - ${assoc.users.email} (${assoc.users.name}) → ${assoc.stores.name} [${assoc.role}]`);
                });
            } else {
                console.log('   ⚠️  No associations found!');
            }
        }

        // 5. Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        const storesWithoutUsers = orphanedStores?.filter(
            (store: any) => !store.user_stores || store.user_stores.length === 0
        );
        const usersWithoutStores = orphanedUsers?.filter(
            (user: any) => !user.user_stores || user.user_stores.length === 0
        );
        const hasOrphanedStores = storesWithoutUsers && storesWithoutUsers.length > 0;
        const hasOrphanedUsers = usersWithoutStores && usersWithoutStores.length > 0;

        if (hasOrphanedStores || hasOrphanedUsers) {
            console.log('   ⚠️  Issues found! Run the fix migration:');
            console.log('   📝 Execute: db/migrations/006_fix_store_user_associations.sql');
            console.log('   Or use: npm run db:migrate');
        } else {
            console.log('   ✅ No issues found. All associations are correct.');
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ DIAGNOSTIC COMPLETE\n');

    } catch (error) {
        console.error('💥 Unexpected error:', error);
        process.exit(1);
    }
}

// Run diagnostics
diagnoseAssociations().then(() => {
    process.exit(0);
});
