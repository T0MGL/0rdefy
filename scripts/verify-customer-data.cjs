#!/usr/bin/env node
// Script para verificar que los datos de cliente se están guardando correctamente
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyCustomerData() {
  console.log('🔍 VERIFICANDO DATOS DE CLIENTE EN PEDIDOS DE SHOPIFY\n');

  try {
    // Get last 5 Shopify orders
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        shopify_order_number,
        shopify_order_name,
        customer_first_name,
        customer_last_name,
        customer_email,
        customer_phone,
        customer_address,
        shipping_address,
        created_at
      `)
      .not('shopify_order_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      throw error;
    }

    if (!orders || orders.length === 0) {
      console.log('⚠️  No se encontraron pedidos de Shopify en la base de datos');
      console.log('💡 Crea un pedido de prueba en Shopify y vuelve a ejecutar este script');
      return;
    }

    console.log(`📊 Encontrados ${orders.length} pedidos de Shopify:\n`);

    orders.forEach((order, index) => {
      const orderNum = order.shopify_order_name || order.shopify_order_number || order.id.slice(0, 8);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`${index + 1}. Pedido ${orderNum}`);
      console.log(`   Creado: ${new Date(order.created_at).toLocaleString('es-ES')}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      // Check customer fields
      const hasFirstName = !!order.customer_first_name && order.customer_first_name.trim() !== '';
      const hasLastName = !!order.customer_last_name && order.customer_last_name.trim() !== '';
      const hasEmail = !!order.customer_email && order.customer_email.trim() !== '';
      const hasPhone = !!order.customer_phone && order.customer_phone.trim() !== '';
      const hasAddress = !!order.customer_address && order.customer_address.trim() !== '';

      // Check shipping address completeness
      let hasCompleteShippingAddress = false;
      if (order.shipping_address) {
        const addr = order.shipping_address;
        hasCompleteShippingAddress = !!(
          addr.first_name &&
          addr.last_name &&
          (addr.address1 || addr.address2) &&
          addr.phone
        );
      }

      // Display results
      console.log(`   ${hasFirstName ? '✅' : '❌'} Nombre: ${order.customer_first_name || '(vacío)'}`);
      console.log(`   ${hasLastName ? '✅' : '❌'} Apellido: ${order.customer_last_name || '(vacío)'}`);
      console.log(`   ${hasEmail ? '✅' : '❌'} Email: ${order.customer_email || '(vacío)'}`);
      console.log(`   ${hasPhone ? '✅' : '❌'} Teléfono: ${order.customer_phone || '(vacío)'}`);
      console.log(`   ${hasAddress ? '✅' : '❌'} Dirección: ${order.customer_address || '(vacío)'}`);

      if (order.shipping_address) {
        console.log(`   ${hasCompleteShippingAddress ? '✅' : '⚠️ '} shipping_address: ${hasCompleteShippingAddress ? 'Completo' : 'Incompleto'}`);
        if (!hasCompleteShippingAddress) {
          console.log(`      → País: ${order.shipping_address.country || 'N/A'}`);
          console.log(`      → Dirección 1: ${order.shipping_address.address1 || '(vacío)'}`);
          console.log(`      → Teléfono: ${order.shipping_address.phone || '(vacío)'}`);
        }
      } else {
        console.log(`   ❌ shipping_address: NULL`);
      }

      // Overall status
      const isComplete = hasFirstName && hasLastName && hasEmail && hasPhone && hasAddress;
      console.log(`\n   Estado: ${isComplete ? '✅ COMPLETO' : '❌ INCOMPLETO - Falta customer data'}`);
      console.log('');
    });

    // Summary
    const completeOrders = orders.filter(o =>
      o.customer_first_name && o.customer_last_name && o.customer_email && o.customer_phone
    ).length;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 RESUMEN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Total de pedidos: ${orders.length}`);
    console.log(`   Pedidos con datos completos: ${completeOrders}`);
    console.log(`   Pedidos con datos incompletos: ${orders.length - completeOrders}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (completeOrders === orders.length) {
      console.log('✅ TODOS LOS PEDIDOS TIENEN DATOS COMPLETOS DEL CLIENTE\n');
      console.log('🎉 El fix de enrichment está funcionando correctamente!\n');
    } else {
      console.log('⚠️  ALGUNOS PEDIDOS TIENEN DATOS INCOMPLETOS\n');
      console.log('💡 Si estos son pedidos ANTERIORES al fix, es normal.');
      console.log('   Crea un pedido NUEVO en Shopify y vuelve a ejecutar este script.\n');
      console.log('💡 Si son pedidos NUEVOS, verifica que:');
      console.log('   1. El servidor API esté corriendo (npm run api:dev)');
      console.log('   2. Los webhooks estén configurados correctamente en Shopify');
      console.log('   3. Revisa los logs del servidor para ver errores\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

verifyCustomerData();
