# Ordefy - Landing Page Content
**Documento para desarrollo de Landing Page estilo Railway/Stripe**

---

## Identidad de Marca

**Nombre:** Ordefy
**Tagline:** "El sistema operativo para tu e-commerce"
**Dominio:** ordefy.io
**Desarrollado por:** Bright Idea

**Propuesta de valor principal:**
> Gestiona pedidos, inventario, warehouse y entregas desde un solo lugar. La plataforma todo-en-uno que escala con tu negocio.

**Propuesta secundaria:**
> Automatiza lo tedioso. Enfócate en vender.

---

## Hero Section

### Headline Principal
**Opción 1:** "Todo tu e-commerce. Una sola plataforma."
**Opción 2:** "De la orden a la entrega, sin fricción."
**Opción 3:** "El backend que tu tienda necesita."

### Subheadline
> Ordefy centraliza pedidos, inventario, warehouse y entregas. Integra Shopify, automatiza stock y liquida couriers en minutos, no horas.

### CTA Principal
- **Botón primario:** "Unirme a la Waitlist" / "Comenzar Gratis"
- **Botón secundario:** "Ver Demo" / "Explorar Features"

### Social Proof (Hero)
- "Usado por +X tiendas en LATAM"
- Logos de integraciones: Shopify, WhatsApp Business, Stripe
- Badge: "Diseñado para LATAM"

---

## Problema / Dolor del Usuario

### Sección "El problema"

**Título:** "Gestionar un e-commerce no debería ser un caos"

**Dolores principales:**
1. **Inventario desactualizado** - "Vendiste lo que no tenías. Otra vez."
2. **Excel interminable** - "3 planillas para saber cuánto te debe el courier"
3. **Picking manual** - "Errores en cada 10 pedidos, clientes molestos"
4. **Shopify desconectado** - "Stock en Shopify no coincide con tu bodega"
5. **Equipo desorganizado** - "¿Quién confirmó ese pedido? Nadie sabe."

**Visual sugerido:** Ilustración de caos vs. orden (split screen)

---

## Features Principales

### Sección "Cómo Ordefy lo resuelve"

---

### 1. Dashboard Inteligente
**Ícono sugerido:** Chart/Analytics
**Título:** "Métricas que importan, en tiempo real"
**Descripción:**
> Visualiza revenue, márgenes, ROI y tasa de entrega al instante. Alertas inteligentes te avisan antes de que los problemas escalen.

**Highlights:**
- Health Score de tu negocio (0-100)
- Alertas proactivas de stock bajo
- Comparación período vs período
- KPIs: Ticket promedio, costo por orden, margen neto

---

### 2. Gestión de Pedidos
**Ícono sugerido:** ShoppingCart/Package
**Título:** "Del pedido a la entrega, sin perderte"
**Descripción:**
> Cada orden fluye por estados claros: pendiente → confirmado → preparación → listo → despachado → entregado. Confirmación automática por WhatsApp.

**Highlights:**
- Estados visuales con colores (kanban-style)
- Confirmación masiva con un click
- Historial completo de cada orden
- Etiquetas térmicas 4x6" con QR de tracking
- Filtros avanzados y búsqueda global

---

### 3. Inventario Automático
**Ícono sugerido:** Boxes/Inventory
**Título:** "Stock que se actualiza solo"
**Descripción:**
> El inventario se decrementa automáticamente cuando el pedido está listo para despachar. Devoluciones restauran stock. Auditoría completa de cada movimiento.

**Highlights:**
- Triggers automáticos de stock
- Log de movimientos (audit trail)
- Protección contra sobre-venta
- Alertas de stock bajo
- Historial por producto

---

### 4. Warehouse (Picking & Packing)
**Ícono sugerido:** Warehouse/Forklift
**Título:** "Picking profesional, sin errores"
**Descripción:**
> Selecciona pedidos confirmados → crea sesión de picking → agrega productos al canasto → empaca por orden. Optimizado para móvil y tablet.

**Highlights:**
- Sesiones batch (procesa 50+ pedidos juntos)
- Códigos automáticos (PREP-12012026-001)
- Vista split: canasto ↔ cajas
- Indicadores visuales de progreso
- Recuperación de sesiones abandonadas
- Touch-optimized para bodega

---

### 5. Mercadería (Ingresos de Stock)
**Ícono sugerido:** TruckLoading/Receiving
**Título:** "Recibe mercadería sin perder unidades"
**Descripción:**
> Crea envíos desde proveedores, recibe parcial o total, y el stock se actualiza automáticamente. Detección de discrepancias incluida.

