-- Migration 074: Atomic Customer Upsert
-- Fixes race condition in findOrCreateCustomer for concurrent Shopify webhooks
-- Created: 2026-01-16

-- ============================================================================
-- FUNCTION: upsert_customer_atomic
-- Atomically finds or creates a customer, preventing duplicate creation
-- from concurrent webhook calls
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_customer_atomic(
  p_store_id UUID,
  p_phone VARCHAR(50),
  p_email VARCHAR(255) DEFAULT NULL,
  p_first_name VARCHAR(255) DEFAULT NULL,
  p_last_name VARCHAR(255) DEFAULT NULL,
  p_shopify_customer_id VARCHAR(255) DEFAULT NULL,
  p_accepts_marketing BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
  v_customer_id UUID;
  v_lock_key_phone BIGINT;
  v_lock_key_email BIGINT;
BEGIN
  -- Validate: at least phone or email required
  IF (p_phone IS NULL OR p_phone = '') AND (p_email IS NULL OR p_email = '') THEN
    RAISE EXCEPTION 'At least phone or email is required to create/find customer';
  END IF;

  -- Acquire separate advisory locks for phone AND email to prevent race conditions
  -- when different webhooks have partial data (one has phone, other has email)
  -- Lock order: phone first, then email (consistent ordering prevents deadlocks)

  IF p_phone IS NOT NULL AND p_phone != '' THEN
    v_lock_key_phone := hashtext(p_store_id::text || 'phone:' || p_phone);
    PERFORM pg_advisory_xact_lock(v_lock_key_phone);
  END IF;

  IF p_email IS NOT NULL AND p_email != '' THEN
    v_lock_key_email := hashtext(p_store_id::text || 'email:' || p_email);
    PERFORM pg_advisory_xact_lock(v_lock_key_email);
  END IF;

  -- Try to find existing by phone first (most reliable identifier)
  IF p_phone IS NOT NULL AND p_phone != '' THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE store_id = p_store_id AND phone = p_phone
    LIMIT 1
    FOR UPDATE;
  END IF;

  -- If not found by phone, try email
  IF v_customer_id IS NULL AND p_email IS NOT NULL AND p_email != '' THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE store_id = p_store_id AND email = p_email
    LIMIT 1
    FOR UPDATE;
  END IF;

  -- Insert new customer or update existing
  IF v_customer_id IS NULL THEN
    -- Create new customer
    INSERT INTO customers (
      store_id,
      phone,
      email,
      first_name,
      last_name,
      shopify_customer_id,
      accepts_marketing,
      total_orders,
      total_spent,
      created_at,
      updated_at
    )
    VALUES (
      p_store_id,
      NULLIF(p_phone, ''),
      NULLIF(p_email, ''),
      NULLIF(p_first_name, ''),
      NULLIF(p_last_name, ''),
      NULLIF(p_shopify_customer_id, ''),
      p_accepts_marketing,
      0,
      0,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_customer_id;
  ELSE
    -- Update existing customer with new data (only non-null values)
    -- Only update phone/email if they don't conflict with another customer
    UPDATE customers SET
      phone = CASE
        WHEN p_phone IS NOT NULL AND p_phone != '' AND phone IS DISTINCT FROM p_phone
             AND NOT EXISTS (SELECT 1 FROM customers c2 WHERE c2.store_id = p_store_id AND c2.phone = p_phone AND c2.id != v_customer_id)
        THEN p_phone
        ELSE phone
      END,
      email = CASE
        WHEN p_email IS NOT NULL AND p_email != '' AND email IS DISTINCT FROM p_email
             AND NOT EXISTS (SELECT 1 FROM customers c2 WHERE c2.store_id = p_store_id AND c2.email = p_email AND c2.id != v_customer_id)
        THEN p_email
        ELSE email
      END,
      first_name = COALESCE(NULLIF(p_first_name, ''), first_name),
      last_name = COALESCE(NULLIF(p_last_name, ''), last_name),
      shopify_customer_id = COALESCE(NULLIF(p_shopify_customer_id, ''), shopify_customer_id),
      accepts_marketing = COALESCE(p_accepts_marketing, accepts_marketing),
      updated_at = NOW()
    WHERE id = v_customer_id;
  END IF;

  RETURN v_customer_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_customer_atomic IS
  'Atomically finds or creates a customer. Uses advisory lock to prevent race conditions from concurrent Shopify webhooks. Returns customer UUID. (Migration 074)';

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION upsert_customer_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_customer_atomic TO service_role;
