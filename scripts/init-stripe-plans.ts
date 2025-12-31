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
    description: 'Perfect for small businesses starting their e-commerce journey',
    monthlyPrice: 2900, // $29
    annualPrice: 29580, // $246.50/year ($24.65/month)
    features: [
      '3 team members',
      '500 orders/month',
      '500 products',
      'Warehouse management',
      'Returns processing',
      'Merchandise tracking',
      'Shipping labels',
      'Shopify import',
      '30 days analytics history',
      'PDF/Excel reports',
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
    description: 'For growing businesses with advanced needs',
    monthlyPrice: 7900, // $79
    annualPrice: 80580, // $671.50/year ($67.15/month)
    features: [
      '10 team members',
      '2,000 orders/month',
      '2,000 products',
      'Everything in Starter',
      'Shopify bidirectional sync',
      'Smart alerts',
      'Campaign tracking',
      'API read access',
      '90 days analytics history',
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
    description: 'For established businesses requiring full power',
    monthlyPrice: 19900, // $199
    annualPrice: 202980, // $1691.50/year ($169.15/month)
    features: [
      '25 team members',
      '10,000 orders/month',
      'Unlimited products',
      'Everything in Growth',
      '3 stores',
      'Custom roles',
      'Full API access',
      'Custom webhooks',
      '365 days analytics history',
      'Demand forecasting',
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
