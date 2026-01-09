/**
 * Payment Method Utilities
 *
 * Centralized logic for determining payment types and handling
 * COD (Cash on Delivery) vs PREPAID payment methods.
 *
 * IMPORTANT: Keep this in sync with frontend logic in Delivery.tsx
 */

// Payment methods that require cash collection by courier
const COD_PAYMENT_METHODS = [
  'efectivo',
  'cash',
  'contra entrega',
  'cod',
  '' // Empty string defaults to COD for backwards compatibility
];

// Payment methods that are pre-paid (payment already received by store)
const PREPAID_PAYMENT_METHODS = [
  'tarjeta',
  'card',
  'qr',
  'transferencia',
  'transfer',
  'online',
  'paypal',
  'stripe',
  'mercadopago'
];

/**
 * Determines if a payment method is Cash on Delivery (COD)
 *
 * @param paymentMethod - The payment method string from the order
 * @returns true if courier needs to collect cash, false if prepaid
 *
 * @example
 * isCodPayment('efectivo') // true
 * isCodPayment('tarjeta')  // false
 * isCodPayment(null)       // true (defaults to COD)
 */
export function isCodPayment(paymentMethod: string | null | undefined): boolean {
  if (!paymentMethod) {
    // Default to COD if not specified (backwards compatibility)
    return true;
  }

  const normalized = paymentMethod.toLowerCase().trim();
  return COD_PAYMENT_METHODS.includes(normalized);
}

/**
 * Determines if a payment method is prepaid (tarjeta, QR, transfer, etc.)
 *
 * @param paymentMethod - The payment method string from the order
 * @returns true if payment already received by store, false if COD
 */
export function isPrepaidPayment(paymentMethod: string | null | undefined): boolean {
  return !isCodPayment(paymentMethod);
}

/**
 * Normalizes a payment method string for display
 *
 * @param paymentMethod - The payment method string from the order
 * @returns Normalized display string in Spanish
 */
export function normalizePaymentMethod(paymentMethod: string | null | undefined): string {
  if (!paymentMethod) {
    return 'CONTRA ENTREGA';
  }

  const normalized = paymentMethod.toLowerCase().trim();

  if (COD_PAYMENT_METHODS.includes(normalized)) {
    return 'CONTRA ENTREGA';
  }

  switch (normalized) {
    case 'tarjeta':
    case 'card':
      return 'TARJETA';
    case 'qr':
      return 'QR';
    case 'transferencia':
    case 'transfer':
      return 'TRANSFERENCIA';
    case 'online':
      return 'ONLINE';
    case 'paypal':
      return 'PAYPAL';
    case 'stripe':
      return 'STRIPE';
    case 'mercadopago':
      return 'MERCADOPAGO';
    default:
      return paymentMethod.toUpperCase();
  }
}

/**
 * Gets the payment type label for CSV export
 *
 * @param paymentMethod - The payment method string from the order
 * @returns 'COD' or 'PREPAGO'
 */
export function getPaymentTypeLabel(paymentMethod: string | null | undefined): 'COD' | 'PREPAGO' {
  return isCodPayment(paymentMethod) ? 'COD' : 'PREPAGO';
}

/**
 * Calculates the amount that should be collected by courier
 *
 * @param paymentMethod - The payment method string
 * @param totalPrice - The total price of the order
 * @returns The amount courier should collect (0 for prepaid)
 */
export function getAmountToCollect(
  paymentMethod: string | null | undefined,
  totalPrice: number
): number {
  return isCodPayment(paymentMethod) ? totalPrice : 0;
}

/**
 * Validates if amount_collected makes sense for the payment type
 *
 * @param paymentMethod - The payment method string
 * @param amountCollected - The amount reported as collected
 * @returns Object with isValid flag and optional warning message
 */
export function validateAmountCollected(
  paymentMethod: string | null | undefined,
  amountCollected: number | null | undefined
): { isValid: boolean; warning?: string } {
  const isCod = isCodPayment(paymentMethod);

  if (!isCod && amountCollected && amountCollected > 0) {
    return {
      isValid: false,
      warning: `Prepaid order should have amount_collected=0, but got ${amountCollected}`
    };
  }

  return { isValid: true };
}
