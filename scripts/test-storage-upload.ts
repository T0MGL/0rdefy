/**
 * Test Storage Upload Functionality
 *
 * Run this to verify that storage uploads work correctly.
 * Usage: npx ts-node scripts/test-storage-upload.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testUpload() {
  console.log('🧪 Testing storage upload functionality...\n');

  // Create a simple test image (1x1 red pixel PNG)
  const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const testImageBuffer = Buffer.from(testImageBase64, 'base64');

  const testStoreId = 'test-store-' + Date.now();
  const testEntityId = 'test-entity-' + Date.now();
  const testFileName = `${testStoreId}/${testEntityId}/test.png`;

  // Test each bucket
  const buckets = ['avatars', 'products', 'merchandise'];

  for (const bucket of buckets) {
    console.log(`📦 Testing bucket: ${bucket}`);

    try {
      // Upload test file
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(testFileName, testImageBuffer, {
          contentType: 'image/png',
          upsert: true
        });

      if (uploadError) {
        console.log(`   ❌ Upload failed: ${uploadError.message}`);
        continue;
      }

      console.log(`   ✅ Upload successful`);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(testFileName);

      console.log(`   🔗 Public URL: ${urlData.publicUrl}`);

      // Test public access
      const response = await fetch(urlData.publicUrl);
      if (response.ok) {
        console.log(`   ✅ Public access works (status: ${response.status})`);
      } else {
        console.log(`   ⚠️  Public access returned: ${response.status}`);
      }

      // Clean up test file
      const { error: deleteError } = await supabase.storage
        .from(bucket)
        .remove([testFileName]);

      if (deleteError) {
        console.log(`   ⚠️  Cleanup failed: ${deleteError.message}`);
      } else {
        console.log(`   🧹 Cleanup successful`);
      }

    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message}`);
    }

    console.log('');
  }

  console.log('✅ Storage test complete!');
}

testUpload().catch(console.error);
