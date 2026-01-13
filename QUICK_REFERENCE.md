# 📋 QUICK REFERENCE - MÉTRICAS ORDEFY

**Imprime esto o guárdalo en tu celular** ☝️

---

## 🚀 EJECUTAR AUDITORÍA (30 minutos)

```bash
# 1. SQL Script (en Supabase SQL Editor)
Copiar: scripts/audit-metrics-complete.sql

# 2. TypeScript Validator
npx ts-node scripts/validate-metrics-integrity.ts --store-id YOUR_ID

# 3. Revisar Dashboard
Analytics → Overview → Validar números
```

---

## ✅ CHECKLIST RÁPIDO (5 minutos)

| Item | Validación | OK |
|------|-----------|-----|
| Delivery Rate | 85-95% | ☐ |
| Gross Margin | > 0% | ☐ |
| Net Margin | > 0% | ☐ |
| Revenue: Real ≤ Projected | Siempre | ☐ |
| Margin: Gross ≥ Net | Siempre | ☐ |
| NULL costs | = 0 | ☐ |
| Test orders | Excluidas | ☐ |
| Deleted orders | Excluidas | ☐ |

---

## 🔢 FÓRMULAS CRÍTICAS

```
REVENUE
  Projected = SUM(all orders.total_price)
  Real = SUM(delivered orders.total_price)

COSTS
  Product = (cost + packaging + additional) × quantity
  Shipping = order.shipping_cost
  Confirmation = confirmation_fee × confirmed_orders
  Advertising = SUM(campaigns.investment)
  Total = Product + Shipping + Confirmation + Advertising

MARGINS
  Gross % = (Revenue - Product Costs) / Revenue × 100
  Net % = (Revenue - ALL Costs) / Revenue × 100

  VALIDACIÓN: Gross ≥ Net (SIEMPRE)

DELIVERY
  Rate % = (Delivered / Dispatched) × 100
  SALUDABLE: 85-95%
  ALERTA: < 70%
```

---

## ⚠️ ALERTAS INMEDIATAS

| Problema | Acción |
|----------|--------|
| Delivery < 50% | 🔴 CRÍTICO - Llamar transportistas |
| Real > Projected | 🔴 CRÍTICO - Reportar a Engineering |
| Net < -50% | 🔴 CRÍTICO - Revisar precios |
| Delivery < 85% | 🟡 WARNING - Seguimiento |
| NULL costs | 🟡 WARNING - Cargar datos |
| Net > Gross | 🔴 CRÍTICO - BUG |

---

## 📚 DOCUMENTOS (Por Rol)

**👔 GERENTE:** METRICS_EXECUTIVE_SUMMARY.md
**👨‍💻 ENGINEER:** METRICS_AUDIT_COMPLETE.md
**⚙️ OPERACIONES:** METRICS_MONITORING_GUIDE.md
**📖 TODOS:** METRICS_README.md

---

## 🛠️ CAMPOS EN BD

```sql
-- Productos
products.cost ≥ 0
products.packaging_cost ≥ 0
products.additional_costs ≥ 0

-- Órdenes
orders.total_price > 0
orders.shipping_cost ≥ 0 o NULL
orders.sleeves_status ∈ [pending, confirmed, ...]
orders.is_test BOOLEAN
orders.deleted_at NULL o TIMESTAMP

-- Config
store_config.confirmation_fee ≥ 0

-- Líneas
order_line_items.product_id UUID (local)
order_line_items.quantity > 0
```

---

## 📞 CONTACTO

- **Metrics Issue:** Abrir tag "metrics" en GitHub
- **Data Corruption:** Contactar DevOps
- **Questions:** Revisar METRICS_README.md

---

**Auditoría Completada:** 2026-01-12
**Próxima Revisión:** 2026-04-12

✅ **100% CONFIANZA EN MÉTRICAS**