**Highlights:**
- Referencias automáticas (ISH-YYYYMMDD-XXX)
- Recepción parcial con notas
- Creación inline de productos nuevos
- Delta-based (solo suma la diferencia)
- Auditoría completa de recepciones

---

### 6. Devoluciones (Returns)
**Ícono sugerido:** RotateCcw/Return
**Título:** "Procesa devoluciones en batch"
**Descripción:**
> Selecciona pedidos entregados, evalúa cada item (aceptar/rechazar con razón), y el stock se restaura automáticamente. Control de calidad integrado.

**Highlights:**
- Sesiones batch de devoluciones
- Razones: dañado, defectuoso, incompleto, otro
- Stock se restaura solo para aceptados
- Códigos automáticos (RET-DDMMYYYY-NN)
- Analytics de motivos de devolución

---

### 7. Despacho y Liquidaciones
**Ícono sugerido:** Truck/Delivery
**Título:** "Liquida couriers en minutos"
**Descripción:**
> Crea sesiones de despacho → exporta CSV → el courier entrega → importa resultados → sistema calcula automáticamente cuánto te deben.

**Highlights:**
- Sesiones de despacho batch
- Export/Import CSV (Google Sheets compatible)
- Tarifas por zona configurables
- Cálculo automático: COD - Comisiones = Neto
- Panel de montos pendientes por courier
- Soporte para formato numérico LATAM (25.000)

---

### 8. Integración Shopify
**Ícono sugerido:** Shopify logo / Plug
**Título:** "Shopify sincronizado al 100%"
**Descripción:**
> Importa productos, clientes y pedidos con un click. Sincronización bidireccional: cambias precio en Ordefy → se actualiza en Shopify automáticamente.

**Highlights:**
- Import masivo inicial
- Sync bidireccional de productos
- Webhooks en tiempo real (órdenes nuevas)
- Inventario sincronizado automáticamente
- Mapeo de productos entre sistemas
- Recepción automática de inventario inicial

---

### 9. Equipo y Permisos
**Ícono sugerido:** Users/Team
**Título:** "Tu equipo, cada uno en su rol"
**Descripción:**
> Invita colaboradores con roles específicos: admin, logística, confirmador, contador, inventario. Cada uno ve solo lo que necesita.

**Highlights:**
- 6 roles predefinidos
- 15 módulos × 4 permisos
- Invitaciones por link seguro
- Límites por plan (1 → 3 → 10 → 25 usuarios)
- Auto-login al aceptar invitación

---

### 10. Etiquetas de Envío
**Ícono sugerido:** Printer/Tag
**Título:** "Imprime etiquetas profesionales"
**Descripción:**
> Etiquetas térmicas 4x6" compatibles con impresoras Dymo, Zebra y Brother. QR code para tracking y confirmación de entrega.

**Highlights:**
- Formato 4x6" estándar
- QR con token de entrega
- Impresión batch secuencial
- Tracking de etiquetas impresas
- Info: cliente, productos, courier

---

### 11. Notificaciones Inteligentes
**Ícono sugerido:** Bell/Alert
**Título:** "Nunca más te pierdas algo importante"
**Descripción:**
> Alertas priorizadas por urgencia: crítico (rojo), advertencia (amarillo), info (azul). Click directo al problema. Timezone-aware para LATAM.

**Highlights:**
- Agregación inteligente
- Navegación directa al problema
- Persistencia local
- Auto-refresh cada 5 min
- Respeta tu zona horaria

---

### 12. Verificación WhatsApp
**Ícono sugerido:** Shield/WhatsApp
**Título:** "Una cuenta por persona, sin fraudes"
**Descripción:**
> Verificación de número telefónico vía WhatsApp Business API. Previene cuentas duplicadas y protege tu plataforma.

**Highlights:**
- Código de 6 dígitos
- Expira en 10 minutos
- Rate limiting anti-spam
- Recuperación de cuenta integrada

---

## Planes y Precios

### Sección Pricing

**Título:** "Precios transparentes que escalan contigo"
**Subtítulo:** "Comienza gratis. Crece cuando estés listo."

---

### Plan Free - $0/mes
**Ideal para:** Emprendedores que recién comienzan

**Incluye:**
- 1 usuario
- 50 pedidos/mes
- 100 productos
- Dashboard básico
- Gestión de pedidos
- Gestión de productos
- Gestión de clientes
- 1 tienda

