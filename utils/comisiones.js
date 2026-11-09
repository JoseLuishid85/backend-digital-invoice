const { fechaHoy } = require('./valores');
const {
    aMonto,
    aMontoOpcional,
    redondear,
    sumar,
    mismoId,
    aTexto,
    productoDeLinea,
} = require('./cartera');

// Bonificación por cuota de ventas (reemplaza la comisión por cobranza; los meses cerrados con ella no cambian):
// - Cada producto tiene una cuota_mensual (unidades) y un valor_representativo (%), iguales para todos los
//   vendedores (columnas de la hoja Productos). Un producto sin cuota no bonifica.
// - Unidades vendidas = las de las ventas (facturas emitidas) del vendedor con fecha_venta en el mes. No cuentan
//   los pedidos sin facturar ni importa si ya se cobraron.
// - cumplimiento = unidades / cuota. Bajo PISO (70 %) ese producto no bonifica; desde ahí se toma el % real,
//   con un tope de TOPE (120 %).
// - bonificación del producto = % aplicado × (sueldo base × valor representativo). Ej.: sueldo 520 $, valor 40 %,
//   1260 de 1800 unidades (70 %) → 0,70 × (520 × 0,40) = 166,40 $. Con 3000 unidades (166,67 %) se toma 120 %.
// - El vendedor cobra su sueldo base (hoja Metas, por mes) más la suma de las bonificaciones de sus productos.
const PISO_BONIFICACION = 70;
const TOPE_BONIFICACION = 120;

// Columnas de la hoja Productos con la cuota (unidades) y el valor representativo (%)
const COLUMNAS_CUOTA = ['cuota_mensual', 'valor_representativo'];

// Estados de una liquidación en la hoja Comisiones (un mes sin fila está abierto: se calcula al consultarlo)
const ESTADOS_COMISION = { abierta: 'abierta', cerrada: 'cerrada', pagada: 'pagada' };

// Periodo YYYY-MM válido o null. Acepta también una fecha YYYY-MM-DD (se queda con el mes).
const aPeriodo = (valor) => {
    const texto = aTexto(valor).slice(0, 7);
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(texto) ? texto : null;
};

const periodoActual = () => fechaHoy().slice(0, 7);

// Sueldo vigente del vendedor en el periodo (hoja Metas): la fila de ese mes o, si no tiene, la más reciente
// anterior. null si no hay.
const metaVigente = (metas, idVendedor, periodo) => metas
    .filter((m) => mismoId(m.id_vendedor, idVendedor) && aPeriodo(m.periodo) && aPeriodo(m.periodo) <= periodo)
    .sort((a, b) => aPeriodo(b.periodo).localeCompare(aPeriodo(a.periodo)))[0] ?? null;

// Cuota y valor representativo de un producto del catálogo (null si no los tiene)
const cuotaDe = (producto) => ({
    cuota_mensual: aMontoOpcional(producto?.cuota_mensual),
    valor_representativo: aMontoOpcional(producto?.valor_representativo),
});

// % de cumplimiento que se paga: 0 bajo el piso, el real hasta el tope y el tope por encima
const porcentajeAplicado = (cumplimiento) => {
    if (cumplimiento < PISO_BONIFICACION) return 0;
    return Math.min(cumplimiento, TOPE_BONIFICACION);
};

// Bonificación de un producto. cumplimiento en % con 2 decimales.
const bonificacionProducto = ({ cuota, unidades, valor, sueldo }) => {
    if (!cuota || cuota <= 0) {
        return { cumplimiento: null, porcentaje_aplicado: 0, bonificacion: 0, unidades_piso: null, unidades_tope: null };
    }
    const cumplimiento = redondear((unidades / cuota) * 100);
    const aplicado = porcentajeAplicado(cumplimiento);
    return {
        cumplimiento,
        porcentaje_aplicado: aplicado,
        bonificacion: redondear((aplicado / 100) * sueldo * ((valor ?? 0) / 100)),
        // Unidades para empezar a bonificar y a partir de las que ya no suma más
        unidades_piso: Math.ceil((cuota * PISO_BONIFICACION) / 100),
        unidades_tope: Math.ceil((cuota * TOPE_BONIFICACION) / 100),
    };
};

// Unidades vendidas por producto: ventas del vendedor con fecha_venta en el periodo. Map id → { id_producto,
// producto, unidades, ventas }. Las líneas cuyo producto ya no existe se agrupan por nombre.
const unidadesPorProducto = (idVendedor, periodo, ventas, detalles, catalogo) => {
    const delMes = ventas.filter((v) => mismoId(v.id_vendedor, idVendedor) && aPeriodo(v.fecha_venta) === periodo
        && aTexto(v.estado_entrega).toLowerCase() !== 'anulada');
    const porProducto = new Map();
    for (const venta of delMes) {
        for (const linea of detalles.filter((d) => mismoId(d.id_venta, venta.id_venta))) {
            const producto = productoDeLinea(catalogo, linea);
            const clave = producto ? `ID:${aTexto(producto.id_producto).toUpperCase()}` : `N:${aTexto(linea.producto).toLowerCase()}`;
            const actual = porProducto.get(clave) ?? {
                id_producto: aTexto(producto?.id_producto ?? linea.id_producto),
                producto: aTexto(producto?.nombre ?? linea.producto),
                unidades: 0,
                ventas: new Set(),
            };
            actual.unidades += aMonto(linea.cantidad);
            actual.ventas.add(aTexto(venta.id_venta));
            porProducto.set(clave, actual);
        }
    }
    return porProducto;
};

