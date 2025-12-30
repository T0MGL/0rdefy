/**
 * Script to create new users in the database
 * Usage: node scripts/create-users.js
 */

const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SALT_ROUNDS = 10;

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createUser(email, password, name) {
    try {
        console.log(`\n📝 Creating user: ${email}`);

        // Check if user already exists
        const { data: existingUser, error: checkError } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', email)
            .single();

        if (existingUser) {
            console.log(`⚠️  User ${email} already exists with ID: ${existingUser.id}`);
            return existingUser;
        }

        // Hash password
        console.log('🔒 Hashing password...');
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

        // Create user
        console.log('💾 Inserting user into database...');
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert({
                email,
                password_hash,
                name,
                is_active: true
            })
            .select()
            .single();

        if (insertError) {
            console.error(`❌ Error creating user ${email}:`, insertError);
            throw insertError;
        }

        console.log(`✅ User created successfully!`);
        console.log(`   ID: ${newUser.id}`);
        console.log(`   Email: ${newUser.email}`);
        console.log(`   Name: ${newUser.name}`);

        return newUser;

    } catch (error) {
        console.error(`💥 Failed to create user ${email}:`, error.message);
        throw error;
    }
}

async function main() {
    console.log('🚀 Starting user creation process...\n');
    console.log('=' .repeat(60));

    try {
        // Create first user
        await createUser(
            'gaston@thebrightidea.ai',
            'rorito28',
            'Gaston Lopez'
        );

        // Create second user
        await createUser(
            'hanselechague6@gmail.com',
            'Casa20799',
            'Hans Elechague'
        );

        console.log('\n' + '='.repeat(60));
        console.log('✅ All users created successfully!');
        console.log('\n📌 Next steps:');
        console.log('   1. Users can now login with their credentials');
        console.log('   2. They will need to complete onboarding to create their store');
        console.log('   3. Or you can manually link them to existing stores using user_stores table');

    } catch (error) {
        console.error('\n💥 Script failed:', error.message);
        process.exit(1);
    }
}

main();