**No incluye:**
- Warehouse
- Devoluciones
- Mercadería
- Integraciones
- Etiquetas de envío
- Equipo

---

### Plan Starter - $29/mes (o $24/mes anual)
**Ideal para:** Tiendas en crecimiento

**Todo en Free, más:**
- 3 usuarios
- 500 pedidos/mes
- 500 productos
- Warehouse (picking & packing)
- Devoluciones
- Mercadería
- Etiquetas de envío
- Importación Shopify (one-way)
- Proveedores y Transportadoras
- **14 días de prueba gratis**

---

### Plan Growth - $79/mes (o $66/mes anual)
**Ideal para:** Operaciones medianas
**Badge:** "Más Popular"

**Todo en Starter, más:**
- 10 usuarios
- 2,000 pedidos/mes
- 2,000 productos
- Sync bidireccional Shopify
- Alertas inteligentes
- Tracking de campañas
- API de lectura
- Despacho y Liquidaciones
- Analytics avanzados
- **14 días de prueba gratis**

---

### Plan Professional - $169/mes (o $142/mes anual)
**Ideal para:** Operaciones grandes y multi-tienda

**Todo en Growth, más:**
- 25 usuarios
- 10,000 pedidos/mes
- Productos ilimitados
- Multi-tienda (3 tiendas)
- Roles personalizados
- API completa (lectura + escritura)
- Webhooks salientes
- Forecasting (predicción)
- Soporte prioritario

---

### Tabla Comparativa de Features por Plan

| Feature | Free | Starter | Growth | Professional |
|---------|------|---------|--------|--------------|
| **Usuarios** | 1 | 3 | 10 | 25 |
| **Pedidos/mes** | 50 | 500 | 2,000 | 10,000 |
| **Productos** | 100 | 500 | 2,000 | Ilimitados |
| **Tiendas** | 1 | 1 | 1 | 3 |
| Dashboard | Básico | Completo | Completo | Completo |
| Pedidos | ✓ | ✓ | ✓ | ✓ |
| Productos | ✓ | ✓ | ✓ | ✓ |
| Clientes | ✓ | ✓ | ✓ | ✓ |
| Warehouse | - | ✓ | ✓ | ✓ |
| Devoluciones | - | ✓ | ✓ | ✓ |
| Mercadería | - | ✓ | ✓ | ✓ |
| Transportadoras | - | ✓ | ✓ | ✓ |
| Etiquetas Envío | - | ✓ | ✓ | ✓ |
| Shopify Import | - | ✓ | ✓ | ✓ |
| Shopify Sync Bidireccional | - | - | ✓ | ✓ |
| Alertas Inteligentes | - | - | ✓ | ✓ |
| Campañas | - | - | ✓ | ✓ |
| Despacho & Liquidaciones | - | - | ✓ | ✓ |
| API Lectura | - | - | ✓ | ✓ |
| API Escritura | - | - | - | ✓ |
| Webhooks | - | - | - | ✓ |
| Multi-tienda | - | - | - | ✓ (3) |
| Forecasting | - | - | - | ✓ |
| Soporte | Email | Email | Chat | Prioritario |

---

### Extras de Pricing

**Trial:**
- 14 días gratis en Starter y Growth
- Requiere tarjeta (no se cobra hasta fin del trial)
- Un solo trial por usuario (cualquier plan)

**Programa de Referidos:**
- Referidor gana $10 de crédito (después de 30 días)
- Referido obtiene 20% de descuento en primer mes
- Sin límite de referidos

**Códigos de Descuento:**
- Porcentaje o monto fijo
- Extensión de trial disponible
- Restricciones por plan y fechas

**Downgrade:**
- Validación automática de uso actual
- Debe reducir usuarios/productos para bajar de plan

**Grace Period:**
- 7 días de gracia si falla el pago
- Auto-downgrade a Free después del período

---

## Secciones Adicionales para Landing

---

### Sección "Diseñado para LATAM"

**Título:** "Hecho para cómo trabajas en Latinoamérica"

