/**
 * Backend Error Response Utilities
 * Provides structured, user-friendly error responses
 */

import { Response } from 'express';

export interface ErrorDetails {
  [key: string]: any;
}

/**
 * Standard error codes that match frontend errorMessages.ts
 */
export const ERROR_CODES = {
  // Stock & Inventory
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  NO_STOCK_TO_DECREASE: 'NO_STOCK_TO_DECREASE',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',

  // Orders
  ORDER_ALREADY_PROCESSED: 'ORDER_ALREADY_PROCESSED',
  ORDER_CANNOT_BE_DELETED: 'ORDER_CANNOT_BE_DELETED',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  ORDER_MISSING_CUSTOMER: 'ORDER_MISSING_CUSTOMER',
  ORDER_MISSING_PRODUCTS: 'ORDER_MISSING_PRODUCTS',

  // Warehouse
  SESSION_ALREADY_COMPLETED: 'SESSION_ALREADY_COMPLETED',
  NO_ORDERS_SELECTED: 'NO_ORDERS_SELECTED',
  ORDERS_NOT_CONFIRMED: 'ORDERS_NOT_CONFIRMED',
  PICKING_INCOMPLETE: 'PICKING_INCOMPLETE',

  // Shopify
  SHOPIFY_NOT_CONNECTED: 'SHOPIFY_NOT_CONNECTED',
  SHOPIFY_IMPORT_IN_PROGRESS: 'SHOPIFY_IMPORT_IN_PROGRESS',
  SHOPIFY_SYNC_FAILED: 'SHOPIFY_SYNC_FAILED',

  // Team & Permissions
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  USER_LIMIT_REACHED: 'USER_LIMIT_REACHED',
  INVALID_INVITATION_TOKEN: 'INVALID_INVITATION_TOKEN',

  // Billing
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  FEATURE_NOT_AVAILABLE: 'FEATURE_NOT_AVAILABLE',
  TRIAL_EXPIRED: 'TRIAL_EXPIRED',

  // Phone Verification
  PHONE_ALREADY_VERIFIED: 'PHONE_ALREADY_VERIFIED',
  PHONE_IN_USE: 'PHONE_IN_USE',
  INVALID_VERIFICATION_CODE: 'INVALID_VERIFICATION_CODE',
  VERIFICATION_CODE_EXPIRED: 'VERIFICATION_CODE_EXPIRED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Returns
  ORDER_NOT_ELIGIBLE_FOR_RETURN: 'ORDER_NOT_ELIGIBLE_FOR_RETURN',
  RETURN_SESSION_EMPTY: 'RETURN_SESSION_EMPTY',

  // Generic validation
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
  INVALID_INPUT: 'INVALID_INPUT',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',

  // Technical
  DATABASE_ERROR: 'DATABASE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SERVER_ERROR: 'SERVER_ERROR',
};

/**
 * Send a structured error response
 */
