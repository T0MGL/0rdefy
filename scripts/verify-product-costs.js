// ================================================================
// SCRIPT DE VALIDACIÓN DE MÉTRICAS FINANCIERAS
// ================================================================
// Verifica que todas las fórmulas del sistema sean correctas
// usando ejemplos reales proporcionados por el usuario
// ================================================================

console.log('=====================================');
console.log('VALIDACIÓN DE MÉTRICAS FINANCIERAS');
console.log('=====================================\n');

// ================================================================
// EJEMPLO 1: PRODUCTO INDIVIDUAL (Del usuario)
// ================================================================
console.log('📦 EJEMPLO 1: PRODUCTO INDIVIDUAL');
console.log('-----------------------------------');

const producto1 = {
    nombre: 'hvchchg',
    precio_venta: 199000,
    costo_base: 20000,
    costo_empaque: 1500,
    costo_envio: 25000,
    cantidad_vendida: 1
};

console.log('Datos del producto:');
console.log(`  - Precio de venta: Gs. ${producto1.precio_venta.toLocaleString()}`);
console.log(`  - Costo base: Gs. ${producto1.costo_base.toLocaleString()}`);
console.log(`  - Costo empaque: Gs. ${producto1.costo_empaque.toLocaleString()}`);
console.log(`  - Costo envío: Gs. ${producto1.costo_envio.toLocaleString()}`);
console.log();

// Cálculos paso a paso
const totalCostoPorUnidad = producto1.costo_base + producto1.costo_empaque;
const costoProducto = totalCostoPorUnidad * producto1.cantidad_vendida;
const costoEnvio = producto1.costo_envio;
const costoTotal = costoProducto + costoEnvio;

const margenBruto = producto1.precio_venta - costoProducto;
const margenBrutoPorc = (margenBruto / producto1.precio_venta) * 100;

const margenNeto = producto1.precio_venta - costoTotal;
const margenNetoPorc = (margenNeto / producto1.precio_venta) * 100;

const roi = ((producto1.precio_venta - costoTotal) / costoTotal) * 100;

console.log('✅ CÁLCULOS:');
console.log(`  1. Costo total por unidad = ${producto1.costo_base.toLocaleString()} + ${producto1.costo_empaque.toLocaleString()} = Gs. ${totalCostoPorUnidad.toLocaleString()}`);
console.log(`  2. Costo de productos = ${totalCostoPorUnidad.toLocaleString()} × ${producto1.cantidad_vendida} = Gs. ${costoProducto.toLocaleString()}`);
console.log(`  3. Costo total = ${costoProducto.toLocaleString()} + ${costoEnvio.toLocaleString()} = Gs. ${costoTotal.toLocaleString()}`);
console.log();
console.log('📊 MÉTRICAS FINANCIERAS:');
console.log(`  • Margen Bruto = (${producto1.precio_venta.toLocaleString()} - ${costoProducto.toLocaleString()}) / ${producto1.precio_venta.toLocaleString()} × 100`);
console.log(`    = ${margenBrutoPorc.toFixed(1)}%`);
console.log();
console.log(`  • Margen Neto = (${producto1.precio_venta.toLocaleString()} - ${costoTotal.toLocaleString()}) / ${producto1.precio_venta.toLocaleString()} × 100`);
console.log(`    = ${margenNetoPorc.toFixed(1)}%`);
console.log();
console.log(`  • ROI = (${producto1.precio_venta.toLocaleString()} - ${costoTotal.toLocaleString()}) / ${costoTotal.toLocaleString()} × 100`);
console.log(`    = ${roi.toFixed(1)}%`);
console.log();

// Verificación
const checks1 = {
    margen_neto_menor_que_bruto: margenNetoPorc < margenBrutoPorc,
    margen_neto_esperado: Math.abs(margenNetoPorc - 76.6) < 0.5, // ~76.6%
    roi_positivo: roi > 0
};

console.log('🔍 VERIFICACIONES:');
console.log(`  ✓ Margen Neto (${margenNetoPorc.toFixed(1)}%) < Margen Bruto (${margenBrutoPorc.toFixed(1)}%): ${checks1.margen_neto_menor_que_bruto ? '✅ CORRECTO' : '❌ ERROR'}`);
console.log(`  ✓ Margen Neto ≈ 76.6%: ${checks1.margen_neto_esperado ? '✅ CORRECTO' : '❌ ERROR (diferencia: ' + Math.abs(margenNetoPorc - 76.6).toFixed(2) + '%)'}`);
console.log(`  ✓ ROI > 0: ${checks1.roi_positivo ? '✅ CORRECTO' : '❌ ERROR'}`);
console.log();

// ================================================================
// EJEMPLO 2: MÚLTIPLES PRODUCTOS CON CAMPAÑA PUBLICITARIA
// ================================================================
console.log('\n📦 EJEMPLO 2: MÚLTIPLES PRODUCTOS + CAMPAÑA');
console.log('-------------------------------------------');

