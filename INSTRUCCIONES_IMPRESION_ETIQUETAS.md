# Instrucciones de Impresión de Etiquetas 4x6

**Última Actualización:** Enero 2, 2026

## Configuración de Impresora

### Impresoras Térmicas Compatibles
- ✅ Zebra ZD420, ZD620
- ✅ Dymo LabelWriter 4XL
- ✅ Brother QL-1110NWB
- ✅ Rollo Primera LX500
- ✅ Cualquier impresora térmica 4x6"

### Configuración del Sistema

#### Windows 10/11

1. **Instalar Driver de Impresora**
   - Descargar driver del fabricante
   - Instalar y reiniciar

2. **Configurar Tamaño de Papel**
   - Panel de Control → Dispositivos e impresoras
   - Clic derecho en tu impresora → Preferencias de impresión
   - Tamaño de papel: **4 x 6 inches (102 x 152 mm)**
   - Orientación: **Portrait (Vertical)**
   - Márgenes: **0mm todos los lados**

3. **Opciones Avanzadas**
   - Calidad: Alta
   - Densidad: 100%
   - Modo de color: Monocromático
   - Deshabilitar: "Ajustar al tamaño de página"

#### macOS

1. **Agregar Impresora**
   - Preferencias del Sistema → Impresoras y Escáneres
   - Agregar impresora térmica

2. **Configurar Tamaño Personalizado**
   - Imprimir → Tamaño de papel
   - Administrar tamaños personalizados
   - Nuevo: `Etiqueta 4x6`
     - Ancho: **4 inches (101.6 mm)**
     - Alto: **6 inches (152.4 mm)**
     - Márgenes: **0mm todos**

3. **Opciones de Impresión**
   - Escala: 100%
   - Auto-rotar: Desactivado
   - Ajustar al papel: Desactivado

#### Linux (CUPS)

```bash
# 1. Instalar CUPS
sudo apt-get install cups

# 2. Agregar impresora
sudo lpadmin -p ThermalLabel -E -v usb://YourPrinter

# 3. Configurar tamaño de papel
lpoptions -p ThermalLabel -o media=Custom.4x6in
lpoptions -p ThermalLabel -o fit-to-page=false
lpoptions -p ThermalLabel -o orientation-requested=3

# 4. Verificar configuración
lpoptions -p ThermalLabel -l
```

---

## Configuración del Navegador

### Google Chrome / Edge (Chromium)

1. **Al hacer clic en "Imprimir (4x6)":**
   - Destino: Seleccionar tu impresora térmica
   - Tamaño de papel: **4 x 6 inches** (o "Etiqueta 4x6" si creaste personalizado)
   - Orientación: Portrait
   - Márgenes: **Ninguno**
   - Escala: **100%** (MUY IMPORTANTE)
   - Opciones avanzadas:
     - ✅ Gráficos de fondo
     - ✅ Imprimir colores de fondo
     - ❌ Encabezados y pies de página

2. **Guardar Configuración**
   - Después de configurar correctamente, Chrome recordará para próximas impresiones

### Firefox

1. **Diálogo de Impresión:**
   - Destino: Tu impresora térmica
   - Tamaño de papel: 4 x 6 inches
   - Orientación: Portrait
   - Escala: 100%
   - Márgenes: Ninguno
   - ✅ Imprimir fondos
   - ❌ Encabezados y pies

### Safari (macOS)

1. **Imprimir:**
   - Impresora: Tu impresora térmica
   - Tamaño de papel: Etiqueta 4x6 (personalizado)
   - Orientación: Portrait
   - Safari → Imprimir fondos ✅
   - Escala: 100%

---

## Solución de Problemas Comunes

### ❌ Problema: La etiqueta se imprime escalada (muy pequeña o muy grande)

**Solución:**
```
1. Verificar en opciones de impresión:
   - Escala: 100% (no "Ajustar a página")
   - "Fit to page": Desactivado

2. En Chrome:
   - Más configuraciones → Escala → 100%
   - Quitar ✓ de "Ajustar al tamaño de página"
```

---

### ❌ Problema: Se crean múltiples páginas en blanco

**Solución:**
```
1. Verificar configuración CSS (ya implementado):
   - @page { size: 4in 6in; margin: 0; }
   - page-break-after: always

2. En opciones de impresión:
   - Márgenes: Ninguno / 0mm
   - Páginas: Solo imprimir página 1
```

---

### ❌ Problema: La etiqueta no está centrada en el papel

**Solución:**
```
1. Verificar que el tamaño de papel sea EXACTAMENTE 4x6:
   - No usar "Letter" o "A4"
   - Crear tamaño personalizado si no existe

2. CSS ya está configurado con:
   - position: absolute
   - top: 0
   - left: 0
   - Esto fuerza la etiqueta al borde superior izquierdo
```