export function sendError(
  res: Response,
  code: keyof typeof ERROR_CODES,
  details?: ErrorDetails,
  httpStatus = 400
) {
  return res.status(httpStatus).json({
    code,
    details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Helper functions for common error scenarios
 */

export function insufficientStock(
  res: Response,
  productName: string,
  currentStock: number,
  required: number
) {
  return sendError(res, 'INSUFFICIENT_STOCK', {
    productName,
    currentStock,
    required,
  });
}

export function productNotFound(
  res: Response,
  productName?: string,
  productId?: string,
  shopifyProduct = false
) {
  return sendError(res, 'PRODUCT_NOT_FOUND', {
    productName,
    productId,
    shopifyProduct,
  }, 404);
}

export function orderAlreadyProcessed(res: Response, status: string) {
  return sendError(res, 'ORDER_ALREADY_PROCESSED', { status }, 400);
}

export function orderCannotBeDeleted(res: Response, status: string) {
  return sendError(res, 'ORDER_CANNOT_BE_DELETED', { status }, 400);
}

export function invalidStatusTransition(res: Response, from: string, to: string) {
  return sendError(res, 'INVALID_STATUS_TRANSITION', { from, to }, 400);
}

export function orderMissingCustomer(res: Response) {
  return sendError(res, 'ORDER_MISSING_CUSTOMER', {}, 400);
}

export function orderMissingProducts(res: Response) {
  return sendError(res, 'ORDER_MISSING_PRODUCTS', {}, 400);
}

export function sessionAlreadyCompleted(res: Response, sessionCode: string) {
  return sendError(res, 'SESSION_ALREADY_COMPLETED', { sessionCode }, 400);
}

export function noOrdersSelected(res: Response) {
  return sendError(res, 'NO_ORDERS_SELECTED', {}, 400);
}

export function ordersNotConfirmed(res: Response, count: number) {
  return sendError(res, 'ORDERS_NOT_CONFIRMED', { count }, 400);
}

export function pickingIncomplete(res: Response, remaining: number) {
  return sendError(res, 'PICKING_INCOMPLETE', { remaining }, 400);
}

export function shopifyNotConnected(res: Response) {
  return sendError(res, 'SHOPIFY_NOT_CONNECTED', {}, 400);
}

export function shopifyImportInProgress(res: Response) {
  return sendError(res, 'SHOPIFY_IMPORT_IN_PROGRESS', {}, 409);
}

export function shopifySyncFailed(res: Response, productName: string, reason?: string) {
  return sendError(res, 'SHOPIFY_SYNC_FAILED', { productName, reason }, 500);
}

export function permissionDenied(res: Response, role: string, module?: string) {
  return sendError(res, 'PERMISSION_DENIED', { role, module }, 403);
}

export function userLimitReached(res: Response, plan: string, max: number, current: number) {
  return sendError(res, 'USER_LIMIT_REACHED', { plan, max, current }, 403);
}

export function invalidInvitationToken(res: Response) {
  return sendError(res, 'INVALID_INVITATION_TOKEN', {}, 400);
}

export function subscriptionExpired(res: Response) {
  return sendError(res, 'SUBSCRIPTION_EXPIRED', {}, 403);
}

export function featureNotAvailable(res: Response, feature: string, plan: string, requiredPlan: string) {
  return sendError(res, 'FEATURE_NOT_AVAILABLE', { feature, plan, requiredPlan }, 403);
}

export function trialExpired(res: Response) {
  return sendError(res, 'TRIAL_EXPIRED', {}, 403);
}

export function phoneAlreadyVerified(res: Response) {
  return sendError(res, 'PHONE_ALREADY_VERIFIED', {}, 400);
}

export function phoneInUse(res: Response) {
  return sendError(res, 'PHONE_IN_USE', {}, 409);
}

export function invalidVerificationCode(res: Response, attemptsLeft: number) {
  return sendError(res, 'INVALID_VERIFICATION_CODE', { attemptsLeft }, 400);
}

export function verificationCodeExpired(res: Response) {
  return sendError(res, 'VERIFICATION_CODE_EXPIRED', {}, 400);
}

export function rateLimitExceeded(res: Response, waitTime: number) {
  return sendError(res, 'RATE_LIMIT_EXCEEDED', { waitTime }, 429);
}

export function orderNotEligibleForReturn(res: Response, status: string) {
  return sendError(res, 'ORDER_NOT_ELIGIBLE_FOR_RETURN', { status }, 400);
}

export function returnSessionEmpty(res: Response) {
  return sendError(res, 'RETURN_SESSION_EMPTY', {}, 400);
}

export function missingRequiredFields(res: Response, fields: string[]) {
  return sendError(res, 'MISSING_REQUIRED_FIELDS', { fields }, 400);
}

export function invalidInput(res: Response, field?: string, expectedFormat?: string) {
  return sendError(res, 'INVALID_INPUT', { field, expectedFormat }, 400);
}

export function duplicateEntry(res: Response, entity: string, field: string, value: any) {
  return sendError(res, 'DUPLICATE_ENTRY', { entity, field, value }, 409);
}

export function databaseError(res: Response, error?: any) {
  logger.error('BACKEND', 'Database error:', error);
  return sendError(res, 'DATABASE_ERROR', {}, 500);
}

export function serverError(res: Response, error?: any) {
  logger.error('BACKEND', 'Server error:', error);
  return sendError(res, 'SERVER_ERROR', {}, 500);
}
