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

// Bonificaciones del vendedor (reemplazan la comisión por cobranza; los meses cerrados con ella no cambian).
// Cada mes el vendedor cobra solo la suma de cuatro bonificaciones. Su sueldo base (hoja Metas) no se paga: es la
// base con que se calculan la 1 y la 2.
//
// 1. Por cuotas de productos. Cada producto tiene una cuota_mensual (unidades) y un valor_representativo (%),
//    iguales para todos los vendedores (columnas de la hoja Productos). Un producto sin cuota no bonifica.
//    Unidades vendidas = las de las ventas (facturas emitidas) del vendedor con fecha_venta en el mes (no cuentan
//    los pedidos sin facturar ni importa si ya se cobraron). cumplimiento = unidades / cuota. Bajo PISO (70 %) ese
//    producto no bonifica; desde ahí se toma el % real, con un tope de TOPE (120 %).
//    bonificación del producto = % aplicado × (sueldo base × valor representativo).
//    Ej.: sueldo 520 $, valor 40 %, 1260 de 1800 unidades (70 %) → 0,70 × 208 = 145,60 $. Con 3000 (166,67 %), 120 %.
// 2. Por plazo de crédito: sueldo base × el % del plazo activo (columna bonificacion_pct de la hoja Plazos; uno solo
//    activo, clave plazo_bonificacion de Reglas_Bonificacion). Por ahora se paga siempre (pendiente de definir la
//    condición). Ej.: Crédito 3 al 60 % con sueldo 520 $ → 312 $.
// 3. Por clientes visitados: si visitó al menos meta_visitas clientes distintos en el mes (hoja Visitas), gana
//    bono_visitas (monto fijo). Ej.: 50 clientes → 200 $.
// 4. Por clientes nuevos: si registró al menos meta_clientes_nuevos clientes en el mes (Clientes.fecha_registro),
//    gana bono_clientes_nuevos (monto fijo, sin importar cuántos más). Ej.: 5 o más → 150 $; 4 → nada.
const PISO_BONIFICACION = 70;
const TOPE_BONIFICACION = 120;

// Reglas de la hoja Reglas_Bonificacion (clave, valor) y su valor si la clave no está en la hoja
const REGLAS_POR_DEFECTO = {
    plazo_bonificacion: 'CRED3',
    meta_visitas: 50,
    bono_visitas: 200,
    meta_clientes_nuevos: 5,
    bono_clientes_nuevos: 150,
};
const DESCRIPCION_REGLAS = {
    plazo_bonificacion: 'Plazo cuyo % (Plazos.bonificacion_pct) se paga sobre el sueldo base. Vacío = no se paga.',
    meta_visitas: 'Clientes distintos que el vendedor debe visitar en el mes.',
    bono_visitas: 'Bonificación ($) al llegar a la meta de visitas.',
    meta_clientes_nuevos: 'Clientes nuevos que el vendedor debe registrar en el mes.',
    bono_clientes_nuevos: 'Bonificación ($) al llegar a la meta de clientes nuevos.',
};
// % de cada plazo con que se siembra la columna Plazos.bonificacion_pct (scripts/prepararBonificaciones.js)
const PORCENTAJE_PLAZO_INICIAL = { CONT: 100, CRED1: 90, CRED2: 80, CRED3: 60 };

// Columnas de cada hoja
const COLUMNAS_CUOTA = ['cuota_mensual', 'valor_representativo'];
const COLUMNAS_REGLAS = ['clave', 'valor', 'descripcion'];
const COLUMNA_PCT_PLAZO = 'bonificacion_pct';
const COLUMNAS_VISITAS = ['id_visita', 'id_vendedor', 'id_cliente', 'fecha_visita', 'resultado', 'observaciones',
    'fecha_registro'];

// Resultados posibles de una visita (opcional)
const RESULTADOS_VISITA = {
    pedido: 'Tomó pedido',
    cobro: 'Cobranza',
    sin_pedido: 'Sin pedido',
    ausente: 'No estaba',
};

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

