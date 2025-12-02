# COD Amount Type Fix - Instrucciones

## Problema Identificado

Al intentar crear pedidos manualmente, se produce un error de tipos en PostgreSQL:

```
COALESCE types integer and text cannot be matched
```

Este error ocurre en el trigger `calculate_cod_amount()` que calcula el monto COD (Cash on Delivery) para pedidos.

## Solución

El problema está en que `COALESCE(NEW.total_price, 0)` intenta hacer coalesce de un DECIMAL con un INTEGER. La solución es usar `0.0` en lugar de `0` para que ambos tipos coincidan.

## Aplicar el Fix

### Opción 1: Usando el Panel de Supabase (RECOMENDADO)

1. Accede a tu panel de Supabase: https://ecommerce-software-supabase.aqiebe.easypanel.host
2. Ve a la sección "SQL Editor"
3. Copia y pega el siguiente SQL:

```sql
-- Fix: COD Amount Calculation Type Mismatch
CREATE OR REPLACE FUNCTION calculate_cod_amount()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method IN ('cash', 'efectivo') THEN
        -- Cast to DECIMAL to match total_price type
        NEW.cod_amount = COALESCE(NEW.total_price, 0.0);
    ELSE
        -- Cast to DECIMAL to match cod_amount type
        NEW.cod_amount = 0.0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

4. Click en "Run" para ejecutar el SQL
5. Verifica que la función se haya creado correctamente (debería mostrar "Success")

### Opción 2: Usando la Migración (Alternativa)

Si prefieres usar el archivo de migración:

1. Abre el archivo: `db/migrations/018_fix_cod_amount_type.sql`
2. Copia todo el contenido
3. Pégalo en el SQL Editor de Supabase
4. Ejecuta el SQL

## Verificar el Fix

Después de aplicar el fix, verifica que funciona ejecutando el script de test:

```bash
./test-create-order.sh gaston@thebrightidea.ai rorito28
```

Deberías ver una salida similar a:

```
✅ Order created successfully!
Order ID: [uuid-del-pedido]
```

## Cambios Realizados en el Código

Además del fix de la base de datos, se realizaron los siguientes cambios en el código:

### Backend (`api/routes/orders.ts`)

- ✅ Agregado `courier_id` como parámetro aceptado en POST /api/orders
- ✅ Agregado `customer_address` como parámetro aceptado
- ✅ Agregado `payment_status` y `payment_method` como parámetros aceptados
- ✅ El `courier_id` ahora se guarda correctamente en la base de datos

### Frontend (`src/services/orders.service.ts`)

- ✅ Cambiado el envío de `shipping_address.company` a `courier_id`
- ✅ Agregado `payment_method` al payload (convierte 'cod' → 'cash', 'paid' → 'online')
- ✅ Agregados logs para debugging

## Estado

- [x] Código del backend actualizado
- [x] Código del frontend actualizado
- [x] Migración maestra actualizada (000_MASTER_MIGRATION.sql)
- [x] Migración de fix creada (018_fix_cod_amount_type.sql)
- [ ] **Fix aplicado en base de datos de producción** ← PENDIENTE

## Notas

- El fix es **idempotente**: puede ejecutarse múltiples veces sin problemas
- El fix **NO afecta** a pedidos existentes
- El fix es **retrocompatible**: pedidos antiguos seguirán funcionando
- Una vez aplicado el fix, la creación manual de pedidos debería funcionar correctamente
