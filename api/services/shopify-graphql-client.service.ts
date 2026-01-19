// Shopify GraphQL Client Service
// Handles all product operations via GraphQL Admin API
// Replaces deprecated REST API for products and variants

import { logger } from '../utils/logger';
import axios, { AxiosInstance } from 'axios';
import { ShopifyIntegration } from '../types/shopify';

export class ShopifyGraphQLClientService {
  private client: AxiosInstance;
  private integration: ShopifyIntegration;

  constructor(integration: ShopifyIntegration) {
    this.integration = integration;

    const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
    this.client = axios.create({
      baseURL: `https://${integration.shop_domain}/admin/api/${apiVersion}/graphql.json`,
      headers: {
        'X-Shopify-Access-Token': integration.access_token,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  // Execute GraphQL query
  private async query<T = any>(query: string, variables?: any): Promise<T> {
    try {
      const response = await this.client.post('', {
        query,
        variables
      });

      if (response.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } catch (error: any) {
      logger.error('BACKEND', 'GraphQL query failed:', error);
      throw error;
    }
  }

  // Get products with pagination (GraphQL)
  async getProducts(params: {
    first?: number;
    after?: string;
    query?: string;
  } = {}): Promise<{
    products: any[];
    pageInfo: { hasNextPage: boolean; endCursor: string };
  }> {
    const query = `
      query getProducts($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query) {
          edges {
            cursor
            node {
              id
              title
              descriptionHtml
              vendor
              productType
              tags
              status
              createdAt
              updatedAt
              variants(first: 100) {
                edges {
                  node {
                    id
                    sku
                    price
                    inventoryQuantity
                    barcode
                    inventoryItem {
                      id
                    }
                  }
                }
              }
              images(first: 10) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const variables = {
      first: params.first || 50,
      after: params.after,
      query: params.query
    };

    const result = await this.query(query, variables);

    return {
      products: result.products.edges.map((edge: any) => edge.node),
      pageInfo: result.products.pageInfo
    };
  }

  // Get single product by ID (GraphQL)
  async getProduct(productId: string): Promise<any> {
    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          status
          createdAt
          updatedAt
          variants(first: 100) {
            edges {
              node {
                id
                sku
                price
                inventoryQuantity
                barcode
                inventoryItem {
                  id
                }
              }
            }
          }
          images(first: 10) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
        }
      }
    `;

    // Ensure productId has the gid://shopify/Product/ prefix
    const gid = productId.startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${productId}`;

    const result = await this.query(query, { id: gid });
    return result.product;
  }

  // Create product (GraphQL)
  async createProduct(productData: {
    title: string;
    descriptionHtml?: string;
    vendor?: string;
    productType?: string;
    tags?: string[];
    status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
    variants?: Array<{
      price: string;
      sku?: string;
      inventoryQuantities?: Array<{
        availableQuantity: number;
        locationId: string;
      }>;
      barcode?: string;
    }>;
  }): Promise<any> {
    const mutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            descriptionHtml
            vendor
            productType
            tags
            status
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  price
                  inventoryQuantity
                  barcode
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await this.query(mutation, { input: productData });

    if (result.productCreate.userErrors?.length > 0) {
      throw new Error(
        `Product creation failed: ${result.productCreate.userErrors
          .map((e: any) => e.message)
          .join(', ')}`
      );
    }

    return result.productCreate.product;
  }

  // Update product (GraphQL)
  async updateProduct(productId: string, productData: {
    title?: string;
    descriptionHtml?: string;
    vendor?: string;
    productType?: string;
    tags?: string[];
    status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  }): Promise<any> {
    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            descriptionHtml
            vendor
            productType
            tags
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Ensure productId has the gid://shopify/Product/ prefix
    const gid = productId.startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${productId}`;

    const input = {
      id: gid,
      ...productData
    };

    const result = await this.query(mutation, { input });

    if (result.productUpdate.userErrors?.length > 0) {
      throw new Error(
        `Product update failed: ${result.productUpdate.userErrors
          .map((e: any) => e.message)
          .join(', ')}`
      );
    }

    return result.productUpdate.product;
  }

  // Update variant (GraphQL)
  async updateVariant(variantId: string, variantData: {
    price?: string;
    sku?: string;
    barcode?: string;
  }): Promise<any> {
    const mutation = `
      mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
            sku
            price
            barcode
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Ensure variantId has the gid://shopify/ProductVariant/ prefix
    const gid = variantId.startsWith('gid://')
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const input = {
      id: gid,
      ...variantData
    };

    const result = await this.query(mutation, { input });

    if (result.productVariantUpdate.userErrors?.length > 0) {
      throw new Error(
        `Variant update failed: ${result.productVariantUpdate.userErrors
          .map((e: any) => e.message)
          .join(', ')}`
      );
    }

    return result.productVariantUpdate.productVariant;
  }

  // Update inventory (GraphQL)
  async updateInventory(inventoryItemId: string, locationId: string, quantity: number): Promise<any> {
    const mutation = `
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup {
            reason
            changes {
              name
              delta
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Ensure IDs have proper gid:// prefix
    const inventoryItemGid = inventoryItemId.startsWith('gid://')
      ? inventoryItemId
      : `gid://shopify/InventoryItem/${inventoryItemId}`;

    const locationGid = locationId.startsWith('gid://')
      ? locationId
      : `gid://shopify/Location/${locationId}`;

    const input = {
      reason: 'correction',
      name: 'available',
      quantities: [
        {
          inventoryItemId: inventoryItemGid,
          locationId: locationGid,
          quantity
        }
      ]
    };

    const result = await this.query(mutation, { input });

    if (result.inventorySetQuantities.userErrors?.length > 0) {
      throw new Error(
        `Inventory update failed: ${result.inventorySetQuantities.userErrors
          .map((e: any) => e.message)
          .join(', ')}`
      );
    }

    return result.inventorySetQuantities.inventoryAdjustmentGroup;
  }

  // Get locations (needed for inventory updates)
  async getLocations(): Promise<any[]> {
    const query = `
      query getLocations {
        locations(first: 250) {
          edges {
            node {
              id
              name
              isActive
            }
          }
        }
      }
    `;

    const result = await this.query(query);
    return result.locations.edges.map((edge: any) => edge.node);
  }

  // Delete product (GraphQL)
  async deleteProduct(productId: string): Promise<void> {
    const mutation = `
      mutation productDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Ensure productId has the gid://shopify/Product/ prefix
    const gid = productId.startsWith('gid://')
      ? productId
      : `gid://shopify/Product/${productId}`;

    const result = await this.query(mutation, { input: { id: gid } });

    if (result.productDelete.userErrors?.length > 0) {
      throw new Error(
        `Product deletion failed: ${result.productDelete.userErrors
          .map((e: any) => e.message)
          .join(', ')}`
      );
    }
  }

  // Helper: Extract numeric ID from GraphQL GID
  static extractNumericId(gid: string): string {
    const match = gid.match(/\/(\d+)$/);
    return match ? match[1] : gid;
  }

  // Helper: Convert REST ID to GraphQL GID
  static toGid(resourceType: string, id: string): string {
    if (id.startsWith('gid://')) return id;
    return `gid://shopify/${resourceType}/${id}`;
  }

  // Cancel order (GraphQL)
  async cancelOrder(orderId: string, reason?: string, notifyCustomer = false, refund = false): Promise<any> {
    const mutation = `
      mutation orderCancel($orderId: ID!, $notifyCustomer: Boolean, $reason: OrderCancelReason, $refund: Boolean) {
        orderCancel(orderId: $orderId, notifyCustomer: $notifyCustomer, reason: $reason, refund: $refund) {
          orderCancelUserErrors {
            field
            message
          }
          job {
            id
            done
          }
        }
      }
    `;

    // Ensure orderId has the gid://shopify/Order/ prefix
    const gid = orderId.startsWith('gid://')
      ? orderId
      : `gid://shopify/Order/${orderId}`;

    // Map reason to Shopify's OrderCancelReason enum
    const shopifyReason = this.mapCancelReasonToShopify(reason);

    const variables = {
      orderId: gid,
      notifyCustomer,
      reason: shopifyReason,
      refund
    };

    const result = await this.query(mutation, variables);

    if (result.orderCancel.orderCancelUserErrors?.length > 0) {
      throw new Error(
        `Order cancellation failed: ${result.orderCancel.orderCancelUserErrors
          .map((e: any) => e.message)
          .join(', ')}`
      );
    }

    return result.orderCancel.job;
  }

  // Map internal cancel reason to Shopify's OrderCancelReason enum
  private mapCancelReasonToShopify(reason?: string): string | undefined {
    if (!reason) return 'OTHER';

    const reasonMap: Record<string, string> = {
      'customer': 'CUSTOMER',
      'inventory': 'INVENTORY',
      'fraud': 'FRAUD',
      'declined': 'DECLINED',
      'other': 'OTHER',
      'returned': 'OTHER',
      'stock': 'INVENTORY'
    };

    return reasonMap[reason.toLowerCase()] || 'OTHER';
  }
}