// Reglas vigentes a partir de las hojas Reglas_Bonificacion y Plazos:
// { piso, tope, plazos: [{ id_plazo, nombre, dias_desde, dias_hasta, activo, porcentaje }], plazo (el activo o null),
//   visitas: { meta, bono }, clientes_nuevos: { meta, bono } }
const leerReglas = (filasReglas, filasPlazos) => {
    const valores = new Map(filasReglas
        .filter((f) => aTexto(f.clave))
        .map((f) => [aTexto(f.clave).toLowerCase(), aTexto(f.valor)]));
    const numero = (clave) => (valores.has(clave) ? aMontoOpcional(valores.get(clave)) ?? 0 : REGLAS_POR_DEFECTO[clave]);
    const idPlazo = valores.has('plazo_bonificacion') ? valores.get('plazo_bonificacion') : REGLAS_POR_DEFECTO.plazo_bonificacion;

    const plazos = filasPlazos
        .filter((p) => aTexto(p.id_plazo))
        .map((p) => ({
            id_plazo: aTexto(p.id_plazo),
            nombre: aTexto(p.nombre) || aTexto(p.id_plazo),
            dias_desde: aMontoOpcional(p.dias_desde) ?? 0,
            dias_hasta: aMontoOpcional(p.dias_hasta),
            activo: ['', 'activo'].includes(aTexto(p.estado).toLowerCase()),
            porcentaje: aMontoOpcional(p[COLUMNA_PCT_PLAZO]),
        }))
        .sort((a, b) => a.dias_desde - b.dias_desde);

    return {
        piso: PISO_BONIFICACION,
        tope: TOPE_BONIFICACION,
        plazos,
        plazo: (idPlazo && plazos.find((p) => mismoId(p.id_plazo, idPlazo))) || null,
        visitas: { meta: numero('meta_visitas'), bono: numero('bono_visitas') },
        clientes_nuevos: { meta: numero('meta_clientes_nuevos'), bono: numero('bono_clientes_nuevos') },
    };
};

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

