#!/usr/bin/env tsx
/**
 * Migration Script: Convert Generic Error Messages to User-Friendly Messages
 *
 * This script automatically updates all catch blocks in the codebase to use
 * the new showErrorToast utility for better user experience.
 *
 * Usage: npx tsx scripts/migrate-error-messages.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

// Files to process
const filesToMigrate = [
  // Pages with multiple error handlers
  'src/pages/Merchandise.tsx',
  'src/pages/Returns.tsx',
  'src/pages/Carriers.tsx',
  'src/pages/Customers.tsx',
  'src/pages/Suppliers.tsx',
  'src/pages/Campaigns.tsx',
  'src/pages/Integrations.tsx',
  'src/pages/Billing.tsx',
  'src/pages/Settings.tsx',
  'src/pages/AcceptInvitation.tsx',

  // API routes
  'api/routes/orders.ts',
  'api/routes/products.ts',
  'api/routes/returns.ts',
  'api/routes/merchandise.ts',
  'api/routes/shopify.ts',
  'api/routes/collaborators.ts',
  'api/routes/billing.ts',
  'api/routes/phone-verification.ts',
];

interface MigrationStat {
  file: string;
  catchBlocks: number;
  updated: boolean;
  error?: string;
}

const stats: MigrationStat[] = [];

function addImportIfNeeded(content: string, filePath: string): string {
  const isFrontend = filePath.startsWith('src/');

  if (isFrontend) {
    // Frontend: Add showErrorToast import
    if (!content.includes("import { showErrorToast }")) {
      // Find the last import statement
      const importRegex = /^import .+ from .+;$/gm;
      const imports = content.match(importRegex);

      if (imports && imports.length > 0) {
        const lastImport = imports[imports.length - 1];
        const insertPoint = content.indexOf(lastImport) + lastImport.length;

        content =
          content.slice(0, insertPoint) +
          "\nimport { showErrorToast } from '@/utils/errorMessages';" +
          content.slice(insertPoint);
      }
    }
  } else {
    // Backend: Add error response helpers import
    if (!content.includes("from '../utils/errorResponses'")) {
      // Find first import
      const firstImportMatch = content.match(/^import .+ from .+;$/m);

      if (firstImportMatch) {
        const insertPoint = content.indexOf(firstImportMatch[0]);
        content =
          content.slice(0, insertPoint) +
          "import { productNotFound, orderCannotBeDeleted, serverError, databaseError, missingRequiredFields } from '../utils/errorResponses';\n" +
          content.slice(insertPoint);
      }
    }
  }

  return content;
}

function migrateFrontendErrors(content: string): string {
  // Pattern 1: Generic toast errors with just "Error" title
  content = content.replace(
    /toast\(\{\s*title:\s*['"]Error['"]\s*,\s*description:\s*['"]([^'"]+)['"]\s*,\s*variant:\s*['"]destructive['"]\s*,?\s*\}\);/g,
    (match, description) => {
      // Try to infer context from description
      let module = 'general';
      let action = 'unknown';
      let entity = 'operación';

      if (description.includes('pedido')) {
        module = 'orders';
        entity = 'pedido';
      } else if (description.includes('producto')) {
        module = 'products';
        entity = 'producto';
      } else if (description.includes('stock')) {
        module = 'products';
        action = 'adjust_stock';
        entity = 'stock';
      } else if (description.includes('cliente')) {
        module = 'customers';
        entity = 'cliente';
      }

      return `showErrorToast(toast, error, { module: '${module}', action: '${action}', entity: '${entity}' });`;
    }
  );

  // Pattern 2: Error with error.message fallback
  content = content.replace(
    /toast\(\{\s*title:\s*['"][^'"]+['"]\s*,\s*description:\s*error\.message \|\| ['"]([^'"]+)['"]\s*,\s*variant:\s*['"]destructive['"]\s*,?\s*\}\);/g,
    (match, fallback) => {
      return `showErrorToast(toast, error, { module: 'general', action: 'unknown', entity: 'operación' });`;
    }
  );

  return content;
}

function migrateBackendErrors(content: string): string {
  // Pattern 1: Generic 404 Product not found
  content = content.replace(
    /res\.status\(404\)\.json\(\{\s*error:\s*['"]Producto no encontrado['"]\s*\}\);?/g,
    'productNotFound(res);'
  );

  // Pattern 2: Generic 500 errors
  content = content.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*['"]([^'"]+)['"]\s*(?:,\s*details:\s*error\.message)?\s*\}\);?/g,
    'serverError(res, error);'
  );

  // Pattern 3: Database errors
  content = content.replace(
    /res\.status\(500\)\.json\(\{\s*error:\s*error\.message\s*\}\);?/g,
    'databaseError(res, error);'
  );

  return content;
}

function processFile(filePath: string): void {
  const fullPath = path.join(projectRoot, filePath);

  if (!fs.existsSync(fullPath)) {
    stats.push({
      file: filePath,
      catchBlocks: 0,
      updated: false,
      error: 'File not found'
    });
    return;
  }

  try {
    let content = fs.readFileSync(fullPath, 'utf-8');
    const originalContent = content;

    // Count catch blocks
    const catchBlocks = (content.match(/} catch/g) || []).length;

    // Add import if needed
    content = addImportIfNeeded(content, filePath);

    // Apply migrations
    if (filePath.startsWith('src/')) {
      content = migrateFrontendErrors(content);
    } else {
      content = migrateBackendErrors(content);
    }

    // Write back if changed
    const updated = content !== originalContent;
    if (updated) {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    stats.push({
      file: filePath,
      catchBlocks,
      updated,
    });

  } catch (error) {
    stats.push({
      file: filePath,
      catchBlocks: 0,
      updated: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// Main execution
console.log('🚀 Starting error message migration...\n');

filesToMigrate.forEach(processFile);

// Print summary
console.log('\n📊 Migration Summary:');
console.log('═'.repeat(60));

const totalFiles = stats.length;
const updatedFiles = stats.filter(s => s.updated).length;
const totalCatchBlocks = stats.reduce((sum, s) => sum + s.catchBlocks, 0);
const errors = stats.filter(s => s.error);

console.log(`Total files processed: ${totalFiles}`);
console.log(`Files updated: ${updatedFiles}`);
console.log(`Total catch blocks found: ${totalCatchBlocks}`);
console.log(`Errors: ${errors.length}`);

if (errors.length > 0) {
  console.log('\n❌ Errors:');
  errors.forEach(e => {
    console.log(`  - ${e.file}: ${e.error}`);
  });
}

console.log('\n✅ Updated files:');
stats.filter(s => s.updated).forEach(s => {
  console.log(`  ✓ ${s.file} (${s.catchBlocks} catch blocks)`);
});

console.log('\n📝 Next steps:');
console.log('  1. Review the changes in the updated files');
console.log('  2. Test critical user flows (orders, products, warehouse)');
console.log('  3. Commit the changes');

console.log('\n✨ Migration complete!');
