# Plan de Rediseño UX - Sección Almacén (Warehouse)

## Resumen Ejecutivo

La sección de Almacén actual tiene problemas fundamentales de UX que hacen el proceso de picking y packing frustrante y poco intuitivo. Este plan propone un rediseño completo enfocado en:

1. **Flujo progresivo sin salidas** - El usuario nunca "sale" de una sesión, avanza naturalmente
2. **Órdenes como protagonistas** - Usar números de orden (#123) como identificador principal, no códigos de sesión
3. **Acción directa** - Un clic para empacar, no dos
4. **Contexto persistente** - Siempre visible qué órdenes se están preparando

---

## Problemas Identificados

### 1. Navegación Fragmentada
- El usuario debe "salir" entre etapas (picking → packing)
- El botón "Atrás" destruye el estado de la sesión
- No hay indicador de progreso global
- Transiciones con recarga completa de datos (2-3 segundos de espera)

### 2. Identificación de Órdenes Deficiente
- Códigos de sesión (PREP-02012025-01) son protagonistas
- Números de orden (#123) relegados a badges pequeños
- Durante el picking, las órdenes individuales "desaparecen" (solo se ve lista agregada de productos)
- El trabajador piensa en órdenes, la UI piensa en sesiones

### 3. Proceso de Empaquetamiento No Intuitivo
- **Dos pasos obligatorios**: 1) Seleccionar producto, 2) Seleccionar orden
- Modelo mental invertido: UI organiza por producto, trabajadores organizan por orden
- No se muestra cuántas unidades de cada producto van a cada orden
- Sin soporte para escaneo de códigos de barras

### 4. Estados Confusos
- Deducción de stock silenciosa (sin feedback)
- No se puede completar parcialmente (si falta un producto, todo se bloquea)
- Sin opción de "no disponible" para productos agotados

---

## Solución Propuesta: Flujo "Order-First"

### Nuevo Modelo Mental

```
ANTES (Session-First):
Sesión → Productos Agregados → Redistribuir a Órdenes

DESPUÉS (Order-First):
Seleccionar Órdenes → Preparar Orden por Orden → Verificar y Completar
```

### Vista General del Nuevo Flujo

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PREPARACIÓN DE PEDIDOS                           │
│  ════════════════════════════════════════════════════════════════════   │
│                                                                         │
│  [1. Seleccionar] ──●── [2. Recolectar] ──○── [3. Empacar] ──○── [4. ✓] │
│                                                                         │
│  Preparando 3 pedidos: #1234 • #1235 • #1236                           │
├─────────────────────────────────────────────────────────────────────────┤
```

---

## Diseño Detallado por Etapa

### ETAPA 1: Selección de Pedidos (Dashboard Mejorado)

#### Cambios Principales:
1. **Cards de pedido más prominentes** con número de orden como título principal
2. **Vista previa de productos** en cada card (sin expandir)
3. **Indicador visual de sesiones activas** - pedidos ya en preparación marcados
4. **Selección múltiple mejorada** con contador flotante

#### Wireframe:
```
┌────────────────────────────────────────────────────────────────────────┐
│  Pedidos Confirmados (12)                    [🔍 Buscar] [⚡ Iniciar]  │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐ │
│  │ ☑ PEDIDO #1234      │  │ ☐ PEDIDO #1235      │  │ ⚠️ PEDIDO #1236 │ │
│  │ ─────────────────── │  │ ─────────────────── │  │ ─────────────── │ │
│  │ María González      │  │ Juan Pérez          │  │ Ana López       │ │
│  │ Asunción            │  │ San Lorenzo         │  │ Luque           │ │
│  │ ─────────────────── │  │ ─────────────────── │  │ ─────────────── │ │
│  │ • Remera Azul (2)   │  │ • Pantalón (1)      │  │ • Zapatos (1)   │ │
│  │ • Gorra (1)         │  │ • Cinturón (1)      │  │ • Medias (3)    │ │
│  │ ─────────────────── │  │ ─────────────────── │  │ ─────────────── │ │
│  │ 3 productos         │  │ 2 productos         │  │ 4 productos     │ │
│  │ ₲ 250.000           │  │ ₲ 180.000           │  │ ₲ 320.000       │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────┘ │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  ✓ 2 pedidos seleccionados          [Iniciar Preparación →]     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

