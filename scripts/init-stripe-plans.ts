/**
 * Stripe Plans Initialization Script
 *
 * Creates products and prices in Stripe for Ordefy subscription plans.
 * Run with: npx tsx scripts/init-stripe-plans.ts
 */

import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

interface PlanConfig {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number; // in cents
  annualPrice: number; // in cents (15% discount)
  features: string[];
  metadata: Record<string, string>;
}

const plans: PlanConfig[] = [
  {
    id: 'starter',
    name: 'Ordefy Starter',
    description: 'Perfecto para pequeños negocios que inician su viaje en e-commerce',
    monthlyPrice: 2900, // $29
    annualPrice: 28800, // $288/year ($24/month)
    features: [
      '3 miembros del equipo',
      '500 pedidos/mes',
      '500 productos',
      'Gestión de almacén',
      'Procesamiento de devoluciones',
      'Seguimiento de mercadería',
      'Etiquetas de envío',
      'Importación de Shopify',
      'Historial de 30 días de análisis',
      'Reportes PDF/Excel',
    ],
    metadata: {
      plan_tier: 'starter',
      max_users: '3',
      max_orders_per_month: '500',
      max_products: '500',
      has_trial: 'true',
      trial_days: '14',
    },
  },
  {
    id: 'growth',
    name: 'Ordefy Growth',
    description: 'Para negocios en crecimiento con necesidades avanzadas',
    monthlyPrice: 7900, // $79
    annualPrice: 79200, // $792/year ($66/month)
    features: [
      '10 miembros del equipo',
      '2,000 pedidos/mes',
      '2,000 productos',
      'Todo lo de Starter',
      'Sincronización bidireccional con Shopify',
      'Alertas inteligentes',
      'Seguimiento de campañas',
      'Acceso de lectura a API',
      'Historial de 90 días de análisis',
    ],
    metadata: {
      plan_tier: 'growth',
      max_users: '10',
      max_orders_per_month: '2000',
      max_products: '2000',
      has_trial: 'true',
      trial_days: '14',
    },
  },
  {
    id: 'professional',
    name: 'Ordefy Professional',
    description: 'Para negocios establecidos que requieren máximo poder',
    monthlyPrice: 16900, // $169
    annualPrice: 170400, // $1704/year ($142/month)
    features: [
      '25 miembros del equipo',
      '10,000 pedidos/mes',
      'Productos ilimitados',
      'Todo lo de Growth',
      '3 tiendas',
      'Roles personalizados',
      'Acceso completo a API',
      'Webhooks personalizados',
      'Historial de 365 días de análisis',
      'Pronóstico de demanda',
    ],
    metadata: {
      plan_tier: 'professional',
      max_users: '25',
      max_orders_per_month: '10000',
      max_products: 'unlimited',
      has_trial: 'false',
      trial_days: '0',
    },
  },
];

async function createPlans() {
  console.log('🚀 Starting Stripe plans initialization...\n');

  for (const plan of plans) {
    console.log(`📦 Creating plan: ${plan.name}`);

    try {
      // Check if product already exists
      const existingProducts = await stripe.products.search({
        query: `metadata['plan_tier']:'${plan.id}'`,
      });

      let product: Stripe.Product;

      if (existingProducts.data.length > 0) {
        product = existingProducts.data[0];
        console.log(`   ✅ Product already exists: ${product.id}`);

        // Update product
        product = await stripe.products.update(product.id, {
          name: plan.name,
          description: plan.description,
          metadata: plan.metadata,
        });
        console.log(`   📝 Updated product details`);
      } else {
        // Create product
        product = await stripe.products.create({
          name: plan.name,
          description: plan.description,
          metadata: plan.metadata,
        });
        console.log(`   ✅ Created product: ${product.id}`);
      }

      // Check/create monthly price
      const existingMonthlyPrices = await stripe.prices.list({
        product: product.id,
        active: true,
        type: 'recurring',
      });

      const monthlyPrice = existingMonthlyPrices.data.find(
        (p) => p.recurring?.interval === 'month' && p.unit_amount === plan.monthlyPrice
      );

      if (monthlyPrice) {
        console.log(`   ✅ Monthly price already exists: ${monthlyPrice.id} ($${plan.monthlyPrice / 100}/mo)`);
      } else {
        const newMonthlyPrice = await stripe.prices.create({
          product: product.id,
          unit_amount: plan.monthlyPrice,
          currency: 'usd',
          recurring: {
            interval: 'month',
          },
          metadata: {
            plan_tier: plan.id,
            billing_cycle: 'monthly',
          },
        });
        console.log(`   ✅ Created monthly price: ${newMonthlyPrice.id} ($${plan.monthlyPrice / 100}/mo)`);
      }

      // Check/create annual price
      const annualPrice = existingMonthlyPrices.data.find(
        (p) => p.recurring?.interval === 'year' && p.unit_amount === plan.annualPrice
      );

      if (annualPrice) {
        console.log(`   ✅ Annual price already exists: ${annualPrice.id} ($${plan.annualPrice / 100}/yr)`);
      } else {
        const newAnnualPrice = await stripe.prices.create({
          product: product.id,
          unit_amount: plan.annualPrice,
          currency: 'usd',
          recurring: {
            interval: 'year',
          },
          metadata: {
            plan_tier: plan.id,
            billing_cycle: 'annual',
          },
        });
        console.log(`   ✅ Created annual price: ${newAnnualPrice.id} ($${plan.annualPrice / 100}/yr)`);
      }

      console.log('');
    } catch (error) {
      console.error(`   ❌ Error creating plan ${plan.id}:`, error);
    }
  }

  console.log('✨ Stripe plans initialization complete!\n');

  // List all products and prices for verification
  console.log('📋 Summary of created products:\n');

  const products = await stripe.products.list({ active: true });
  for (const product of products.data) {
    if (product.metadata?.plan_tier) {
      console.log(`  ${product.name} (${product.id})`);
      const prices = await stripe.prices.list({ product: product.id, active: true });
      for (const price of prices.data) {
        const interval = price.recurring?.interval || 'one-time';
        console.log(`    - ${price.id}: $${(price.unit_amount || 0) / 100}/${interval}`);
      }
    }
  }
}

// Also create the referral coupon (20% off first month)
async function createReferralCoupon() {
  console.log('\n🎁 Creating referral coupon...\n');

  try {
    // Check if coupon exists
    const coupons = await stripe.coupons.list({ limit: 100 });
    const existingCoupon = coupons.data.find((c) => c.metadata?.type === 'referral');

    if (existingCoupon) {
      console.log(`   ✅ Referral coupon already exists: ${existingCoupon.id}`);
    } else {
      const coupon = await stripe.coupons.create({
        percent_off: 20,
        duration: 'once',
        name: 'Referral Discount - 20% Off First Month',
        metadata: {
          type: 'referral',
        },
      });
      console.log(`   ✅ Created referral coupon: ${coupon.id}`);
    }
  } catch (error) {
    console.error('   ❌ Error creating referral coupon:', error);
  }
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY not found in environment variables');
    process.exit(1);
  }

  console.log('🔑 Using Stripe API Key:', process.env.STRIPE_SECRET_KEY.slice(0, 12) + '...\n');

  await createPlans();
  await createReferralCoupon();

  console.log('\n🎉 All done! You can verify in your Stripe Dashboard.');
  console.log('   https://dashboard.stripe.com/products\n');
}

main().catch(console.error);