---

### ❌ Problema: Los colores no se imprimen (QR muy claro)

**Solución:**
```
1. Activar impresión de fondos:
   - Chrome: Opciones → Gráficos de fondo ✅
   - Firefox: Imprimir fondos ✅

2. CSS ya incluye:
   - -webkit-print-color-adjust: exact
   - print-color-adjust: exact
```

---

### ❌ Problema: El QR no escanea correctamente

**Solución:**
```
1. Verificar densidad de impresión:
   - Configuración de impresora → Densidad: 100%
   - Calidad: Alta / Best

2. El QR se genera con:
   - Error correction: Medium
   - Width: 400px (alta resolución)
   - image-rendering: pixelated (bordes nítidos)
```

---

### ❌ Problema: Texto cortado en los bordes

**Solución:**
```
1. Verificar márgenes de impresora:
   - Panel de Control → Propiedades de impresora
   - Márgenes: 0mm todos los lados

2. Algunos modelos de impresora tienen margen mínimo:
   - Zebra: 0mm (sin margen)
   - Dymo: ~2mm (margen mínimo)
   - Brother: ~3mm (margen mínimo)

3. Si tu impresora tiene margen mínimo:
   - Ajustar padding en CSS (contactar soporte)
```

---

## Impresión de Prueba

### Test de Configuración

1. **Imprimir Etiqueta de Prueba:**
   - Crear pedido de prueba
   - Generar etiqueta
   - Verificar preview en pantalla (384px x 576px)
   - Imprimir con configuración descrita arriba

2. **Validar Resultado:**
   - ✅ QR escanea correctamente
   - ✅ Texto legible sin cortes
   - ✅ Bordes negros nítidos
   - ✅ Una sola página (sin hojas en blanco)
   - ✅ Centrada en etiqueta 4x6

---

## Configuración Avanzada (Opcional)

### Script de Auto-impresión (Chrome)

Si quieres que Chrome siempre use la configuración correcta:

```javascript
// 1. Instalar extensión "Print Edit WE"
// 2. Crear regla personalizada:
{
  "matches": ["*://ordefy.io/*"],
  "pageSettings": {
    "paperSize": { "width": 4, "height": 6, "unit": "in" },
    "margins": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
    "scale": 100,
    "backgroundGraphics": true
  }
}
```

---

### Crear Acceso Directo de Impresión

**Windows:**
```batch
@echo off
start chrome --kiosk-printing "https://ordefy.io/orders"
```

**macOS:**
```bash
#!/bin/bash
open -a "Google Chrome" --args --kiosk-printing "https://ordefy.io/orders"
```

---

## Especificaciones Técnicas

### Dimensiones de Etiqueta
- **Tamaño físico:** 4" × 6" (101.6mm × 152.4mm)
- **Resolución digital:** 384px × 576px (96 DPI)
- **Conversión:** 1 inch = 96 pixels = 25.4mm

### Zonas de la Etiqueta
```
┌─────────────────────────────────────┐
│ ZONE A: Header (10% = 57.6px)      │ ← Store name + Order #
├─────────────────────────────────────┤
│                                      │
│ ZONE B: Address (35% = 201.6px)    │ ← Customer info
│                                      │
├─────────────────────────────────────┤
│ ZONE C: QR + Action (30% = 172.8px)│ ← QR code + COD/Paid
├─────────────────────────────────────┤
│ ZONE D: Packing List (25% = 144px) │ ← Product list
└─────────────────────────────────────┘
```

### Archivo CSS Relevante
- **Archivo:** `src/components/printing/UniversalLabel.tsx`
- **Líneas:** 346-395 (Print Media Query)

---

## Checklist Pre-Impresión

Antes de cada sesión de impresión:

- [ ] Impresora térmica conectada y encendida
- [ ] Driver instalado correctamente
- [ ] Rollo de etiquetas 4x6 cargado
- [ ] Tamaño de papel configurado (4 x 6 inches)
- [ ] Márgenes: 0mm
- [ ] Escala: 100%
- [ ] Gráficos de fondo: Activado
- [ ] Densidad de impresión: 100%

---

## Contacto de Soporte

Si después de seguir esta guía aún tienes problemas:

1. **Captura de pantalla:**
   - Diálogo de impresión (configuración)
   - Etiqueta impresa (foto)

2. **Información de sistema:**
   - Sistema operativo + versión
   - Navegador + versión
   - Modelo de impresora

3. **Enviar a:** soporte@ordefy.io

---

**Desarrollado por:** Bright Idea
**Versión:** 1.0
**Fecha:** Enero 2, 2026
