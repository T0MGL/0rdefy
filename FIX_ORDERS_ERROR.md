# Fix: Error al Crear Pedidos Manuales

## Problema
No se pueden crear pedidos manuales. Error: `COALESCE types integer and text cannot be matched`

## Causa
La función `calculate_cod_amount()` en la base de datos tiene un error de tipos de datos:
- Usa `COALESCE(NEW.total_price, 0)` donde `0` es INTEGER
- Pero `total_price` es DECIMAL(10,2)
- PostgreSQL no puede hacer COALESCE entre tipos diferentes

## Solución

### 1. Ejecutar este SQL en Supabase SQL Editor:

```sql
-- ================================================================
-- FIX: COD Amount Type Mismatch
-- ================================================================

CREATE OR REPLACE FUNCTION calculate_cod_amount()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el método de pago es efectivo/cash, el COD amount es igual al total_price
  IF NEW.payment_method IN ('cash', 'efectivo') THEN
    NEW.cod_amount = COALESCE(NEW.total_price, 0.0);
  ELSE
    -- Si no es efectivo, el COD amount es 0
    NEW.cod_amount = 0.0;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2. Reiniciar el servidor de API

```bash
# Detener el servidor actual
lsof -ti:3001 | xargs kill -9

# Iniciar el servidor
npm run api:dev
```

### 3. Probar la creación de pedidos

Ir a la aplicación y crear un pedido manual. Debería funcionar correctamente.

## Cambios Realizados en el Código

1. **api/routes/orders.ts** (línea 704-705):
   - Cambié `total_tax: total_tax || 0` → `total_tax: total_tax ?? 0.0`
   - Cambié `total_shipping: total_shipping || 0` → `total_shipping: total_shipping ?? 0.0`

2. **db/migrations/019_add_cod_amount.sql** (línea 32, 35):
   - Cambié `COALESCE(NEW.total_price, 0)` → `COALESCE(NEW.total_price, 0.0)`
   - Cambié `NEW.cod_amount = 0` → `NEW.cod_amount = 0.0`

3. **Nueva migración**: `db/migrations/024_fix_cod_type_mismatch.sql`
   - Contiene el fix para la función `calculate_cod_amount()`

## Verificación

Después de ejecutar el SQL, probar crear un pedido con estos datos:
- Cliente: Juan Pérez
- Teléfono: +595981234567
- Dirección: Av. Mariscal López 123
- Producto: Cualquier producto
- Cantidad: 1
- Método de pago: Contra Entrega (COD)

Debería crearse sin errores.