#### Mejoras Específicas:
- **Número de orden gigante** (#1234) como identificador principal
- **Cliente y ubicación** visibles sin expandir
- **Lista de productos resumida** (primeros 3 + "y 2 más")
- **Indicador de alertas** (⚠️) si el pedido tiene notas especiales
- **Barra flotante de selección** que sigue al scroll

---

### ETAPA 2: Recolección (Picking) - Rediseño Completo

#### Concepto: "Lista de Compras por Orden"

En lugar de agregar todos los productos, mostrar una lista organizada **por orden** con todos los productos de esa orden. El trabajador recorre el almacén y marca productos **por orden**, no globalmente.

#### Wireframe:
```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Volver                    RECOLECCIÓN                    Paso 2/4   │
├────────────────────────────────────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░  45% completado            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Vista: [Por Orden ▼]  [Por Producto]  [Por Ubicación]                │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  📦 PEDIDO #1234 - María González                    [Completar] │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │                                                                  │  │
│  │  ☑ Remera Azul XL        SKU: REM-AZU-XL      Pasillo A-3       │  │
│  │    [2 de 2 recolectados]  ████████████████████ ✓                │  │
│  │                                                                  │  │
│  │  ☐ Gorra Negra           SKU: GOR-NEG-U       Pasillo B-1       │  │
│  │    [0 de 1 recolectado]   ░░░░░░░░░░░░░░░░░░░░                  │  │
│  │    [-] 0 [+]  [✓ Listo]  [⚠️ Sin Stock]                         │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  📦 PEDIDO #1235 - Juan Pérez                        [Completar] │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │                                                                  │  │
│  │  ☐ Pantalón Negro M      SKU: PAN-NEG-M       Pasillo C-2       │  │
│  │    [0 de 1 recolectado]   ░░░░░░░░░░░░░░░░░░░░                  │  │
│  │                                                                  │  │
│  │  ☐ Cinturón Cuero        SKU: CIN-CUE-U       Pasillo D-4       │  │
│  │    [0 de 1 recolectado]   ░░░░░░░░░░░░░░░░░░░░                  │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [← Anterior]                                    [Continuar a Empaque →]│
└────────────────────────────────────────────────────────────────────────┘
```

#### Funcionalidades Nuevas:

1. **Vista por Orden (default)** - Cada pedido tiene su sección expandible
2. **Vista por Producto** - Agrupado por producto (modo actual, pero mejorado)
3. **Vista por Ubicación** - Optimizada para recorrido de almacén (agrupa por pasillo)

4. **Controles directos en cada producto**:
   - `[-]` / `[+]` para ajustar cantidad
   - `[✓ Listo]` - Marca como completamente recolectado
   - `[⚠️ Sin Stock]` - Marca como no disponible (con nota obligatoria)

5. **Progreso visible por orden** - Barra de progreso individual
6. **SKU y ubicación** visibles para localización rápida

7. **Botón "Continuar"** siempre visible - No bloquea si hay items sin stock (los marca y permite continuar)

---

### ETAPA 3: Empaquetamiento (Packing) - Rediseño Radical

#### Concepto: "Una Caja a la Vez"

En lugar de la vista dividida actual (productos ← → órdenes), mostrar **una orden a la vez** en pantalla completa. El trabajador completa una caja, luego pasa a la siguiente.

#### Wireframe - Vista Principal:
```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Volver                    EMPAQUE                        Paso 3/4   │
├────────────────────────────────────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  Pedido 1 de 3            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                    ╔══════════════════════════════════╗                │
│                    ║                                  ║                │
│                    ║      📦 PEDIDO #1234             ║                │
│                    ║      María González              ║                │
│                    ║      Av. España 1234, Asunción   ║                │
│                    ║      Tel: 0981-123-456           ║                │
│                    ║                                  ║                │
│                    ╚══════════════════════════════════╝                │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  PRODUCTOS PARA ESTA CAJA                                        │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │                                                                  │  │
│  │  ┌────────────┐  Remera Azul XL                                 │  │
│  │  │   [IMG]    │  Cantidad: 2 unidades            [ ✓ Empacado ] │  │
│  │  └────────────┘  SKU: REM-AZU-XL                                │  │
│  │                                                                  │  │
│  │  ┌────────────┐  Gorra Negra                                    │  │
│  │  │   [IMG]    │  Cantidad: 1 unidad              [ ✓ Empacado ] │  │
│  │  └────────────┘  SKU: GOR-NEG-U                                 │  │
│  │                                                                  │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │  ☑ Todos los productos empacados                                │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐  │
│  │  🏷️ Imprimir      │  │  📝 Agregar Nota  │  │  ⚠️ Reportar      │  │
│  │     Etiqueta      │  │                   │  │     Problema      │  │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘  │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [← Pedido Anterior]        ● ○ ○        [Siguiente Pedido →]         │
│                          1   2   3                                     │
└────────────────────────────────────────────────────────────────────────┘
```

#### Diferencias Clave con Diseño Actual:

| Aspecto | Antes | Después |
|---------|-------|---------|
| Vista | Split-view (productos + órdenes) | Una orden a la vez (full screen) |
| Acción | 2 clics (seleccionar producto → seleccionar orden) | 1 clic (marcar producto como empacado) |
| Contexto | Perdido (no sabías qué orden estabas empacando) | Siempre visible (header con datos del cliente) |
| Navegación | Scroll vertical infinito | Paginación por orden (← →) |
| Etiqueta | Botón escondido en card | Acción prominente |

#### Interacción de Empaque:

```
┌─────────────────────────────────────────────────────────────────┐
│  Remera Azul XL                                                 │
│  ───────────────────────────────────────────────────────────────│
│  Cantidad necesaria: 2                                          │
│                                                                 │
│  Estado: [░░░░░░░░░░] 0 de 2 empacados                         │
│                                                                 │
│  [  -  ]  [  0  ]  [  +  ]      [ ✓ Todo Empacado ]            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- **Clic en [+]** incrementa contador de empacados
- **Clic en [✓ Todo Empacado]** marca la cantidad completa de una vez
- **Clic en [-]** si se equivocó
- **Cuando todos los productos = empacados**, habilita botón "Siguiente Pedido"

---

### ETAPA 4: Verificación y Cierre

#### Nueva Pantalla de Resumen Final:

```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Volver                    VERIFICACIÓN                   Paso 4/4   │
├────────────────────────────────────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100% completado          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                     ✅ PREPARACIÓN COMPLETADA                          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  RESUMEN DE SESIÓN                                               │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │                                                                  │  │
│  │  📦 3 pedidos preparados                                        │  │
│  │  📋 7 productos empacados                                       │  │
│  │  ⏱️ Tiempo total: 12 minutos                                    │  │
│  │                                                                  │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │                                                                  │  │
│  │  ✅ Pedido #1234 - María González     [🏷️ Etiqueta Impresa]     │  │
│  │  ✅ Pedido #1235 - Juan Pérez         [🏷️ Etiqueta Impresa]     │  │
│  │  ⚠️ Pedido #1236 - Ana López          [🏷️ Imprimir Etiqueta]    │  │
│  │     └─ Nota: Faltó 1 unidad de Medias (sin stock)               │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  CAMBIOS DE INVENTARIO                                           │  │
│  │  ────────────────────────────────────────────────────────────────│  │
│  │  • Remera Azul XL: 50 → 48 (-2)                                 │  │
│  │  • Gorra Negra: 25 → 24 (-1)                                    │  │
│  │  • Pantalón Negro M: 30 → 29 (-1)                               │  │
│  │  • Cinturón Cuero: 15 → 14 (-1)                                 │  │
│  │  • Zapatos Casual: 20 → 19 (-1)                                 │  │
│  │  • Medias Pack x3: 40 → 38 (-2) ⚠️ Solo se empacaron 2 de 3    │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  [🖨️ Imprimir Todas las Etiquetas]      [✓ Finalizar y Cerrar Sesión] │
└────────────────────────────────────────────────────────────────────────┘
```

#### Funcionalidades:
1. **Resumen visual** de lo completado
2. **Indicador de problemas** (pedidos con notas/faltantes)
3. **Cambios de inventario transparentes** - El usuario VE qué stock se dedujo
4. **Acción de cierre explícita** - Un botón claro para finalizar

---

## Cambios Técnicos Requeridos

### 1. Nuevo Modelo de Estado (Context API)

```typescript
// src/contexts/WarehouseContext.tsx

interface WarehouseSession {
  id: string;
  code: string;
  orders: OrderInSession[];
  currentStep: 'selection' | 'picking' | 'packing' | 'verification';
  currentOrderIndex: number; // Para packing one-at-a-time
  progress: {
    picking: number; // 0-100
    packing: number; // 0-100
  };
}

interface OrderInSession {
  id: string;
  orderNumber: string; // #1234 - PROTAGONISTA
  customerName: string;
  items: ItemInOrder[];
  pickingComplete: boolean;
  packingComplete: boolean;
  labelPrinted: boolean;
  notes: string[];
}

interface ItemInOrder {
  productId: string;
  productName: string;
  sku: string;
  location: string; // "Pasillo A-3"
  quantityNeeded: number;
  quantityPicked: number;
  quantityPacked: number;
  outOfStock: boolean;
}
```

### 2. Nuevos Endpoints API

```typescript
// api/routes/warehouse.ts - Nuevos endpoints

// Obtener sesión con datos completos por orden
GET /api/warehouse/sessions/:id/full
// Retorna: Session con orders[] y cada order tiene items[]

// Actualizar picking por orden (no global)
PATCH /api/warehouse/sessions/:sessionId/orders/:orderId/picking
// Body: { items: [{ productId, quantityPicked }] }

// Actualizar packing por orden
PATCH /api/warehouse/sessions/:sessionId/orders/:orderId/packing
// Body: { items: [{ productId, quantityPacked }] }

// Marcar producto como sin stock
POST /api/warehouse/sessions/:sessionId/items/:itemId/out-of-stock
// Body: { reason: string }

// Obtener resumen de cierre con cambios de inventario
GET /api/warehouse/sessions/:id/summary
// Retorna: { orders[], inventoryChanges[], totalTime }
```

### 3. Cambios en Base de Datos

```sql
-- Agregar columnas para tracking por orden
ALTER TABLE picking_session_items ADD COLUMN order_id UUID REFERENCES orders(id);
ALTER TABLE picking_session_items ADD COLUMN out_of_stock BOOLEAN DEFAULT false;
ALTER TABLE picking_session_items ADD COLUMN out_of_stock_reason TEXT;

-- Índice para queries por orden
CREATE INDEX idx_picking_items_order ON picking_session_items(order_id);
```

### 4. Componentes Nuevos

```
src/components/warehouse/
├── WarehouseProvider.tsx      # Context provider
├── SessionProgress.tsx        # Barra de progreso global
├── OrderSelector.tsx          # Cards de selección mejorados
├── PickingByOrder.tsx         # Vista de picking por orden
├── PickingByProduct.tsx       # Vista de picking por producto (legacy mejorado)
├── PickingByLocation.tsx      # Vista de picking por ubicación
├── PackingOrderCard.tsx       # Card de empaque full-screen
├── PackingItemRow.tsx         # Fila de producto con controles
├── SessionSummary.tsx         # Pantalla de verificación final
└── InventoryChangesPreview.tsx # Preview de cambios de stock
```

---

## Plan de Implementación

### Fase 1: Fundamentos (Semana 1)
- [ ] Crear `WarehouseContext` con nuevo modelo de estado
- [ ] Implementar endpoint `/sessions/:id/full` con datos completos
- [ ] Crear componente `SessionProgress` (barra de progreso global)
- [ ] Refactorizar navegación para usar steps en lugar de views separadas

### Fase 2: Selección Mejorada (Semana 2)
- [ ] Rediseñar cards de pedidos en dashboard
- [ ] Agregar preview de productos en cards
- [ ] Implementar barra flotante de selección
- [ ] Agregar indicadores de pedidos ya en preparación

### Fase 3: Picking Reimaginado (Semana 3)
- [ ] Implementar vista "Por Orden" (default)
- [ ] Crear controles directos en cada producto (`[-]` `[+]` `[✓]`)
- [ ] Agregar opción "Sin Stock" con nota obligatoria
- [ ] Implementar endpoint de actualización por orden
- [ ] Agregar progreso visible por orden

### Fase 4: Packing One-at-a-Time (Semana 4)
- [ ] Crear vista full-screen de una orden
- [ ] Implementar navegación por paginación (← →)
- [ ] Simplificar empaque a un solo clic
- [ ] Integrar impresión de etiqueta prominente
- [ ] Agregar opción "Reportar Problema"

### Fase 5: Verificación y Cierre (Semana 5)
- [ ] Crear pantalla de resumen final
- [ ] Mostrar cambios de inventario antes de confirmar
- [ ] Agregar indicadores de problemas/notas
- [ ] Implementar "Imprimir Todas las Etiquetas"

### Fase 6: Pulido y Testing (Semana 6)
- [ ] Tests E2E del flujo completo
- [ ] Optimización de rendimiento
- [ ] Feedback de usuarios reales
- [ ] Ajustes finales de UX

---

## Métricas de Éxito

| Métrica | Antes | Objetivo |
|---------|-------|----------|
| Tiempo promedio por sesión | ~15 min | < 8 min |
| Clics para empacar 1 producto | 3-4 | 1 |
| Errores de empaque reportados | ~5% | < 1% |
| Usuarios que abandonan sesión | ~20% | < 5% |
| Satisfacción (NPS warehouse) | - | > 8/10 |

---

## Notas de Diseño

### Principios Guía
1. **El número de orden es el protagonista** - Siempre visible, grande, claro
2. **Progreso siempre visible** - El usuario sabe exactamente dónde está
3. **Un clic = una acción** - Minimizar pasos para cada tarea
4. **Nunca bloquear** - Siempre hay una salida (marcar sin stock, reportar problema)
5. **Feedback inmediato** - Cada acción tiene respuesta visual instantánea

### Consideraciones Mobile/Tablet
- El diseño debe funcionar en tablets (uso común en almacén)
- Botones grandes para uso con guantes
- Alto contraste para ambientes con poca luz
- Soporte futuro para escáner de códigos de barras

---

## Apéndice: Comparativa Visual

### Flujo Actual vs Propuesto

```
ACTUAL:
Dashboard → [Crear Sesión] → Picking (agregado) → [Finalizar] → Packing (split) → [Completar]
     ↑                              ↓                                    ↓
     └──────────── [Back] ──────────┴────────────── [Back] ─────────────┘

PROPUESTO:
[Selección] ──→ [Picking por Orden] ──→ [Packing One-by-One] ──→ [Verificación]
     ●              ○                        ○                       ○
     └──────────────────── Progress Bar ─────────────────────────────┘
```

### Identificación de Órdenes

```
ACTUAL:
┌─────────────────────────────┐
│  Sesión: PREP-02012025-01   │  ← Protagonista (código técnico)
│  ┌───────────────────────┐  │
│  │ #1234  #1235  #1236   │  │  ← Badges pequeños (órdenes reales)
│  └───────────────────────┘  │
└─────────────────────────────┘

PROPUESTO:
┌─────────────────────────────┐
│  📦 PEDIDO #1234            │  ← Protagonista (número de orden)
│  María González             │
│  ─────────────────────────  │
│  Sesión: PREP-02012025-01   │  ← Secundario (referencia técnica)
└─────────────────────────────┘
```

---

*Plan creado: Enero 2026*
*Versión: 1.0*
*Autor: Claude AI + Equipo Ordefy*
