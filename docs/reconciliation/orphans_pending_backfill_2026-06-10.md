# COD Orphan Orders Pending Backfill

Status: FUERA DE SCOPE Fase 3. PENDIENTE BACKFILL.
COD esperado: ESTIMADO, no confirmado (atribucion por ventana 60s, ver metodo).
Generated: 2026-06-10 (read-only pull, no writes to production).
Companion data: `orphans_pending_backfill_2026-06-10.csv` (176 rows).

## Que es una orden huerfana (definicion exacta usada)

Una orden se marca huerfana si cumple TODAS estas condiciones a la vez:

1. `is_order_cod(payment_method, prepaid_method) = true`. Replica exacta de la
   funcion SQL `is_order_cod` (Migration 159): `prepaid_method IS NULL` y
   `LOWER(payment_method) IN ('cod','cash','cash_on_delivery','contra_entrega',
   'contra entrega','efectivo','')`.
2. `sleeves_status = 'delivered'`.
3. `reconciled_at IS NOT NULL` (la orden fue marcada como conciliada).
4. NO existe fila en la junction `settlement_orders` con `order_id` = esta orden.
5. NO existe ninguna fila en `daily_settlements` del mismo `store_id` cuyo
   `created_at` este dentro de +/- 60 segundos de `reconciled_at` de la orden.

Condiciones 4 y 5 son la heuristica de atribucion orden -> settlement. Si ninguna
empareja la orden con un settlement, la orden quedo conciliada sin liquidacion
asociada: su COD esperado nunca entro al `total_cod_expected` de ningun cierre.

## Metodo de deteccion

- Pull read-only via PostgREST (service-role key, sin escrituras).
- Se trajeron TODAS las ordenes con `reconciled_at IS NOT NULL` de NOCTE
  (`1eeaf2c7-2cd2-4257-8213-d90b1280a19d`) y Solenne
  (`0b3f13f8-d1dc-48a5-a707-27a095c9c545`): 645 ordenes escaneadas.
- Se trajo la junction completa `settlement_orders` (169 filas, todas Solenne;
  NOCTE no tiene ninguna fila en la junction) y `daily_settlements` (44 filas).
- `is_order_cod` y `resolve_cod_expected` se reimplementaron en Node identicos a
  la logica SQL canonica para no depender del Postgres directo (el password de la
  base no estaba disponible en el entorno; el gate read-only se respeto via REST).

## Totales

| Merchant | Huerfanas | COD esperado (estimado, Gs) |
|---|---|---|
| NOCTE    | 56  | 13.404.000 |
| Solenne  | 120 | 23.580.000 |
| TOTAL    | 176 | 36.984.000 |

`cod_expected` por orden = `resolve_cod_expected(cod_amount, total_price)`:
`cod_amount` si `cod_amount > 0`, de lo contrario `total_price`. Es la MISMA
regla que aplica el RPC `process_reconciliation_by_carrier` al sumar COD.

## CORRECCION SOBRE EL CONTEO PREVIO (243 / 112-131)

El conteo no reprodujo. Al re-correr read-only contra la base actual:

- Total de huerfanas: 176, no 243.
- Split: 56 NOCTE / 120 Solenne, no 112 / 131.
- COD esperado combinado: 36.984.000 Gs, que SI coincide casi exacto con el
  "36,9M" reportado antes. El monto reprodujo, el conteo de filas no.

Razon probable de la diferencia: el run de 243 trato la junction
`settlement_orders` como vacia. No lo esta: tiene 169 filas (todas Solenne). Al
medir bajo cuatro definiciones de atribucion:

| Definicion | NOCTE | Solenne | COD total (Gs) |
|---|---|---|---|
| V0 toda COD delivered reconciliada (sin excluir nada) | 151 | 360 | 106.833.000 |
| V1 excluir solo junction | 151 | 198 | 78.203.000 |
| V2 excluir solo ventana 60s | 56 | 120 | 36.984.000 |
| V3 excluir junction Y ventana 60s (canonico, este export) | 56 | 120 | 36.984.000 |

V2 = V3 exactamente: cada orden con fila en la junction tambien cae dentro de una
ventana de 60s, asi que la junction no agrega exclusiones encima de la ventana.
La ventana de 60s es la restriccion que manda. El export usa V3.

## Hallazgo estructural (NOCTE)

La mayoria de las huerfanas NOCTE comparten el MISMO `reconciled_at` exacto
(`2026-04-02T04:21:08.282325`). Es un backfill masivo: se estampo `reconciled_at`
en lote sin crear ningun settlement. Por eso NOCTE tiene 0 filas en la junction y
0 matches de ventana 60s. No es ruido de la heuristica, es el origen real del
descuadre en NOCTE.

## Etiqueta

FUERA DE SCOPE Fase 3. PENDIENTE BACKFILL. COD esperado ESTIMADO: la atribucion
orden -> settlement por ventana de 60s NO esta confirmada hasta poblar la junction
`settlement_orders` hacia atras. El descuadre derivado (~2.9M Gs) es estimacion,
no cifra exacta.
