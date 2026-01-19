// Shopify Webhook Service
// Procesa webhooks de pedidos de Shopify y los envia a n8n para confirmacion automatica

import { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import crypto from 'crypto';
import { ShopifyOrder } from '../types/shopify';
import { logger } from '../utils/logger';

export class ShopifyWebhookService {
  private supabaseAdmin: SupabaseClient;
  private n8nWebhookUrl: string;

  constructor(supabase: SupabaseClient) {
    this.supabaseAdmin = supabase;
    this.n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || '';
  }

  /**
   * Retry helper with exponential backoff + jitter for Shopify GraphQL API calls
   * - Retries on: 5xx errors, 429 (rate limit), timeouts, network errors
   * - Does NOT retry on: 4xx client errors (except 429)
   * - Max delay capped at 10s to avoid excessive waits
   * - Jitter added to prevent thundering herd problem
   */
  private async fetchWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000,
    context: string = 'GraphQL'
  ): Promise<T> {
    const MAX_DELAY = 10000; // Cap delay at 10 seconds

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries - 1;

        // Determine if error is retryable
        const statusCode = error.response?.status;
        const isTimeout = error.code === 'ECONNABORTED' || error.name === 'AbortError';
        const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET';
        const isServerError = statusCode >= 500;
        const isRateLimited = statusCode === 429;

        const isRetryable = isTimeout || isNetworkError || isServerError || isRateLimited;

        // Log the error with context
        const errorType = isTimeout ? 'TIMEOUT' : isNetworkError ? 'NETWORK' : isRateLimited ? 'RATE_LIMIT' : `HTTP_${statusCode || 'UNKNOWN'}`;

        if (isLastAttempt || !isRetryable) {
          if (!isRetryable) {
            logger.error('SHOPIFY_WEBHOOK', `[${context}] Non-retryable error (${errorType}): ${error.message}`);
          } else {
            logger.error('SHOPIFY_WEBHOOK', `[${context}] Max retries (${maxRetries}) exceeded. Last error (${errorType}): ${error.message}`);
          }
          throw error;
        }

        // Calculate delay with exponential backoff + jitter (±25%)
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = exponentialDelay * (0.75 + Math.random() * 0.5); // 75% to 125% of base
        const delay = Math.min(jitter, MAX_DELAY);

        logger.warn('SHOPIFY_WEBHOOK', `[${context}] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms (${errorType})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // This should never be reached due to throw in loop, but TypeScript needs it
    throw new Error(`[${context}] Max retries exceeded`);
  }

  // Extract customer data from order addresses (fallback when customer object is not accessible)
  private extractCustomerFromOrderAddresses(order: any): any | null {
    // If customer object doesn't exist or is restricted, use billing/shipping addresses
    const billingAddress = order.billing_address || order.billingAddress;
    const shippingAddress = order.shipping_address || order.shippingAddress;
    const email = order.email;
    const phone = order.phone || billingAddress?.phone || shippingAddress?.phone;

    if (!billingAddress && !shippingAddress && !email) {
      return null;
    }

    const firstName = billingAddress?.first_name || billingAddress?.firstName ||
                      shippingAddress?.first_name || shippingAddress?.firstName || '';
    const lastName = billingAddress?.last_name || billingAddress?.lastName ||
                     shippingAddress?.last_name || shippingAddress?.lastName || '';

    logger.info('SHOPIFY_WEBHOOK', '[FALLBACK] Extracting customer info from order addresses (customer object not available)');

    return {
      id: order.customer?.id || null,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      default_address: billingAddress || shippingAddress
    };
  }

  // Fetch full customer data using GraphQL Admin API 2025-10 (webhooks often have incomplete data)
  private async fetchShopifyCustomerDataGraphQL(
    customerId: string,
    shopDomain: string,
    accessToken: string
  ): Promise<any | null> {
    try {
      const query = `
        query GetCustomer($id: ID!) {
          customer(id: $id) {
            id
            legacyResourceId
            firstName
            lastName
            email
            phone
            defaultAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              provinceCode
              country
              countryCodeV2
              zip
              phone
              company
            }
          }
        }
      `;

      // Use retry with exponential backoff for resilience
      const response = await this.fetchWithRetry(
        async () => {
          // Timeout control (10 seconds)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          try {
            const res = await axios.post(
              `https://${shopDomain}/admin/api/2025-10/graphql.json`,
              {
                query,
                variables: {
                  id: `gid://shopify/Customer/${customerId}`
                }
              },
              {
                headers: {
                  'X-Shopify-Access-Token': accessToken,
                  'Content-Type': 'application/json'
                },
                signal: controller.signal,
                timeout: 10000
              }
            );
            clearTimeout(timeoutId);
            return res;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        3,    // maxRetries
        1000, // baseDelay
        `Shopify Customer ${customerId}` // context for logging
      );

      if (response.data?.errors) {
        const errors = response.data.errors;
        const hasAccessDenied = errors.some((err: any) =>
          err.extensions?.code === 'ACCESS_DENIED' ||
          err.message?.includes('not approved to access')
        );

        if (hasAccessDenied) {
          logger.warn('SHOPIFY_WEBHOOK', `Customer API access denied for shop ${shopDomain}. Using webhook data only.`);
          logger.warn('SHOPIFY_WEBHOOK', 'This is expected for Basic/Trial Shopify plans or apps without customer:read scope.');
        } else {
          logger.error('SHOPIFY_WEBHOOK', `GraphQL errors fetching customer ${customerId}`, errors);
        }
        return null;
      }

      const customer = response.data?.data?.customer;
      if (!customer) {
        return null;
      }

      // Transform GraphQL response to expected format (for compatibility with existing code)
      return {
        id: customerId,
        first_name: customer.firstName,
        last_name: customer.lastName,
        email: customer.email,
        phone: customer.phone,
        default_address: customer.defaultAddress ? {
          first_name: customer.defaultAddress.firstName,
          last_name: customer.defaultAddress.lastName,
          address1: customer.defaultAddress.address1,
          address2: customer.defaultAddress.address2,
          city: customer.defaultAddress.city,
          province: customer.defaultAddress.province,
          province_code: customer.defaultAddress.provinceCode,
          country: customer.defaultAddress.country,
          country_code: customer.defaultAddress.countryCodeV2,
          zip: customer.defaultAddress.zip,
          phone: customer.defaultAddress.phone,
          company: customer.defaultAddress.company
        } : null
      };
    } catch (error: any) {
      if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
        logger.error('SHOPIFY_WEBHOOK', `Timeout fetching customer ${customerId} from Shopify GraphQL (10s limit)`);
      } else {
        logger.error('SHOPIFY_WEBHOOK', `Error al obtener cliente ${customerId} from Shopify GraphQL`, { error: error.message });
      }
      return null;
    }
  }

  // Fetch complete order data using GraphQL Admin API (works on ALL Shopify plans including Basic)
  // GraphQL returns protected PII data even when webhooks redact it
  private async fetchCompleteOrderDataGraphQL(
    orderId: string,
    shopDomain: string,
    accessToken: string
  ): Promise<ShopifyOrder | null> {
    try {
      logger.info('SHOPIFY_WEBHOOK', `Fetching complete order ${orderId} from Shopify GraphQL API (webhook data incomplete)`);

      const query = `
        query GetOrder($id: ID!) {
          order(id: $id) {
            id
            legacyResourceId
            name
            createdAt
            updatedAt
            processedAt
            cancelledAt
            cancelReason
            tags
            note
            email
            phone
            confirmationNumber

            customer {
              id
              legacyResourceId
              firstName
              lastName
              email
              phone
            }

            billingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              provinceCode
              country
              countryCodeV2
              zip
              phone
              company
            }

            shippingAddress {
              firstName
              lastName
              address1
              address2
              city
              province
              provinceCode
              country
              countryCodeV2
              zip
              phone
              company
            }

            lineItems(first: 100) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  quantity
                  sku
                  product {
                    id
                    legacyResourceId
                  }
                  variant {
                    id
                    legacyResourceId
                  }
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  discountedTotalSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  taxLines {
                    priceSet {
                      shopMoney {
                        amount
                      }
                    }
                    rate
                    title
                  }
                  customAttributes {
                    key
                    value
                  }
                }
              }
            }

            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            totalTaxSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            totalDiscountsSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            totalShippingPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            displayFinancialStatus
            displayFulfillmentStatus

            transactions(first: 10) {
              gateway
              status
              kind
            }

            customAttributes {
              key
              value
            }
          }
        }
      `;

      // Use retry with exponential backoff for resilience
      const response = await this.fetchWithRetry(
        async () => {
          // Timeout control (10 seconds)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          try {
            const res = await axios.post(
              `https://${shopDomain}/admin/api/2025-10/graphql.json`,
              {
                query,
                variables: {
                  id: `gid://shopify/Order/${orderId}`
                }
              },
              {
                headers: {
                  'X-Shopify-Access-Token': accessToken,
                  'Content-Type': 'application/json'
                },
                signal: controller.signal,
                timeout: 10000
              }
            );
            clearTimeout(timeoutId);
            return res;
          } catch (error) {
            clearTimeout(timeoutId);
            throw error;
          }
        },
        3,    // maxRetries
        1000, // baseDelay
        `Shopify Order ${orderId}` // context for logging
      );

      if (response.data?.errors) {
        logger.error('SHOPIFY_WEBHOOK', `GraphQL errors fetching order ${orderId}`, response.data.errors);
        return null;
      }

      const order = response.data?.data?.order;
      if (!order) {
        logger.error('SHOPIFY_WEBHOOK', `Order ${orderId} not found in GraphQL API response`);
        return null;
      }

      // Transform GraphQL response to match REST API format (for compatibility)
      const transformedOrder: ShopifyOrder = {
        id: parseInt(order.legacyResourceId, 10),
        order_number: parseInt(order.name.replace('#', ''), 10),
        name: order.name,
        email: order.email,
        phone: order.phone,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        processed_at: order.processedAt,
        cancelled_at: order.cancelledAt,
        cancel_reason: order.cancelReason,
        tags: order.tags?.join(', ') || '',
        delivery_notes: order.note || '',

        customer: (order.customer ? {
          id: parseInt(order.customer.legacyResourceId, 10),
          email: order.customer.email,
          phone: order.customer.phone,
          first_name: order.customer.firstName,
          last_name: order.customer.lastName,
          accepts_marketing: false // Not available in GraphQL 2025-10, default to false
        } : null) as any,

        billing_address: order.billingAddress ? {
          first_name: order.billingAddress.firstName,
          last_name: order.billingAddress.lastName,
          address1: order.billingAddress.address1,
          address2: order.billingAddress.address2,
          city: order.billingAddress.city,
          province: order.billingAddress.province,
          province_code: order.billingAddress.provinceCode,
          country: order.billingAddress.country,
          country_code: order.billingAddress.countryCodeV2,
          zip: order.billingAddress.zip,
          phone: order.billingAddress.phone,
          company: order.billingAddress.company
        } : null,

        shipping_address: order.shippingAddress ? {
          first_name: order.shippingAddress.firstName,
          last_name: order.shippingAddress.lastName,
          address1: order.shippingAddress.address1,
          address2: order.shippingAddress.address2,
          city: order.shippingAddress.city,
          province: order.shippingAddress.province,
          province_code: order.shippingAddress.provinceCode,
          country: order.shippingAddress.country,
          country_code: order.shippingAddress.countryCodeV2,
          zip: order.shippingAddress.zip,
          phone: order.shippingAddress.phone,
          company: order.shippingAddress.company,
          neighborhood: order.shippingAddress.address2 // Map address2 to neighborhood
        } : null,

        line_items: order.lineItems.edges.map((edge: any) => {
          const node = edge.node;
          const unitPrice = parseFloat(node.originalUnitPriceSet.shopMoney.amount);
          const totalPrice = parseFloat(node.discountedTotalSet.shopMoney.amount);
          const quantity = node.quantity;
          const discountAmount = (unitPrice * quantity) - totalPrice;

          return {
            id: parseInt(node.id.split('/').pop(), 10),
            product_id: node.product?.legacyResourceId ? parseInt(node.product.legacyResourceId, 10) : null,
            variant_id: node.variant?.legacyResourceId ? parseInt(node.variant.legacyResourceId, 10) : null,
            title: node.title,
            name: node.title,
            variant_title: node.variantTitle,
            quantity: quantity,
            sku: node.sku,
            price: unitPrice.toFixed(2),
            total_discount: discountAmount.toFixed(2),
            tax_lines: node.taxLines.map((tax: any) => ({
              price: tax.priceSet.shopMoney.amount,
              rate: tax.rate,
              title: tax.title
            })),
            properties: node.customAttributes || []
          };
        }),

        total_price: order.totalPriceSet.shopMoney.amount,
        subtotal_price: order.subtotalPriceSet.shopMoney.amount,
        total_tax: order.totalTaxSet.shopMoney.amount,
        total_discounts: order.totalDiscountsSet.shopMoney.amount,
        total_shipping: order.totalShippingPriceSet.shopMoney.amount,
        currency: order.totalPriceSet.shopMoney.currencyCode,

        financial_status: order.displayFinancialStatus?.toLowerCase() || 'pending',
        fulfillment_status: order.displayFulfillmentStatus?.toLowerCase() || null,

        payment_gateway_names: order.transactions
          .map((transaction: any) => transaction.gateway)
          .filter((gateway: string, index: number, self: string[]) => self.indexOf(gateway) === index),

        note_attributes: order.customAttributes?.map((attr: any) => ({
          name: attr.key,
          value: attr.value
        })) || [],

        contact_email: order.email,
        order_status_url: '', // Not available in GraphQL, leave empty
        // CRITICAL FIX (Bug #4): Safe array access - validate transactions exists and has elements
        gateway: (order.transactions && order.transactions.length > 0)
          ? order.transactions[0]?.gateway || 'unknown'
          : 'unknown'
      };

      logger.info('SHOPIFY_WEBHOOK', `Fetched complete order ${orderId} from GraphQL API with protected PII data`);
      return transformedOrder;

    } catch (error: any) {
      if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
        logger.error('SHOPIFY_WEBHOOK', `Timeout fetching order ${orderId} from Shopify GraphQL (10s limit)`);
      } else {
        logger.error('SHOPIFY_WEBHOOK', `Error al obtener pedido ${orderId} from Shopify GraphQL`, { error: error.message });
      }
      return null;
    }
  }

  // Verificar firma HMAC del webhook de Shopify
  // Soporta AMBOS formatos: base64 (OAuth/Public Apps) y hex (Custom Apps)
  static verifyHmacSignature(body: string, hmacHeader: string, secret: string): boolean {
    try {
      // Validate that secret exists and is not empty
      if (!secret || secret.trim() === '') {
        logger.error('SHOPIFY_WEBHOOK', 'Error verificando HMAC: secret is null or empty');
        return false;
      }

      // Generate base64 hash (OAuth/Public Apps)
      const hashBase64 = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('base64');

      // Generate hex hash (Custom Apps created from Shopify Admin)
      const hashHex = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('hex');

      // Debug logs removed for production security - secrets should never be logged

      // Try base64 format first (OAuth Apps)
      if (hmacHeader === hashBase64) {
        logger.info('SHOPIFY_WEBHOOK', 'HMAC verified (base64 format - OAuth App)');
        return true;
      }

      // Try hex format (Custom Apps)
      if (hmacHeader === hashHex) {
        logger.info('SHOPIFY_WEBHOOK', 'HMAC verified (hex format - Custom App)');
        return true;
      }

      logger.error('SHOPIFY_WEBHOOK', 'HMAC verification failed - neither base64 nor hex format matched');
      logger.error('SHOPIFY_WEBHOOK', `Expected base64: ${hashBase64}`);
      logger.error('SHOPIFY_WEBHOOK', `Expected hex: ${hashHex.substring(0, 64)}`);
      logger.error('SHOPIFY_WEBHOOK', `Received HMAC: ${hmacHeader}`);
      return false;

    } catch (error) {
      logger.error('SHOPIFY_WEBHOOK', 'Error verificando HMAC', error);
      return false;
    }
  }

  // Procesar webhook de pedido creado
  async processOrderCreatedWebhook(
    shopifyOrder: ShopifyOrder,
    storeId: string,
    integrationId: string,
    integration?: { shop_domain: string; access_token: string; api_key?: string; api_secret_key?: string }
  ): Promise<{ success: boolean; order_id?: string; error?: string }> {
    try {
      // Registrar evento de webhook
      await this.logWebhookEvent({
        integration_id: integrationId,
        store_id: storeId,
        event_type: 'order',
        shopify_topic: 'orders/create',
        shopify_event_id: shopifyOrder.id.toString(),
        payload: shopifyOrder
      });

      // Verificar si el pedido ya existe en la base de datos
      const { data: existingOrder } = await this.supabaseAdmin
        .from('orders')
        .select('id')
        .eq('shopify_order_id', shopifyOrder.id.toString())
        .eq('store_id', storeId)
        .single();

      if (existingOrder) {
        logger.info('SHOPIFY_WEBHOOK', `Pedido ${shopifyOrder.id} ya existe, omitiendo`);
        return { success: true, order_id: existingOrder.id };
      }

      // Verificar si el webhook tiene datos completos del cliente
      const hasCompleteData = (
        shopifyOrder.email || shopifyOrder.contact_email || shopifyOrder.phone
      ) && (
        shopifyOrder.billing_address?.first_name || shopifyOrder.shipping_address?.first_name
      );

      // DEBUG: Log what data we have in the webhook
      logger.info('SHOPIFY_WEBHOOK', `[WEBHOOK DATA] Order ${shopifyOrder.id}`, {
        email: !!shopifyOrder.email,
        phone: !!shopifyOrder.phone,
        customer: !!shopifyOrder.customer,
        billing_address: !!shopifyOrder.billing_address,
        shipping_address: !!shopifyOrder.shipping_address,
        hasCompleteData
      });

      let enrichedOrder = shopifyOrder;

      // Si el webhook NO tiene datos completos, fetchear el pedido completo desde Shopify usando GraphQL
      // SKIP PARA CUSTOM APPS: GraphQL falla en planes Basic por restricciones de PII
      const isCustomApp = integration && (integration.api_key || integration.api_secret_key);

      if (!hasCompleteData && integration && !isCustomApp) {
        logger.warn('SHOPIFY_WEBHOOK', `Webhook data incomplete for order ${shopifyOrder.id}. Fetching complete order from Shopify GraphQL API...`);

        const completeOrder = await this.fetchCompleteOrderDataGraphQL(
          shopifyOrder.id.toString(),
          integration.shop_domain,
          integration.access_token
        );

        if (completeOrder) {
          logger.info('SHOPIFY_WEBHOOK', 'Using complete order data from GraphQL API (includes protected PII on Basic plans)');
          enrichedOrder = completeOrder;
        } else {
          logger.warn('SHOPIFY_WEBHOOK', 'Could not fetch complete order from GraphQL API. Using webhook data.');
        }
      } else if (!hasCompleteData && isCustomApp) {
        logger.info('SHOPIFY_WEBHOOK', '[CUSTOM APP] Skipping GraphQL query (Basic plan detected). Using webhook data with addresses.');
      }

      // Enrich customer data from Shopify Customer API if available
      if (integration && enrichedOrder.customer?.id) {
        const fullCustomer = await this.fetchShopifyCustomerDataGraphQL(
          enrichedOrder.customer.id.toString(),
          integration.shop_domain,
          integration.access_token
        );

        if (fullCustomer) {
          logger.info('SHOPIFY_WEBHOOK', `Enriched customer data from Shopify API: ${fullCustomer.email || fullCustomer.phone}`);
          // Merge full customer data into order
          enrichedOrder = {
            ...enrichedOrder,
            customer: fullCustomer,
            email: fullCustomer.email || enrichedOrder.email,
            phone: fullCustomer.phone || enrichedOrder.phone,
            shipping_address: enrichedOrder.shipping_address || fullCustomer.default_address,
            billing_address: enrichedOrder.billing_address || fullCustomer.default_address
          };
        }
      }

      // Fallback: If no customer data available, extract from order addresses (Basic plan workaround)
      if (!enrichedOrder.customer || !enrichedOrder.customer.email) {
        const customerFromAddresses = this.extractCustomerFromOrderAddresses(enrichedOrder);
        if (customerFromAddresses) {
          enrichedOrder.customer = customerFromAddresses;
        }
      }

      const customerId = await this.findOrCreateCustomer(enrichedOrder, storeId);

      // Mapear pedido de Shopify a formato local
      const orderData = this.mapShopifyOrderToLocal(enrichedOrder, storeId, customerId);

      // Insertar pedido en la base de datos
      const { data: newOrder, error: insertError } = await this.supabaseAdmin
        .from('orders')
        .insert(orderData)
        .select('id')
        .single();

      if (insertError) {
        throw new Error(`Error insertando pedido: ${insertError.message}`);
      }

      // Crear line items normalizados con mapeo a productos locales
      await this.createLineItemsForOrder(newOrder.id, storeId, shopifyOrder.line_items);

      // Marcar webhook como procesado
      await this.markWebhookProcessed(shopifyOrder.id.toString(), storeId);

      // Enviar pedido a n8n para confirmación automática
      await this.sendOrderToN8n(newOrder.id, shopifyOrder, storeId);

      return { success: true, order_id: newOrder.id };

    } catch (error: any) {
      logger.error('SHOPIFY_WEBHOOK', 'Error procesando webhook de pedido', error);

      // Registrar error en el evento de webhook
      await this.logWebhookError(
        shopifyOrder.id.toString(),
        storeId,
        error.message
      );

      return {
        success: false,
        error: error.message || 'Error procesando webhook'
      };
    }
  }

  // Procesar webhook de producto actualizado
  async processProductUpdatedWebhook(
    shopifyProduct: any,
    storeId: string,
    integrationId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Registrar evento de webhook
      await this.logWebhookEvent({
        integration_id: integrationId,
        store_id: storeId,
        event_type: 'product',
        shopify_topic: 'products/update',
        shopify_event_id: shopifyProduct.id.toString(),
        payload: shopifyProduct
      });

      // Buscar producto en la base de datos local
      // Use order + limit to handle potential duplicates (take most recent)
      const { data: products, error: fetchError } = await this.supabaseAdmin
        .from('products')
        .select('*')
        .eq('shopify_product_id', shopifyProduct.id.toString())
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (fetchError) {
        throw new Error(`Error buscando producto: ${fetchError.message}`);
      }

      const existingProduct = products && products.length > 0 ? products[0] : null;

      // Log warning if duplicates were found (should not happen with unique constraint)
      if (products && products.length > 1) {
        logger.warn('SHOPIFY_WEBHOOK', `Found ${products.length} duplicate products with shopify_product_id=${shopifyProduct.id} for store_id=${storeId}`);
        logger.warn('SHOPIFY_WEBHOOK', `Using most recent product (created_at=${existingProduct?.created_at})`);
      }

      // Preparar datos del producto actualizados
      const variant = shopifyProduct.variants?.[0] || {};
      const productData = {
        name: shopifyProduct.title,
        description: shopifyProduct.body_html || '',
        sku: variant.sku || '',
        price: parseFloat(variant.price) || 0,
        cost: parseFloat(variant.cost) || 0,
        stock: variant.inventory_quantity || 0,
        category: shopifyProduct.product_type || '',
        image_url: shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || '',
        shopify_variant_id: variant.id?.toString() || null,
        last_synced_at: new Date().toISOString(),
        sync_status: 'synced',
        updated_at: new Date().toISOString()
      };

      if (existingProduct) {
        // Actualizar producto existente
        const { error: updateError } = await this.supabaseAdmin
          .from('products')
          .update(productData)
          .eq('id', existingProduct.id);

        if (updateError) {
          throw new Error(`Error actualizando producto: ${updateError.message}`);
        }

        logger.info('SHOPIFY_WEBHOOK', `Producto ${shopifyProduct.id} actualizado en el dashboard por webhook de Shopify`);
      } else {
        // Crear nuevo producto si no existe (puede ocurrir si el producto se creó en Shopify)
        const { error: insertError } = await this.supabaseAdmin
          .from('products')
          .insert({
            store_id: storeId,
            shopify_product_id: shopifyProduct.id.toString(),
            ...productData
          });

        if (insertError) {
          throw new Error(`Error creando producto: ${insertError.message}`);
        }

        logger.info('SHOPIFY_WEBHOOK', `Producto ${shopifyProduct.id} creado en el dashboard por webhook de Shopify`);
      }

      // Marcar webhook como procesado
      await this.markWebhookProcessed(shopifyProduct.id.toString(), storeId);

      return { success: true };

    } catch (error: any) {
      logger.error('SHOPIFY_WEBHOOK', 'Error procesando actualización de producto', error);

      await this.logWebhookError(
        shopifyProduct.id.toString(),
        storeId,
        error.message
      );

      return {
        success: false,
        error: error.message || 'Error procesando webhook'
      };
    }
  }

  // Procesar webhook de producto eliminado
  async processProductDeletedWebhook(
    productId: number,
    storeId: string,
    integrationId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Registrar evento de webhook
      await this.logWebhookEvent({
        integration_id: integrationId,
        store_id: storeId,
        event_type: 'product',
        shopify_topic: 'products/delete',
        shopify_event_id: productId.toString(),
        payload: { id: productId }
      });

      // Eliminar producto de la base de datos local
      const { error: deleteError } = await this.supabaseAdmin
        .from('products')
        .delete()
        .eq('shopify_product_id', productId.toString())
        .eq('store_id', storeId);

      if (deleteError) {
        throw new Error(`Error eliminando producto: ${deleteError.message}`);
      }

      // Marcar webhook como procesado
      await this.markWebhookProcessed(productId.toString(), storeId);

      logger.info('SHOPIFY_WEBHOOK', `Producto ${productId} eliminado del dashboard por webhook de Shopify`);

      return { success: true };

    } catch (error: any) {
      logger.error('SHOPIFY_WEBHOOK', 'Error procesando eliminación de producto', error);

      await this.logWebhookError(
        productId.toString(),
        storeId,
        error.message
      );

      return {
        success: false,
        error: error.message || 'Error procesando webhook'
      };
    }
  }

  // Procesar webhook de pedido actualizado
  async processOrderUpdatedWebhook(
    shopifyOrder: ShopifyOrder,
    storeId: string,
    integrationId: string,
    integration?: { shop_domain: string; access_token: string; api_key?: string; api_secret_key?: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Registrar evento de webhook
      await this.logWebhookEvent({
        integration_id: integrationId,
        store_id: storeId,
        event_type: 'order',
        shopify_topic: 'orders/updated',
        shopify_event_id: shopifyOrder.id.toString(),
        payload: shopifyOrder
      });

      // Verificar si el webhook tiene datos completos del cliente
      const hasCompleteData = (
        shopifyOrder.email || shopifyOrder.contact_email || shopifyOrder.phone
      ) && (
        shopifyOrder.billing_address?.first_name || shopifyOrder.shipping_address?.first_name
      );

      // DEBUG: Log what data we have in the webhook
      logger.info('SHOPIFY_WEBHOOK', `[WEBHOOK DATA] Order ${shopifyOrder.id}`, {
        email: !!shopifyOrder.email,
        phone: !!shopifyOrder.phone,
        customer: !!shopifyOrder.customer,
        billing_address: !!shopifyOrder.billing_address,
        shipping_address: !!shopifyOrder.shipping_address,
        hasCompleteData
      });

      let enrichedOrder = shopifyOrder;

      // Si el webhook NO tiene datos completos, fetchear el pedido completo desde Shopify usando GraphQL
      // SKIP PARA CUSTOM APPS: GraphQL falla en planes Basic por restricciones de PII
      const isCustomApp = integration && (integration.api_key || integration.api_secret_key);

      if (!hasCompleteData && integration && !isCustomApp) {
        logger.warn('SHOPIFY_WEBHOOK', `Webhook data incomplete for order ${shopifyOrder.id}. Fetching complete order from Shopify GraphQL API...`);

        const completeOrder = await this.fetchCompleteOrderDataGraphQL(
          shopifyOrder.id.toString(),
          integration.shop_domain,
          integration.access_token
        );

        if (completeOrder) {
          logger.info('SHOPIFY_WEBHOOK', 'Using complete order data from GraphQL API (includes protected PII on Basic plans)');
          enrichedOrder = completeOrder;
        } else {
          logger.warn('SHOPIFY_WEBHOOK', 'Could not fetch complete order from GraphQL API. Using webhook data.');
        }
      } else if (!hasCompleteData && isCustomApp) {
        logger.info('SHOPIFY_WEBHOOK', '[CUSTOM APP] Skipping GraphQL query (Basic plan detected). Using webhook data with addresses.');
      }

      // Enrich customer data from Shopify Customer API if available
      if (integration && enrichedOrder.customer?.id) {
        const fullCustomer = await this.fetchShopifyCustomerDataGraphQL(
          enrichedOrder.customer.id.toString(),
          integration.shop_domain,
          integration.access_token
        );

        if (fullCustomer) {
          logger.info('SHOPIFY_WEBHOOK', `Enriched customer data from Shopify API: ${fullCustomer.email || fullCustomer.phone}`);
          // Merge full customer data into order
          enrichedOrder = {
            ...enrichedOrder,
            customer: fullCustomer,
            email: fullCustomer.email || enrichedOrder.email,
            phone: fullCustomer.phone || enrichedOrder.phone,
            shipping_address: enrichedOrder.shipping_address || fullCustomer.default_address,
            billing_address: enrichedOrder.billing_address || fullCustomer.default_address
          };
        }
      }

      // Fallback: If no customer data available, extract from order addresses (Basic plan workaround)
      if (!enrichedOrder.customer || !enrichedOrder.customer.email) {
        const customerFromAddresses = this.extractCustomerFromOrderAddresses(enrichedOrder);
        if (customerFromAddresses) {
          enrichedOrder.customer = customerFromAddresses;
        }
      }

      const customerId = await this.findOrCreateCustomer(enrichedOrder, storeId);

      // Actualizar o crear pedido (UPSERT) - orders/updated puede llegar antes que orders/create
      const orderData = this.mapShopifyOrderToLocal(enrichedOrder, storeId, customerId);

      // Agregar shopify_order_id para el UPSERT
      const fullOrderData = {
        ...orderData,
        shopify_order_id: shopifyOrder.id.toString(),
        store_id: storeId
      };

      const { data: updatedOrder, error: updateError} = await this.supabaseAdmin
        .from('orders')
        .upsert(fullOrderData, {
          onConflict: 'shopify_order_id,store_id',
          ignoreDuplicates: false
        })
        .select('id')
        .single();

      if (updateError) {
        throw new Error(`Error actualizando/creando pedido: ${updateError.message}`);
      }

      // Actualizar line items (reemplaza los existentes)
      if (updatedOrder) {
        await this.createLineItemsForOrder(updatedOrder.id, storeId, shopifyOrder.line_items);
      }

      // Marcar webhook como procesado
      await this.markWebhookProcessed(shopifyOrder.id.toString(), storeId);

      return { success: true };

    } catch (error: any) {
      logger.error('SHOPIFY_WEBHOOK', 'Error procesando actualización de pedido', error);

      await this.logWebhookError(
        shopifyOrder.id.toString(),
        storeId,
        error.message
      );

      return {
        success: false,
        error: error.message || 'Error procesando webhook'
      };
    }
  }

  // Crear line items normalizados para un pedido
  // OPTIMIZED: Batch fetches products in 1 query instead of 3 queries per item
  private async createLineItemsForOrder(
    orderId: string,
    storeId: string,
    lineItems: any[]
  ): Promise<void> {
    try {
      // Delete existing line items for this order (in case of update)
      await this.supabaseAdmin
        .from('order_line_items')
        .delete()
        .eq('order_id', orderId);

      if (lineItems.length === 0) {
        logger.info('SHOPIFY_WEBHOOK', `No line items to create for order ${orderId}`);
        return;
      }

      // Extract unique IDs from all line items for batch query
      const variantIds = [...new Set(
        lineItems
          .map(i => i.variant_id?.toString())
          .filter((id): id is string => !!id)
      )];
      const productIds = [...new Set(
        lineItems
          .map(i => i.product_id?.toString())
          .filter((id): id is string => !!id)
      )];
      const skus = [...new Set(
        lineItems
          .map(i => i.sku?.toUpperCase())
          .filter((sku): sku is string => !!sku)
      )];

      // Build OR conditions for batch query
      const orConditions: string[] = [];
      if (variantIds.length > 0) {
        orConditions.push(`shopify_variant_id.in.(${variantIds.join(',')})`);
      }
      if (productIds.length > 0) {
        orConditions.push(`shopify_product_id.in.(${productIds.join(',')})`);
      }
      if (skus.length > 0) {
        // SKUs need to be quoted for the query
        const quotedSkus = skus.map(sku => `"${sku.replace(/"/g, '\\"')}"`).join(',');
        orConditions.push(`sku.in.(${quotedSkus})`);
      }

      // Batch fetch all potentially matching products in ONE query
      let products: Array<{ id: string; shopify_variant_id: string | null; shopify_product_id: string | null; sku: string | null; image_url: string | null }> = [];

      if (orConditions.length > 0) {
        const { data, error } = await this.supabaseAdmin
          .from('products')
          .select('id, shopify_variant_id, shopify_product_id, sku, image_url')
          .eq('store_id', storeId)
          .or(orConditions.join(','));

        if (error) {
          logger.error('SHOPIFY_WEBHOOK', 'Error batch fetching products', error);
        } else {
          products = data || [];
        }
      }

      // Build Maps for O(1) lookup (priority: variant > product > SKU)
      const byVariant = new Map<string, { id: string; image_url: string | null }>();
      const byProduct = new Map<string, { id: string; image_url: string | null }>();
      const bySku = new Map<string, { id: string; image_url: string | null }>();

      for (const p of products) {
        if (p.shopify_variant_id) {
          byVariant.set(p.shopify_variant_id, { id: p.id, image_url: p.image_url });
        }
        if (p.shopify_product_id) {
          byProduct.set(p.shopify_product_id, { id: p.id, image_url: p.image_url });
        }
        if (p.sku) {
          bySku.set(p.sku.toUpperCase(), { id: p.id, image_url: p.image_url });
        }
      }

      // Build all line items for batch insert
      const lineItemsToInsert = lineItems.map(item => {
        const shopifyProductId = item.product_id?.toString() || null;
        const shopifyVariantId = item.variant_id?.toString() || null;
        const shopifyLineItemId = item.id?.toString() || null;
        const sku = item.sku || '';

        // Find matching product using Maps (O(1) lookup with fallback chain)
        let productId: string | null = null;
        let imageUrl: string | null = null;

        // Priority: variant_id > product_id > SKU
        const matchByVariant = shopifyVariantId ? byVariant.get(shopifyVariantId) : null;
        const matchByProduct = shopifyProductId ? byProduct.get(shopifyProductId) : null;
        const matchBySku = sku ? bySku.get(sku.toUpperCase()) : null;

        const match = matchByVariant || matchByProduct || matchBySku;
        if (match) {
          productId = match.id;
          imageUrl = match.image_url;
        }

        // Log if product not found
        if (!productId && shopifyProductId) {
          logger.warn('SHOPIFY_WEBHOOK',
            `⚠️  Product not found for line item: ` +
            `Shopify Product ID ${shopifyProductId}, Variant ID ${shopifyVariantId}, SKU "${sku}". ` +
            `Consider importing products from Shopify first.`
          );
        }

        // Calculate prices
        const quantity = parseInt(item.quantity, 10) || 1;
        const unitPrice = parseFloat(item.price) || 0;
        const totalPrice = quantity * unitPrice;
        const discountAmount = parseFloat(item.total_discount) || 0;
        const taxAmount = item.tax_lines && item.tax_lines.length > 0
          ? parseFloat(item.tax_lines[0].price) || 0
          : 0;

        return {
          order_id: orderId,
          product_id: productId,
          shopify_product_id: shopifyProductId,
          shopify_variant_id: shopifyVariantId,
          shopify_line_item_id: shopifyLineItemId,
          product_name: item.name || item.title || 'Unknown Product',
          variant_title: item.variant_title || null,
          sku: sku,
          quantity: quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          properties: item.properties || null,
          shopify_data: item,
          image_url: imageUrl
        };
      });

      // Batch insert all line items in ONE query
      const { error: insertError } = await this.supabaseAdmin
        .from('order_line_items')
        .insert(lineItemsToInsert);

      if (insertError) {
        logger.error('SHOPIFY_WEBHOOK', 'Error batch inserting line items', insertError);
        throw new Error(`Error al insertar líneas de pedido: ${insertError.message}`);
      }

      logger.info('SHOPIFY_WEBHOOK', `Created ${lineItems.length} normalized line items for order ${orderId} (optimized batch)`);

    } catch (error: any) {
      logger.error('SHOPIFY_WEBHOOK', 'Error creating line items for order', error);
      throw error;
    }
  }

  // Buscar o crear cliente basándose en el número de teléfono
  private async findOrCreateCustomer(
    shopifyOrder: ShopifyOrder,
    storeId: string
  ): Promise<string | null> {
    try {
      // Extraer información del cliente del pedido
      // IMPORTANTE: Priorizar campos a nivel de ORDER sobre customer object
      // porque Shopify redacta customer object cuando state="disabled" pero
      // siempre incluye contact_email, phone, billing_address, shipping_address a nivel de pedido

      // Buscar email/phone en note_attributes (checkouts personalizados)
      let noteEmail = '';
      let notePhone = '';
      if (shopifyOrder.note_attributes && Array.isArray(shopifyOrder.note_attributes)) {
        const emailAttr = shopifyOrder.note_attributes.find((attr: any) =>
          attr.name?.toLowerCase().includes('email') ||
          attr.name?.toLowerCase().includes('correo')
        );
        const phoneAttr = shopifyOrder.note_attributes.find((attr: any) =>
          attr.name?.toLowerCase().includes('phone') ||
          attr.name?.toLowerCase().includes('telefono') ||
          attr.name?.toLowerCase().includes('teléfono') ||
          attr.name?.toLowerCase().includes('celular')
        );

        if (emailAttr?.value) noteEmail = emailAttr.value.toString();
        if (phoneAttr?.value) notePhone = phoneAttr.value.toString();
      }

      const phone = shopifyOrder.phone ||
                    shopifyOrder.billing_address?.phone ||
                    shopifyOrder.shipping_address?.phone ||
                    notePhone ||
                    shopifyOrder.customer?.phone || '';

      const email = shopifyOrder.contact_email ||
                    shopifyOrder.email ||
                    noteEmail ||
                    shopifyOrder.customer?.email || '';

      // Extraer nombre del tag si no está en las direcciones
      // Algunos checkouts de Shopify ponen el nombre en los tags
      let tagName = '';
      if (shopifyOrder.tags && typeof shopifyOrder.tags === 'string') {
        const tags = shopifyOrder.tags.split(',').map(t => t.trim());
        // Buscar tag que parezca un nombre (tiene espacio o más de 2 palabras)
        const nameTag = tags.find(tag => tag.includes(' ') || tag.length > 3);
        if (nameTag) {
          tagName = nameTag;
        }
      }

      const firstName = shopifyOrder.billing_address?.first_name ||
                       shopifyOrder.shipping_address?.first_name ||
                       shopifyOrder.customer?.first_name ||
                       (tagName ? tagName.split(' ')[0] : '') || '';

      const lastName = shopifyOrder.billing_address?.last_name ||
                      shopifyOrder.shipping_address?.last_name ||
                      shopifyOrder.customer?.last_name ||
                      (tagName ? tagName.split(' ').slice(1).join(' ') : '') || '';

      const shopifyCustomerId = shopifyOrder.customer?.id?.toString() || null;

      // Log para debugging
      logger.info('SHOPIFY_WEBHOOK', `[CUSTOMER DATA] Order ${shopifyOrder.id}`, {
        phone: phone || 'NONE',
        email: email || 'NONE',
        firstName: firstName || 'NONE',
        lastName: lastName || 'NONE',
        shopifyCustomerId: shopifyCustomerId || 'NONE',
        sources: {
          'order.phone': shopifyOrder.phone || 'null',
          'order.contact_email': shopifyOrder.contact_email || 'null',
          'order.email': shopifyOrder.email || 'null',
          'billing_address': shopifyOrder.billing_address ? 'exists' : 'null',
          'shipping_address': shopifyOrder.shipping_address ? 'exists' : 'null',
          'note_attributes': shopifyOrder.note_attributes?.length || 0,
          'tags': shopifyOrder.tags || 'null'
        }
      });

      // Si no hay teléfono ni email, no podemos crear/buscar el cliente
      if (!phone && !email) {
        logger.warn('SHOPIFY_WEBHOOK',`⚠️  Pedido ${shopifyOrder.id} no tiene teléfono ni email. Revisar configuración de checkout de Shopify.`);
        logger.warn('SHOPIFY_WEBHOOK',`   Sugerencia: Settings → Checkout → Require email/phone y shipping address`);
        return null;
      }

      // Usar RPC atómico para prevenir race conditions con webhooks concurrentes
      // El RPC usa advisory lock + FOR UPDATE para garantizar atomicidad
      const { data: customerId, error: rpcError } = await this.supabaseAdmin.rpc(
        'upsert_customer_atomic',
        {
          p_store_id: storeId,
          p_phone: phone || null,
          p_email: email || null,
          p_first_name: firstName || null,
          p_last_name: lastName || null,
          p_shopify_customer_id: shopifyCustomerId,
          p_accepts_marketing: shopifyOrder.customer?.accepts_marketing || false
        }
      );

      if (rpcError) {
        logger.error('SHOPIFY_WEBHOOK', 'Error en upsert_customer_atomic', rpcError);
        return null;
      }

      if (!customerId) {
        logger.error('SHOPIFY_WEBHOOK', 'upsert_customer_atomic retornó null');
        return null;
      }

      logger.info('SHOPIFY_WEBHOOK', `Cliente procesado atómicamente: ${customerId} (${phone || email})`);
      return customerId;

    } catch (error: any) {
      logger.error('SHOPIFY_WEBHOOK', 'Error en findOrCreateCustomer', error);
      return null;
    }
  }

  // Mapear pedido de Shopify a formato local
  private mapShopifyOrderToLocal(shopifyOrder: ShopifyOrder, storeId: string, customerId: string | null = null): any {
    // Extract shipping address fields
    const shippingAddr = shopifyOrder.shipping_address;
    const billingAddr = shopifyOrder.billing_address;

    // Build full address string from shipping address
    let fullAddress = '';
    if (shippingAddr) {
      const parts = [
        shippingAddr.address1,
        shippingAddr.address2
      ].filter(Boolean);
      fullAddress = parts.join(', ');
    }

    // Extract phone numbers
    const primaryPhone = shopifyOrder.phone || shopifyOrder.customer?.phone || shippingAddr?.phone || '';
    const backupPhone = billingAddr?.phone && billingAddr.phone !== primaryPhone ? billingAddr.phone : '';

    // Extract payment gateway information
    const paymentGateway = shopifyOrder.payment_gateway_names?.[0] ||
                          shopifyOrder.gateway ||
                          (shopifyOrder.financial_status === 'pending' ? 'pending' : 'unknown');

    // CRITICAL: Calculate cod_amount based on payment status
    // - If order is PAID in Shopify (paid, authorized) => cod_amount = 0 (nothing to collect)
    // - If order is COD (cash_on_delivery, manual, pending) => cod_amount = total_price
    const totalPrice = parseFloat(shopifyOrder.total_price);
    const financialStatus = shopifyOrder.financial_status?.toLowerCase() || 'pending';
    const isPaidOnline = financialStatus === 'paid' || financialStatus === 'authorized';
    const isCashOnDelivery = paymentGateway === 'cash_on_delivery' ||
                             paymentGateway === 'cod' ||
                             paymentGateway === 'manual' ||
                             financialStatus === 'pending';

    // cod_amount = 0 if already paid online, otherwise full total_price
    const codAmount = isPaidOnline ? 0 : totalPrice;

    logger.info('SHOPIFY_WEBHOOK', `Order ${shopifyOrder.id} payment mapping`, {
      financialStatus,
      paymentGateway,
      isPaidOnline,
      isCashOnDelivery,
      totalPrice,
      codAmount
    });

    return {
      store_id: storeId,
      customer_id: customerId,
      shopify_order_id: shopifyOrder.id.toString(),
      shopify_order_number: shopifyOrder.order_number.toString(),
      shopify_order_name: shopifyOrder.name || `#${shopifyOrder.order_number}`,
      shopify_data: shopifyOrder,
      shopify_raw_json: shopifyOrder,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced',

      // Customer info
      customer_email: shopifyOrder.email || shopifyOrder.customer?.email || '',
      customer_phone: primaryPhone,
      customer_first_name: shopifyOrder.customer?.first_name || billingAddr?.first_name || '',
      customer_last_name: shopifyOrder.customer?.last_name || billingAddr?.last_name || '',

      // Address info (JSONB fields)
      billing_address: billingAddr,
      shipping_address: shippingAddr,

      // Address info (denormalized fields for easier querying)
      customer_address: fullAddress,
      neighborhood: shippingAddr?.neighborhood || shippingAddr?.address2 || '',
      phone_backup: backupPhone,
      delivery_notes: shopifyOrder.note || '',

      // Line items (keep JSONB for backwards compatibility)
      line_items: shopifyOrder.line_items,

      // Pricing
      total_price: totalPrice,
      subtotal_price: parseFloat(shopifyOrder.subtotal_price || shopifyOrder.total_price),
      total_tax: parseFloat(shopifyOrder.total_tax || '0'),
      total_discounts: parseFloat(shopifyOrder.total_discounts || '0'),
      total_shipping: parseFloat(shopifyOrder.total_shipping || '0'),
      currency: shopifyOrder.currency || 'USD',

      // Payment
      payment_gateway: paymentGateway,
      payment_method: this.mapPaymentGatewayToMethod(paymentGateway),
      // CRITICAL: cod_amount - 0 if paid online, total_price if COD
      cod_amount: codAmount,

      // Status
      financial_status: financialStatus,
      fulfillment_status: shopifyOrder.fulfillment_status,
      cancel_reason: shopifyOrder.cancel_reason || null,

      // Metadata
      order_status_url: shopifyOrder.order_status_url,
      tags: shopifyOrder.tags,
      created_at: shopifyOrder.created_at,
      updated_at: shopifyOrder.updated_at || shopifyOrder.created_at,
      processed_at: shopifyOrder.processed_at || shopifyOrder.created_at,
      cancelled_at: shopifyOrder.cancelled_at || null
    };
  }

  // Mapear gateway de Shopify a método de pago local
  private mapPaymentGatewayToMethod(gateway: string): string {
    const gatewayMap: Record<string, string> = {
      'shopify_payments': 'online',
      'manual': 'cash',
      'cash_on_delivery': 'cash_on_delivery',
      'paypal': 'online',
      'stripe': 'online',
      'mercadopago': 'online',
      'pending': 'pending',
      'unknown': 'online'
    };

    return gatewayMap[gateway.toLowerCase()] || 'online';
  }

  // Mapear estado de pedido de Shopify a estado interno
  private mapShopifyOrderStatus(
    financialStatus: string,
    fulfillmentStatus: string | null
  ): string {
    if (fulfillmentStatus === 'fulfilled') return 'delivered';
    if (financialStatus === 'refunded') return 'cancelled';
    if (financialStatus === 'paid' && !fulfillmentStatus) return 'confirmed';
    if (financialStatus === 'paid' && fulfillmentStatus === 'partial') return 'in_transit';
    return 'pending';
  }

  // Enviar pedido a n8n para confirmación automática
  private async sendOrderToN8n(
    orderId: string,
    shopifyOrder: ShopifyOrder,
    storeId: string
  ): Promise<void> {
    if (!this.n8nWebhookUrl) {
      logger.warn('SHOPIFY_WEBHOOK','URL de webhook de n8n no configurada, omitiendo envío');
      return;
    }

    try {
      // Obtener datos completos del pedido de la base de datos
      const { data: order, error } = await this.supabaseAdmin
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (error || !order) {
        throw new Error('No se pudo obtener el pedido de la base de datos');
      }

      // Preparar payload para n8n
      const n8nPayload = {
        order_id: orderId,
        store_id: storeId,
        shopify_order_id: shopifyOrder.id.toString(),
        shopify_order_number: shopifyOrder.order_number,
        customer_name: order.customer,
        customer_email: order.email,
        customer_phone: order.phone,
        total: order.total,
        products: order.product,
        quantity: order.quantity,
        shipping_address: {
          address: order.shipping_address,
          city: order.shipping_city,
          state: order.shipping_state,
          postal_code: order.shipping_postal_code,
          country: order.shipping_country
        },
        order_date: order.date,
        status: order.status,
        notes: order.notes,
        shopify_data: shopifyOrder
      };

      // Crear firma HMAC para autenticación
      const n8nSecret = process.env.N8N_WEBHOOK_SECRET || process.env.N8N_API_KEY || '';
      const signature = crypto
        .createHmac('sha256', n8nSecret)
        .update(JSON.stringify(n8nPayload))
        .digest('hex');

      // Enviar a n8n con autenticación
      const response = await axios.post(this.n8nWebhookUrl, n8nPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.N8N_API_KEY || '',
          'X-Signature': signature,
          'X-Timestamp': new Date().toISOString()
        },
        timeout: 30000
      });

      logger.info('SHOPIFY_WEBHOOK', `Pedido ${orderId} enviado a n8n exitosamente`, { status: response.status });

      // Registrar envío exitoso
      await this.supabaseAdmin
        .from('orders')
        .update({
          n8n_sent: true,
          n8n_sent_at: new Date().toISOString()
        })
        .eq('id', orderId);

    } catch (error: any) {
      logger.error('SHOPIFY_WEBHOOK', 'Error enviando pedido a n8n', error);

      // Registrar error pero no fallar el proceso principal
      await this.supabaseAdmin
        .from('orders')
        .update({
          n8n_error: error.message,
          n8n_retry_count: 0
        })
        .eq('id', orderId);
    }
  }

  // Registrar evento de webhook en la base de datos
  private async logWebhookEvent(eventData: {
    integration_id: string;
    store_id: string;
    event_type: string;
    shopify_topic: string;
    shopify_event_id: string;
    payload: any;
  }): Promise<void> {
    await this.supabaseAdmin
      .from('shopify_webhook_events')
      .insert({
        integration_id: eventData.integration_id,
        store_id: eventData.store_id,
        event_type: eventData.event_type,
        shopify_topic: eventData.shopify_topic,
        shopify_event_id: eventData.shopify_event_id,
        payload: eventData.payload,
        processed: false
      });
  }

  // Marcar webhook como procesado
  private async markWebhookProcessed(shopifyEventId: string, storeId: string): Promise<void> {
    await this.supabaseAdmin
      .from('shopify_webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString()
      })
      .eq('shopify_event_id', shopifyEventId)
      .eq('store_id', storeId);
  }

  // Registrar error en el procesamiento de webhook
  private async logWebhookError(
    shopifyEventId: string,
    storeId: string,
    errorMessage: string
  ): Promise<void> {
    // First, get the current retry_count
    const { data: event } = await this.supabaseAdmin
      .from('shopify_webhook_events')
      .select('retry_count')
      .eq('shopify_event_id', shopifyEventId)
      .eq('store_id', storeId)
      .single();

    const currentRetryCount = event?.retry_count || 0;

    // Update with incremented retry_count
    await this.supabaseAdmin
      .from('shopify_webhook_events')
      .update({
        processing_error: errorMessage,
        retry_count: currentRetryCount + 1
      })
      .eq('shopify_event_id', shopifyEventId)
      .eq('store_id', storeId);
  }

  // Reintentar webhooks fallidos
  async retryFailedWebhooks(maxRetries: number = 3): Promise<void> {
    const { data: failedEvents, error } = await this.supabaseAdmin
      .from('shopify_webhook_events')
      .select('*')
      .eq('processed', false)
      .lt('retry_count', maxRetries)
      .order('created_at', { ascending: true })
      .limit(10);

    if (error || !failedEvents || failedEvents.length === 0) {
      return;
    }

    logger.info('SHOPIFY_WEBHOOK', `Reintentando ${failedEvents.length} webhooks fallidos`);

    for (const event of failedEvents) {
      try {
        if (event.shopify_topic === 'orders/create') {
          await this.processOrderCreatedWebhook(
            event.payload,
            event.store_id,
            event.integration_id
          );
        } else if (event.shopify_topic === 'orders/updated') {
          await this.processOrderUpdatedWebhook(
            event.payload,
            event.store_id,
            event.integration_id
          );
        }
      } catch (error) {
        logger.error('SHOPIFY_WEBHOOK', `Error reintentando webhook ${event.id}`, error);
      }

      // Pausa entre reintentos
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