// Bonificación de monto fijo por llegar a una meta (visitas, clientes nuevos). Meta 0 = desactivada.
const bonoPorMeta = ({ meta, bono }, logrado) => {
    const cumple = meta > 0 && logrado >= meta;
    return { meta, bono, logrado, cumple, faltan: meta > 0 ? Math.max(0, meta - logrado) : 0, monto: cumple ? redondear(bono) : 0 };
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

const nombreCliente = (clientes, idCliente) => {
    const cliente = clientes.find((c) => mismoId(c.id_cliente, idCliente));
    return aTexto(cliente?.nombre_comercial) || aTexto(cliente?.contacto_nombre) || aTexto(idCliente);
};

// Clientes distintos que el vendedor visitó en el mes: [{ id_cliente, nombre, visitas, ultima }]
const clientesVisitados = (idVendedor, periodo, visitas, clientes) => {
    const porCliente = new Map();
    for (const v of visitas) {
        if (!mismoId(v.id_vendedor, idVendedor) || aPeriodo(v.fecha_visita) !== periodo || !aTexto(v.id_cliente)) continue;
        const clave = aTexto(v.id_cliente).toUpperCase();
        const actual = porCliente.get(clave) ?? {
            id_cliente: aTexto(v.id_cliente), nombre: nombreCliente(clientes, v.id_cliente), visitas: 0, ultima: '',
        };
        actual.visitas += 1;
        if (aTexto(v.fecha_visita) > actual.ultima) actual.ultima = aTexto(v.fecha_visita).slice(0, 10);
        porCliente.set(clave, actual);
    }
    return [...porCliente.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
};

// Clientes que el vendedor registró en el mes: [{ id_cliente, nombre, fecha_registro }]
const clientesNuevos = (idVendedor, periodo, clientes) => clientes
    .filter((c) => mismoId(c.id_vendedor, idVendedor) && aPeriodo(c.fecha_registro) === periodo)
    .map((c) => ({ id_cliente: aTexto(c.id_cliente), nombre: nombreCliente(clientes, c.id_cliente), fecha_registro: aTexto(c.fecha_registro).slice(0, 10) }))
    .sort((a, b) => a.fecha_registro.localeCompare(b.fecha_registro));

// Bonificación por cuotas de productos: los que tienen cuota (activos, o inactivos con ventas en el mes) y los
// vendidos sin cuota
const productosDelMes = (idVendedor, periodo, hojas, sueldoBase) => {
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
    return productos.sort((a, b) => b.bonificacion - a.bonificacion || (b.cumplimiento ?? -1) - (a.cumplimiento ?? -1)
        || a.producto.localeCompare(b.producto, 'es'));
};

// Liquidación de un vendedor en un periodo abierto (calculada con los datos actuales, sin guardar nada).
// hojas: { ventas, detalles, catalogo, metas, clientes, visitas } (filas de cada hoja); reglas: ver leerReglas.
const calcularLiquidacion = (idVendedor, periodo, hojas, reglas) => {
    const meta = metaVigente(hojas.metas, idVendedor, periodo);
    const sueldoBase = meta ? aMonto(meta.sueldo_base) : 0;

    const productos = productosDelMes(idVendedor, periodo, hojas, sueldoBase);
    const bonoCuotas = sumar(productos, 'bonificacion');

    const pctPlazo = reglas.plazo?.porcentaje ?? 0;
    const bonoPlazo = {
        id_plazo: reglas.plazo?.id_plazo ?? '',
        nombre: reglas.plazo?.nombre ?? '',
        porcentaje: pctPlazo,
        monto: redondear(sueldoBase * (pctPlazo / 100)),
    };

    const visitados = clientesVisitados(idVendedor, periodo, hojas.visitas, hojas.clientes);
    const nuevos = clientesNuevos(idVendedor, periodo, hojas.clientes);
    const bonoVisitas = { ...bonoPorMeta(reglas.visitas, visitados.length), clientes: visitados };
    const bonoNuevos = { ...bonoPorMeta(reglas.clientes_nuevos, nuevos.length), clientes: nuevos };

    const bonificacion = redondear(bonoCuotas + bonoPlazo.monto + bonoVisitas.monto + bonoNuevos.monto);
    return {
        id_comision: '',
        id_vendedor: aTexto(idVendedor),
        periodo,
        estado: ESTADOS_COMISION.abierta,
        sistema: 'bonificaciones',
        tiene_meta: Boolean(meta),
        sueldo_base: sueldoBase,
        unidades_vendidas: redondear(productos.reduce((suma, p) => suma + p.unidades, 0)),
        productos_bonifican: productos.filter((p) => p.bonificacion > 0).length,
        bono_cuotas: bonoCuotas,
        bono_plazo: bonoPlazo,
        bono_visitas: bonoVisitas,
        bono_clientes_nuevos: bonoNuevos,
        bonificacion,
        // El sueldo base no se suma: solo es la base de cálculo
        total_a_pagar: bonificacion,
        fecha_cierre: '',
        cerrado_por: '',
        fecha_pago: '',
        productos,
    };
};

// Tiene algo que liquidar aunque no tenga sueldo (ventas, visitas o clientes nuevos)
const tieneActividad = (l) => l.unidades_vendidas > 0 || l.bono_visitas.logrado > 0 || l.bono_clientes_nuevos.logrado > 0;

// Liquidación ya cerrada, desde su fila de Comisiones y sus filas de Bonificaciones_Detalle.
// - sistema 'cobranza': cerrada con la comisión por cobranza (tiene comision_pagada); sin detalle por producto.
// - sistema 'bonificaciones': las cuatro bonificaciones (sin la lista de clientes, solo los conteos).
// Las cerradas solo con la bonificación por cuotas (sin bono_cuotas) toman bonificacion como bono por cuotas.
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
    const soloCuotas = aTexto(fila.bono_cuotas) === '';
    const guardado = (monto, meta, bono, logrado) => ({
        meta: aMonto(meta), bono: aMonto(bono), logrado: aMonto(logrado), cumple: aMonto(monto) > 0, faltan: 0,
        monto: aMonto(monto), clientes: [],
    });

    return {
        id_comision: aTexto(fila.id_comision),
        id_vendedor: aTexto(fila.id_vendedor),
        periodo: aPeriodo(fila.periodo),
        estado: aTexto(fila.estado).toLowerCase() || ESTADOS_COMISION.cerrada,
        sistema: anterior ? 'cobranza' : 'bonificaciones',
        tiene_meta: true,
        sueldo_base: aMonto(fila.sueldo_base),
        unidades_vendidas: aMonto(fila.unidades_vendidas),
        productos_bonifican: productos.filter((p) => p.bonificacion > 0).length,
        bono_cuotas: anterior ? 0 : soloCuotas ? bonificacion : aMonto(fila.bono_cuotas),
        bono_plazo: {
            id_plazo: aTexto(fila.id_plazo_bono),
            nombre: aTexto(fila.id_plazo_bono),
            porcentaje: aMonto(fila.pct_plazo_bono),
            monto: aMonto(fila.bono_plazo),
        },
        bono_visitas: guardado(fila.bono_visitas, fila.meta_visitas, fila.monto_bono_visitas, fila.clientes_visitados),
        bono_clientes_nuevos: guardado(fila.bono_clientes_nuevos, fila.meta_clientes_nuevos, fila.monto_bono_clientes_nuevos,
            fila.clientes_nuevos),
        bonificacion,
        total_a_pagar: aMonto(fila.total_a_pagar),
        fecha_cierre: aTexto(fila.fecha_cierre),
        cerrado_por: aTexto(fila.cerrado_por),
        fecha_pago: aTexto(fila.fecha_pago),
        productos,
    };
};

// Fila de la hoja Comisiones para cerrar el mes con una liquidación calculada
const filaCierre = (l) => ({
    sueldo_base: l.sueldo_base,
    unidades_vendidas: l.unidades_vendidas,
    bono_cuotas: l.bono_cuotas,
    id_plazo_bono: l.bono_plazo.id_plazo,
    pct_plazo_bono: l.bono_plazo.porcentaje,
    bono_plazo: l.bono_plazo.monto,
    clientes_visitados: l.bono_visitas.logrado,
    meta_visitas: l.bono_visitas.meta,
    monto_bono_visitas: l.bono_visitas.bono,
    bono_visitas: l.bono_visitas.monto,
    clientes_nuevos: l.bono_clientes_nuevos.logrado,
    meta_clientes_nuevos: l.bono_clientes_nuevos.meta,
    monto_bono_clientes_nuevos: l.bono_clientes_nuevos.bono,
    bono_clientes_nuevos: l.bono_clientes_nuevos.monto,
    bonificacion: l.bonificacion,
    total_a_pagar: l.total_a_pagar,
});
const COLUMNAS_CIERRE = ['id_comision', 'id_vendedor', 'periodo', ...Object.keys(filaCierre({
    bono_plazo: {}, bono_visitas: {}, bono_clientes_nuevos: {},
})), 'estado', 'fecha_cierre', 'cerrado_por', 'fecha_pago'];

// Liquidación sin los detalles (para listas)
const resumenLiquidacion = ({ productos, ...resto }) => ({
    ...resto,
    bono_visitas: { ...resto.bono_visitas, clientes: undefined },
    bono_clientes_nuevos: { ...resto.bono_clientes_nuevos, clientes: undefined },
});

module.exports = {
    PISO_BONIFICACION,
    TOPE_BONIFICACION,
    REGLAS_POR_DEFECTO,
    DESCRIPCION_REGLAS,
    PORCENTAJE_PLAZO_INICIAL,
    COLUMNAS_CUOTA,
    COLUMNAS_REGLAS,
    COLUMNA_PCT_PLAZO,
    COLUMNAS_VISITAS,
    COLUMNAS_CIERRE,
    RESULTADOS_VISITA,
    ESTADOS_COMISION,
    aPeriodo,
    periodoActual,
    metaVigente,
    leerReglas,
    cuotaDe,
    bonificacionProducto,
    calcularLiquidacion,
    tieneActividad,
    liquidacionGuardada,
    filaCierre,
    resumenLiquidacion,
};