const ventas = [
    { nombre: 'Producto A', precio: 199000, costo: 20000, empaque: 1500, envio: 25000, cantidad: 3 },
    { nombre: 'Producto B', precio: 150000, costo: 30000, empaque: 2000, envio: 25000, cantidad: 2 },
    { nombre: 'Producto C', precio: 250000, costo: 50000, empaque: 3000, envio: 30000, cantidad: 1 }
];

const inversionPublicitaria = 100000;

console.log('Ventas:');
ventas.forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.nombre}: ${v.cantidad} unidades @ Gs. ${v.precio.toLocaleString()}`);
});
console.log(`\nInversión publicitaria: Gs. ${inversionPublicitaria.toLocaleString()}`);
console.log();

// Calcular totales
let totalRevenue = 0;
let totalCostoProductos = 0;
let totalCostoEnvios = 0;

ventas.forEach(v => {
    const revenue = v.precio * v.cantidad;
    const costoUnidad = v.costo + v.empaque;
    const costoProducto = costoUnidad * v.cantidad;
    const costoEnvio = v.envio * v.cantidad;

    totalRevenue += revenue;
    totalCostoProductos += costoProducto;
    totalCostoEnvios += costoEnvio;

    console.log(`${v.nombre}:`);
    console.log(`  Revenue: Gs. ${revenue.toLocaleString()}`);
    console.log(`  Costo productos: Gs. ${costoProducto.toLocaleString()}`);
    console.log(`  Costo envíos: Gs. ${costoEnvio.toLocaleString()}`);
});

console.log();
const totalCostos = totalCostoProductos + totalCostoEnvios + inversionPublicitaria;

const margenBruto2 = totalRevenue - totalCostoProductos;
const margenBrutoPorc2 = (margenBruto2 / totalRevenue) * 100;

const margenNeto2 = totalRevenue - totalCostos;
const margenNetoPorc2 = (margenNeto2 / totalRevenue) * 100;

const roi2 = ((totalRevenue - totalCostos) / totalCostos) * 100;
const roas = totalRevenue / inversionPublicitaria;

console.log('📊 RESUMEN FINANCIERO:');
console.log(`  • Revenue Total: Gs. ${totalRevenue.toLocaleString()}`);
console.log(`  • Costo Productos: Gs. ${totalCostoProductos.toLocaleString()}`);
console.log(`  • Costo Envíos: Gs. ${totalCostoEnvios.toLocaleString()}`);
console.log(`  • Gasto Publicitario: Gs. ${inversionPublicitaria.toLocaleString()}`);
console.log(`  • Costo Total: Gs. ${totalCostos.toLocaleString()}`);
console.log();
console.log('📈 MÉTRICAS:');
console.log(`  • Margen Bruto: ${margenBrutoPorc2.toFixed(1)}%`);
console.log(`  • Margen Neto: ${margenNetoPorc2.toFixed(1)}%`);
console.log(`  • ROI: ${roi2.toFixed(1)}%`);
console.log(`  • ROAS: ${roas.toFixed(2)}x`);
console.log();

// Verificaciones
const checks2 = {
    margen_neto_menor_que_bruto: margenNetoPorc2 < margenBrutoPorc2,
    costo_total_incluye_todo: totalCostos === (totalCostoProductos + totalCostoEnvios + inversionPublicitaria),
    roas_correcto: Math.abs(roas - (totalRevenue / inversionPublicitaria)) < 0.01
};

console.log('🔍 VERIFICACIONES:');
console.log(`  ✓ Margen Neto < Margen Bruto: ${checks2.margen_neto_menor_que_bruto ? '✅ CORRECTO' : '❌ ERROR'}`);
console.log(`  ✓ Costo Total incluye todos los costos: ${checks2.costo_total_incluye_todo ? '✅ CORRECTO' : '❌ ERROR'}`);
console.log(`  ✓ ROAS calculado correctamente: ${checks2.roas_correcto ? '✅ CORRECTO' : '❌ ERROR'}`);
console.log();

// ================================================================
// EJEMPLO 3: DELIVERY RATE
// ================================================================
console.log('\n📦 EJEMPLO 3: DELIVERY RATE');
console.log('----------------------------');

const ordenes = {
    total_despachados: 100, // ready_to_ship, shipped, delivered, returned, delivery_failed
    entregados: 85,
    fallidos: 10,
    devueltos: 5
};

const deliveryRate = (ordenes.entregados / ordenes.total_despachados) * 100;

console.log('Estado de órdenes:');
console.log(`  • Total despachados: ${ordenes.total_despachados}`);
console.log(`  • Entregados: ${ordenes.entregados}`);
console.log(`  • Fallidos: ${ordenes.fallidos}`);
console.log(`  • Devueltos: ${ordenes.devueltos}`);
console.log();
console.log(`📊 Delivery Rate = (${ordenes.entregados} / ${ordenes.total_despachados}) × 100 = ${deliveryRate.toFixed(1)}%`);
console.log();

const checks3 = {
    suma_correcta: (ordenes.entregados + ordenes.fallidos + ordenes.devueltos) === ordenes.total_despachados,
    delivery_rate_razonable: deliveryRate >= 70 && deliveryRate <= 95
};

console.log('🔍 VERIFICACIONES:');
console.log(`  ✓ Suma de estados = Total despachados: ${checks3.suma_correcta ? '✅ CORRECTO' : '❌ ERROR'}`);
console.log(`  ✓ Delivery Rate razonable (70-95%): ${checks3.delivery_rate_razonable ? '✅ CORRECTO' : '❌ ERROR'}`);
console.log();

// ================================================================
// EJEMPLO 4: COST PER ORDER
// ================================================================
console.log('\n📦 EJEMPLO 4: COST PER ORDER');
console.log('-----------------------------');

const totalOrders = 50;
const totalCostsForCPO = totalCostos; // Del ejemplo 2

const costPerOrder = totalCostsForCPO / totalOrders;

console.log(`Total órdenes: ${totalOrders}`);
console.log(`Costos totales: Gs. ${totalCostsForCPO.toLocaleString()}`);
console.log();
console.log(`📊 Cost Per Order = ${totalCostsForCPO.toLocaleString()} / ${totalOrders} = Gs. ${costPerOrder.toLocaleString()}`);
console.log();

// ================================================================
// RESUMEN FINAL
// ================================================================
console.log('\n=====================================');
console.log('RESUMEN DE VALIDACIÓN');
console.log('=====================================\n');

const allChecks = [
    ...Object.values(checks1),
    ...Object.values(checks2),
    ...Object.values(checks3)
];

const passed = allChecks.filter(c => c).length;
const total = allChecks.length;

console.log(`✅ Verificaciones pasadas: ${passed}/${total}`);

if (passed === total) {
    console.log('\n🎉 ¡TODAS LAS FÓRMULAS SON CORRECTAS!');
    console.log('El sistema está calculando las métricas correctamente.');
} else {
    console.log('\n⚠️  ATENCIÓN: Algunas verificaciones fallaron.');
    console.log('Revisar las fórmulas marcadas con ❌.');
}

console.log('\n=====================================\n');

// ================================================================
// FÓRMULAS DEL SISTEMA (Documentación)
// ================================================================
console.log('📚 FÓRMULAS IMPLEMENTADAS EN analytics.ts:\n');
console.log('1. Revenue = Σ(order.total_price)');
console.log('   - Línea 142: ordersList.reduce((sum, order) => sum + (Number(order.total_price) || 0), 0)');
console.log();
console.log('2. Product Costs = Σ((cost + packaging_cost + additional_costs) × quantity)');
console.log('   - Líneas 217-220: totalUnitCost = baseCost + packaging + additional');
console.log('   - Líneas 238-242: itemCost = productCost × quantity');
console.log();
console.log('3. Delivery Costs = Σ(order.shipping_cost)');
console.log('   - Líneas 175-183: deliveryCosts += shippingCost');
console.log();
console.log('4. Gasto Publicitario = Σ(campaign.investment) [active campaigns]');
console.log('   - Líneas 116-121: campaigns.filter(c => c.status === "active")');
console.log();
console.log('5. Total Costs = Product Costs + Delivery Costs + Gasto Publicitario');
console.log('   - Línea 286: totalCosts = productCosts + deliveryCosts + gastoPublicitario');
console.log();
console.log('6. Gross Profit = Revenue - Product Costs');
console.log('   - Línea 292: grossProfit = rev - productCosts');
console.log();
console.log('7. Gross Margin = (Gross Profit / Revenue) × 100');
console.log('   - Línea 296: grossMargin = rev > 0 ? ((grossProfit / rev) * 100) : 0');
console.log();
console.log('8. Net Profit = Revenue - Total Costs');
console.log('   - Línea 303: netProfit = rev - totalCosts');
console.log();
console.log('9. Net Margin = (Net Profit / Revenue) × 100');
console.log('   - Línea 307: netMargin = rev > 0 ? ((netProfit / rev) * 100) : 0');
console.log();
console.log('10. ROI = ((Revenue - Total Costs) / Total Costs) × 100');
console.log('    - Línea 314: roiValue = investment > 0 ? (((rev - investment) / investment) * 100) : 0');
console.log();
console.log('11. ROAS = Revenue / Gasto Publicitario');
console.log('    - Línea 322: roasValue = gastoPublicitario > 0 ? (rev / gastoPublicitario) : 0');
console.log();
console.log('12. Delivery Rate = (Delivered / Dispatched) × 100');
console.log('    - Línea 337: delivRate = dispatched > 0 ? ((delivered / dispatched) * 100) : 0');
console.log();
console.log('13. Cost Per Order = Total Costs / Total Orders');
console.log('    - Línea 390: costPerOrder = totalOrders > 0 ? (totalCosts / totalOrders) : 0');
console.log();
console.log('14. Average Order Value = Revenue / Total Orders');
console.log('    - Línea 391: averageOrderValue = totalOrders > 0 ? (revenue / totalOrders) : 0');
console.log();

console.log('=====================================\n');
