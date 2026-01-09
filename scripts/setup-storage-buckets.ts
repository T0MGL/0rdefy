/**
 * Setup Storage Buckets for Ordefy
 *
 * Run this script to create the required storage buckets in Supabase.
 * This must be run once during initial setup or when deploying to a new environment.
 *
 * Usage: npx ts-node scripts/setup-storage-buckets.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface BucketConfig {
  name: string;
  public: boolean;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
}

const BUCKETS: BucketConfig[] = [
  {
    name: 'avatars',
    public: true,
    fileSizeLimit: 2 * 1024 * 1024, // 2MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  {
    name: 'products',
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  {
    name: 'merchandise',
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  }
];

async function setupBuckets() {
  console.log('🚀 Setting up Supabase Storage buckets...\n');

  for (const bucket of BUCKETS) {
    console.log(`📦 Processing bucket: ${bucket.name}`);

    // Check if bucket exists
    const { data: existingBucket, error: listError } = await supabase.storage.getBucket(bucket.name);

    if (existingBucket) {
      console.log(`   ✅ Bucket "${bucket.name}" already exists`);

      // Update bucket settings
      const { error: updateError } = await supabase.storage.updateBucket(bucket.name, {
        public: bucket.public,
        fileSizeLimit: bucket.fileSizeLimit,
        allowedMimeTypes: bucket.allowedMimeTypes
      });

      if (updateError) {
        console.log(`   ⚠️  Could not update settings: ${updateError.message}`);
      } else {
        console.log(`   ✅ Updated bucket settings`);
      }
    } else {
      // Create new bucket
      const { data, error: createError } = await supabase.storage.createBucket(bucket.name, {
        public: bucket.public,
        fileSizeLimit: bucket.fileSizeLimit,
        allowedMimeTypes: bucket.allowedMimeTypes
      });

      if (createError) {
        console.error(`   ❌ Failed to create bucket: ${createError.message}`);
      } else {
        console.log(`   ✅ Created bucket "${bucket.name}"`);
      }
    }

    console.log(`   📊 Config: public=${bucket.public}, maxSize=${bucket.fileSizeLimit / 1024 / 1024}MB`);
    console.log('');
  }

  console.log('✅ Storage bucket setup complete!\n');
  console.log('📝 Next steps:');
  console.log('   1. Run migration 037_storage_buckets_setup.sql to create RLS policies');
  console.log('   2. Test uploads via the app');
}

async function verifyBuckets() {
  console.log('\n🔍 Verifying buckets...\n');

  const { data: buckets, error } = await supabase.storage.listBuckets();

  if (error) {
    console.error('❌ Could not list buckets:', error.message);
    return;
  }

  console.log('Existing buckets:');
  for (const bucket of buckets || []) {
    console.log(`   - ${bucket.name} (public: ${bucket.public})`);
  }

  // Check our required buckets
  const requiredBuckets = ['avatars', 'products', 'merchandise'];
  const missingBuckets = requiredBuckets.filter(
    name => !buckets?.some(b => b.name === name)
  );

  if (missingBuckets.length > 0) {
    console.log(`\n⚠️  Missing buckets: ${missingBuckets.join(', ')}`);
  } else {
    console.log('\n✅ All required buckets exist!');
  }
}

async function main() {
  try {
    await setupBuckets();
    await verifyBuckets();
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

main();
