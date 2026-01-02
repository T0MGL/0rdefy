#!/usr/bin/env tsx
/**
 * Check Stripe Prices
 * Verifies that all price IDs in Stripe match expected values
 */

import Stripe from 'stripe';
import 'dotenv/config';

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY no configurado en .env');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

const expectedPrices = [
  { id: 'price_1SkWhi8jew17tEHtwMsLHYBE', plan: 'Starter', interval: 'month', amount: 2900 },
  { id: 'price_1SlGbh8jew17tEHtNxuLQI7Y', plan: 'Starter', interval: 'year', amount: 28800 },
  { id: 'price_1SkWhk8jew17tEHt5dTb8ra5', plan: 'Growth', interval: 'month', amount: 7900 },
  { id: 'price_1SlGbi8jew17tEHtrNgekJLu', plan: 'Growth', interval: 'year', amount: 79200 },
  { id: 'price_1SlGWI8jew17tEHtmMXcP9zG', plan: 'Professional', interval: 'month', amount: 16900 },
  { id: 'price_1SlGbk8jew17tEHtKaxvPuBc', plan: 'Professional', interval: 'year', amount: 170400 },
];

async function checkPrices() {
  console.log('🔍 Verificando precios en Stripe...\n');

  let allCorrect = true;

  for (const expected of expectedPrices) {
    try {
      const price = await stripe.prices.retrieve(expected.id);

      const isCorrect =
        price.unit_amount === expected.amount &&
        price.recurring?.interval === expected.interval &&
        price.active === true;

      const status = isCorrect ? '✅' : '❌';
      const monthlyEquivalent = expected.interval === 'year'
        ? `($${(expected.amount / 12 / 100).toFixed(0)}/mes)`
        : '';

      console.log(`${status} ${expected.plan} ${expected.interval === 'month' ? 'Mensual' : 'Anual'}`);
      console.log(`   ID: ${expected.id}`);
      console.log(`   Esperado: $${expected.amount / 100} ${monthlyEquivalent}`);
      console.log(`   En Stripe: $${price.unit_amount! / 100}`);
      console.log(`   Activo: ${price.active}`);

      if (!isCorrect) {
        allCorrect = false;
        if (price.unit_amount !== expected.amount) {
          console.log(`   ⚠️  Precio incorrecto! (esperado: $${expected.amount / 100})`);
        }
        if (!price.active) {
          console.log(`   ⚠️  Precio NO activo!`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.log(`❌ ${expected.plan} ${expected.interval}`);
      console.log(`   Error: ${error.message}\n`);
      allCorrect = false;
    }
  }

  console.log('='.repeat(50));
  if (allCorrect) {
    console.log('✅ Todos los precios están correctos en Stripe!\n');
    console.log('RESUMEN:');
    console.log('  Starter: $29/mes o $288/año ($24/mes)');
    console.log('  Growth: $79/mes o $792/año ($66/mes)');
    console.log('  Professional: $169/mes o $1,704/año ($142/mes)');
  } else {
    console.log('❌ Hay errores en los precios de Stripe');
    console.log('   Ejecuta: npm run init-stripe-plans');
    process.exit(1);
  }
}

checkPrices().catch(console.error);
