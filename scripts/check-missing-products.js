#!/usr/bin/env node
/**
 * Script para verificar qué productos de Shopify faltan en el inventario local
 * Útil antes de intentar crear sesiones de warehouse
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMissingProducts() {
  console.log('🔍 Verificando productos faltantes en pedidos confirmados...\n');

  // 1. Get all confirmed orders
  const { data: orders } = await supabase
    .from('orders')
    .select('id, shopify_order_number')
    .eq('sleeves_status', 'confirmed');

  if (!orders || orders.length === 0) {
    console.log('✅ No hay pedidos confirmados en este momento.');
    return;
  }

  console.log(`📦 Encontrados ${orders.length} pedidos confirmados\n`);

  const orderIds = orders.map(o => o.id);

  // 2. Get line items for these orders
  const { data: lineItems } = await supabase
    .from('order_line_items')
    .select('product_id, shopify_product_id, shopify_variant_id, product_name, quantity')
    .in('order_id', orderIds);

  // 3. Find unmapped items (product_id is NULL)
  const unmappedItems = lineItems?.filter(item => !item.product_id) || [];

  if (unmappedItems.length === 0) {
    console.log('✅ ¡Excelente! Todos los productos están sincronizados.');
    console.log('   Puedes crear sesiones de warehouse sin problemas.\n');
    return;
  }

  // 4. Group by Shopify product ID to avoid duplicates
  const uniqueProducts = new Map();
  unmappedItems.forEach(item => {
    const key = item.shopify_product_id;
    if (!uniqueProducts.has(key)) {
      uniqueProducts.set(key, item);
    }
  });

  console.log(`❌ PROBLEMA: ${uniqueProducts.size} producto(s) NO están en tu inventario:\n`);

  let index = 1;
  for (const [shopifyId, item] of uniqueProducts) {
    console.log(`${index}. ${item.product_name}`);
    console.log(`   Shopify Product ID: ${shopifyId}`);
    console.log(`   Shopify Variant ID: ${item.shopify_variant_id || 'N/A'}`);
    console.log('');
    index++;
  }

  console.log('📋 Acciones necesarias:\n');
  console.log('   1. Ve a la página de Productos en Ordefy');
  console.log('   2. Agrega manualmente estos productos');
  console.log('      - Asegúrate de poner el Shopify Product ID en el campo correspondiente');
  console.log('');
  console.log('   O bien:');
  console.log('');
  console.log('   1. Ve a Integraciones > Shopify');
  console.log('   2. Haz clic en "Sincronizar Productos"');
  console.log('   3. Espera a que se complete la sincronización');
  console.log('');
  console.log('💡 Hasta que agregues estos productos, NO podrás crear sesiones');
  console.log('   de warehouse con los pedidos que los contienen.\n');
}

checkMissingProducts()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