**Puntos:**
- Formato de números LATAM (25.000 no 25,000)
- Zonas de envío: Asunción, Central, Interior
- Integración WhatsApp Business (canal #1 en LATAM)
- Liquidación COD (contra entrega) nativa
- Moneda local configurable
- Timezone-aware (respeta tu hora local)
- Idioma español nativo

---

### Sección "Integraciones"

**Título:** "Se conecta con las herramientas que ya usas"

**Integraciones actuales:**
- Shopify (bidireccional)
- WhatsApp Business API
- Stripe (pagos y suscripciones)
- n8n (automatizaciones)
- Google Sheets (export CSV)

**Próximamente:**
- Mercado Libre
- Instagram Shop
- Dropi (dropshipping LATAM)
- WooCommerce
- Tiendanube

---

### Sección "Seguridad"

**Título:** "Tu data está segura"

**Puntos:**
- Autenticación JWT
- Rate limiting en todos los endpoints
- Verificación HMAC en webhooks
- Validación de inputs (SQL injection prevention)
- Protección contra fuerza bruta
- Row Level Security (RLS) en base de datos
- Backup automático en Supabase
- HTTPS en toda la plataforma

---

### Sección "¿Por qué Ordefy?"

**Título:** "Lo que nos hace diferentes"

| Otros sistemas | Ordefy |
|----------------|--------|
| Excel + 5 apps separadas | Todo en un lugar |
| Stock manual | Stock automático |
| Sin warehouse digital | Picking & packing integrado |
| Liquidación manual con courier | Liquidación automática con CSV |
| Cada integración es custom | Shopify nativo |
| Sin roles, todos ven todo | 6 roles predefinidos |
| UX de los 2000s | UI moderna, dark mode |

---

### Sección "Casos de Uso"

**1. Tienda de Ropa Online**
> "Vendemos en Instagram y Shopify. Antes perdíamos pedidos entre planillas. Ahora todo entra automático y el stock se sincroniza solo."

**2. Distribuidora de Cosméticos**
> "Procesamos 200+ pedidos diarios. El warehouse de Ordefy nos redujo errores de picking en un 80%."

**3. Dropshipper**
> "Importo de proveedores y despacho con 3 couriers. La liquidación automática me ahorra 4 horas semanales."

---

### Sección FAQ

**¿Puedo probar antes de pagar?**
> Sí, ofrecemos 14 días gratis en los planes Starter y Growth. Necesitas agregar una tarjeta pero no cobramos hasta que termine el trial.

**¿Qué pasa si supero los límites de mi plan?**
> Te avisamos cuando estés cerca del límite. Puedes subir de plan en cualquier momento sin perder datos.

**¿Funciona con mi tienda Shopify actual?**
> Sí, puedes importar todos tus productos, clientes y pedidos en minutos. La sincronización es bidireccional en planes Growth+.

**¿Puedo usar Ordefy sin Shopify?**
> Absolutamente. Ordefy funciona standalone. Puedes crear pedidos manualmente o integrar por API.

**¿Mis datos están seguros?**
> Usamos Supabase (PostgreSQL) con backups automáticos, encriptación y Row Level Security. Tu data está aislada por tienda.

**¿Hay soporte en español?**
> Sí, toda la plataforma y el soporte están en español. Somos un equipo LATAM.

**¿Qué impresoras de etiquetas soportan?**
> Cualquier impresora térmica que acepte formato 4x6" (Dymo, Zebra, Brother, etc.)

**¿Puedo cambiar de plan cuando quiera?**
> Sí, puedes subir o bajar de plan. Al bajar, validamos que tu uso actual quepa en el nuevo plan.

---

## Screens / Pantallas Principales

Lista de todas las pantallas disponibles en la aplicación:

### Core
1. **Dashboard** - Métricas principales, health score, alertas
2. **Orders** - Lista de pedidos con filtros, estados, acciones masivas
3. **Products** - Catálogo de productos, stock, precios
4. **Customers** - Base de clientes con historial
5. **Suppliers** - Gestión de proveedores

### Operations
6. **Warehouse** - Sesiones de picking y packing
7. **Merchandise** - Ingresos de mercadería
8. **Returns** - Procesamiento de devoluciones
9. **Settlements** - Despacho y liquidación de couriers
10. **Carriers** - Gestión de transportadoras

### Marketing & Analytics
11. **Ads/Campaigns** - Tracking de campañas publicitarias
12. **Analytics** - Reportes y métricas avanzadas
13. **Inventory Movements** - Auditoría de movimientos de stock

### Configuration
14. **Settings** - Configuración de tienda y usuario
15. **Integrations** - Conexión con Shopify y otros
16. **Billing** - Suscripción, pagos, referidos
17. **Team** - Gestión de colaboradores y roles

### Onboarding
18. **Sign Up** - Registro de usuario
19. **Login** - Inicio de sesión
20. **Onboarding** - Setup inicial de tienda
21. **Accept Invitation** - Aceptar invitación de equipo

### Otros
22. **Support** - Centro de ayuda
23. **Referral** - Programa de referidos
24. **Account Recovery** - Recuperación de cuenta

---

## Roadmap Público (Coming Soon)

### Q1 2026
- Dashboard personalizable con widgets
- Modo escaneo mobile (cámara)
- Etiquetas con carriers integrados (Andreani, Correo, etc.)

### Q2 2026
- Integración Mercado Libre
- Instagram Shop sync
- Portal de devoluciones para clientes
- Reportes personalizados con export PDF

### Q3 2026
- Predicción de stock con Machine Learning
- WhatsApp bidireccional (chatbot de tracking)
- Asistente IA (Ordefy Copilot)

### Q4 2026
- Multi-canal unificado
- Marketplace de apps/extensiones
- Modo colaborativo en tiempo real

---

## Copy para Waitlist

### Email de Confirmación
**Subject:** "Estás en la lista de Ordefy"

> ¡Gracias por unirte!
>
> Estás en la waitlist de Ordefy, la plataforma todo-en-uno para gestionar tu e-commerce.
>
> Te avisaremos cuando tu cuenta esté lista. Mientras tanto, responde este email si tienes alguna pregunta.
>
> — El equipo de Ordefy

### Email de Invitación
**Subject:** "Tu cuenta de Ordefy está lista"

> ¡Es tu turno!
>
> Tu cuenta de Ordefy está lista para usar. Comienza tu prueba gratuita de 14 días ahora.
>
> [Botón: Acceder a mi cuenta]
>
> ¿Necesitas ayuda? Responde este email y te asistimos.
>
> — El equipo de Ordefy

---

## Elementos Visuales Sugeridos

### Paleta de Colores
- **Primario:** Azul moderno (#3B82F6)
- **Secundario:** Verde éxito (#22C55E)
- **Acento:** Violeta (#8B5CF6)
- **Background claro:** #FAFAFA
- **Background oscuro:** #0F172A (dark mode)
- **Texto:** #1E293B (light) / #F1F5F9 (dark)

### Tipografía
- **Headlines:** Inter Bold / Geist Bold
- **Body:** Inter Regular
- **Monospace:** JetBrains Mono (para códigos)

### Iconografía
- Lucide Icons (consistente con shadcn/ui)
- Estilo: Outlined, 24px

### Ilustraciones
- Estilo: Flat, moderno, colores de marca
- Escenas: Warehouse, delivery, dashboard, equipo

### Animaciones
- Framer Motion para transiciones suaves
- Micro-interacciones en botones y cards
- Scroll reveal para secciones

---

## Meta Tags / SEO

```html
<title>Ordefy - El sistema operativo para tu e-commerce</title>
<meta name="description" content="Gestiona pedidos, inventario, warehouse y entregas desde un solo lugar. Integra Shopify, automatiza stock y liquida couriers. Diseñado para LATAM.">
<meta name="keywords" content="e-commerce, gestión de pedidos, warehouse, picking, packing, shopify, inventario, delivery, LATAM">

<!-- Open Graph -->
<meta property="og:title" content="Ordefy - Todo tu e-commerce en un solo lugar">
<meta property="og:description" content="La plataforma todo-en-uno para gestionar tu tienda online. Automatiza inventory, warehouse y entregas.">
<meta property="og:image" content="https://ordefy.io/og-image.png">
<meta property="og:url" content="https://ordefy.io">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Ordefy - El backend que tu tienda necesita">
<meta name="twitter:description" content="Gestión de pedidos, inventario y entregas. Integrado con Shopify. Diseñado para LATAM.">
```

---

## Estructura Sugerida de Landing

1. **Hero** - Headline + CTA + Visual de producto
2. **Logos** - "Integra con" (Shopify, WhatsApp, etc.)
3. **Problema** - 3 pain points con visuales
4. **Features** - Grid/Bento de 6-8 features principales
5. **Demo Video** - Embed de demo interactiva
6. **Pricing** - 4 columnas de planes
7. **Testimonials** - 3 casos de uso
8. **FAQ** - Accordeon con preguntas frecuentes
9. **CTA Final** - "Comienza gratis hoy"
10. **Footer** - Links, legal, social

---

**Última actualización:** Enero 2026
**Versión:** 1.0
