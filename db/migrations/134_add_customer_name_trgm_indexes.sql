-- Migration 134: Add pg_trgm GIN indexes for name search on orders and customers tables
-- Orders indexes: accelerate ilike on orders.customer_first_name / customer_last_name
-- Customers indexes: accelerate ilike on customers.first_name / last_name (used in customers search endpoint)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_first_name_trgm
  ON orders USING gin (customer_first_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_last_name_trgm
  ON orders USING gin (customer_last_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_first_name_trgm
  ON customers USING gin (first_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_last_name_trgm
  ON customers USING gin (last_name gin_trgm_ops);