// Liquidación de un vendedor en un periodo abierto (calculada con los datos actuales, sin guardar nada).
// hojas: { ventas, detalles, catalogo, metas } (filas de cada hoja).
// productos: los que tienen cuota (activos, o inactivos con ventas en el mes) y los vendidos sin cuota.
const calcularLiquidacion = (idVendedor, periodo, hojas) => {
    const meta = metaVigente(hojas.metas, idVendedor, periodo);
    const sueldoBase = meta ? aMonto(meta.sueldo_base) : 0;
    const vendidos = unidadesPorProducto(idVendedor, periodo, hojas.ventas, hojas.detalles, hojas.catalogo);

    const productos = [];
    const usados = new Set();
    for (const p of hojas.catalogo) {
        const clave = `ID:${aTexto(p.id_producto).toUpperCase()}`;
        const { cuota_mensual: cuota, valor_representativo: valor } = cuotaDe(p);
        const venta = vendidos.get(clave);
        const activo = aTexto(p.estado).toLowerCase() !== 'inactivo';
        if (!(cuota > 0 && activo) && !venta) continue;
        usados.add(clave);
        const unidades = venta?.unidades ?? 0;
        productos.push({
            id_producto: aTexto(p.id_producto),
            producto: aTexto(p.nombre),
            cuota_mensual: cuota,
            valor_representativo: valor,
            unidades,
            ventas: venta?.ventas.size ?? 0,
            ...bonificacionProducto({ cuota, unidades, valor, sueldo: sueldoBase }),
        });
    }
    // Vendidos que ya no están en el catálogo: sin cuota
    for (const [clave, venta] of vendidos) {
        if (usados.has(clave)) continue;
        productos.push({
            id_producto: venta.id_producto,
            producto: venta.producto,
            cuota_mensual: null,
            valor_representativo: null,
            unidades: venta.unidades,
            ventas: venta.ventas.size,
            ...bonificacionProducto({ cuota: null }),
        });
    }
    productos.sort((a, b) => b.bonificacion - a.bonificacion || (b.cumplimiento ?? -1) - (a.cumplimiento ?? -1)
        || a.producto.localeCompare(b.producto, 'es'));

    const bonificacion = sumar(productos, 'bonificacion');
    return {
        id_comision: '',
        id_vendedor: aTexto(idVendedor),
        periodo,
        estado: ESTADOS_COMISION.abierta,
        sistema: 'cuotas',
        tiene_meta: Boolean(meta),
        sueldo_base: sueldoBase,
        unidades_vendidas: redondear(productos.reduce((suma, p) => suma + p.unidades, 0)),
        productos_bonifican: productos.filter((p) => p.bonificacion > 0).length,
        bonificacion,
        total_a_pagar: redondear(sueldoBase + bonificacion),
        fecha_cierre: '',
        cerrado_por: '',
        fecha_pago: '',
        productos,
    };
};

// Liquidación ya cerrada, desde su fila de Comisiones y sus filas de Bonificaciones_Detalle.
// Las cerradas con el sistema anterior (comisión por cobranza) no tienen bonificacion: se muestran con su
// comision_pagada y sin detalle por producto (sistema: 'cobranza').
const liquidacionGuardada = ({ _fila, ...fila }, detalles) => {
    const anterior = aTexto(fila.bonificacion) === '' && aTexto(fila.comision_pagada) !== '';
    const productos = anterior ? [] : detalles
        .filter((d) => mismoId(d.id_comision, fila.id_comision))
        .map((d) => ({
            id_producto: aTexto(d.id_producto),
            producto: aTexto(d.producto),
            cuota_mensual: aMontoOpcional(d.cuota_mensual),
            valor_representativo: aMontoOpcional(d.valor_representativo),
            unidades: aMonto(d.unidades),
            cumplimiento: aMontoOpcional(d.cumplimiento),
            porcentaje_aplicado: aMonto(d.porcentaje_aplicado),
            bonificacion: aMonto(d.bonificacion),
        }));
    const bonificacion = anterior ? aMonto(fila.comision_pagada) : aMonto(fila.bonificacion);

    return {
        id_comision: aTexto(fila.id_comision),
        id_vendedor: aTexto(fila.id_vendedor),
        periodo: aPeriodo(fila.periodo),
        estado: aTexto(fila.estado).toLowerCase() || ESTADOS_COMISION.cerrada,
        sistema: anterior ? 'cobranza' : 'cuotas',
        tiene_meta: true,
        sueldo_base: aMonto(fila.sueldo_base),
        unidades_vendidas: aMonto(fila.unidades_vendidas),
        productos_bonifican: productos.filter((p) => p.bonificacion > 0).length,
        bonificacion,
        total_a_pagar: aMonto(fila.total_a_pagar),
        fecha_cierre: aTexto(fila.fecha_cierre),
        cerrado_por: aTexto(fila.cerrado_por),
        fecha_pago: aTexto(fila.fecha_pago),
        productos,
    };
};

// Liquidación sin el detalle por producto (para listas)
const resumenLiquidacion = ({ productos, ...resto }) => resto;

module.exports = {
    PISO_BONIFICACION,
    TOPE_BONIFICACION,
    COLUMNAS_CUOTA,
    ESTADOS_COMISION,
    aPeriodo,
    periodoActual,
    metaVigente,
    cuotaDe,
    bonificacionProducto,
    calcularLiquidacion,
    liquidacionGuardada,
    resumenLiquidacion,
};
