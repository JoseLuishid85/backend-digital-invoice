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
// 3. Por clientes activos: un cliente activo es el que tuvo al menos una venta (factura emitida) del vendedor con
//    fecha_venta en el mes; dos ventas al mismo cliente cuentan como un cliente. Si llega a meta_clientes_activos,
//    gana bono_clientes_activos (monto fijo). Ej.: 50 clientes → 200 $. (Antes eran los clientes visitados; la hoja
//    Visitas sigue como registro, pero ya no bonifica.)
// 4. Por clientes nuevos: un cliente es nuevo en el mes de su primer pedido (no anulado) o su primera venta, lo que
//    ocurra antes, y cuenta para el vendedor que hizo ese pedido o venta. Los clientes marcados en
//    Clientes.cliente_existente (ya tenían facturas antes de esta regla) nunca son nuevos. Si llega a
//    meta_clientes_nuevos, gana bono_clientes_nuevos (monto fijo, sin importar cuántos más). Ej.: 5 o más → 150 $.
const PISO_BONIFICACION = 70;
const TOPE_BONIFICACION = 120;

// Reglas de la hoja Reglas_Bonificacion (clave, valor) y su valor si la clave no está en la hoja
const REGLAS_POR_DEFECTO = {
    plazo_bonificacion: 'CRED3',
    meta_clientes_activos: 50,
    bono_clientes_activos: 200,
    meta_clientes_nuevos: 5,
    bono_clientes_nuevos: 150,
};
const DESCRIPCION_REGLAS = {
    plazo_bonificacion: 'Plazo cuyo % (Plazos.bonificacion_pct) se paga sobre el sueldo base. Vacío = no se paga.',
    meta_clientes_activos: 'Clientes distintos con al menos una venta del vendedor en el mes.',
    bono_clientes_activos: 'Bonificación ($) al llegar a la meta de clientes activos.',
    meta_clientes_nuevos: 'Clientes con su primer pedido o primera venta del vendedor en el mes.',
    bono_clientes_nuevos: 'Bonificación ($) al llegar a la meta de clientes nuevos.',
};
// Claves anteriores de las reglas: si la nueva no está en la hoja se toma el valor de la anterior
const REGLAS_ANTERIORES = { meta_clientes_activos: 'meta_visitas', bono_clientes_activos: 'bono_visitas' };
// % de cada plazo con que se siembra la columna Plazos.bonificacion_pct (scripts/prepararBonificaciones.js)
const PORCENTAJE_PLAZO_INICIAL = { CONT: 100, CRED1: 90, CRED2: 80, CRED3: 60 };

// Columnas de cada hoja
const COLUMNAS_CUOTA = ['cuota_mensual', 'valor_representativo'];
const COLUMNAS_REGLAS = ['clave', 'valor', 'descripcion'];
const COLUMNA_PCT_PLAZO = 'bonificacion_pct';
// Clientes.cliente_existente: si/true/1/x = el cliente ya tenía facturas antes de la regla de clientes nuevos
const COLUMNA_CLIENTE_EXISTENTE = 'cliente_existente';
const esClienteExistente = (cliente) => ['si', 'sí', 'true', 'verdadero', '1', 'x']
    .includes(aTexto(cliente?.[COLUMNA_CLIENTE_EXISTENTE]).toLowerCase());
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
//   clientes_activos: { meta, bono }, clientes_nuevos: { meta, bono } }
const leerReglas = (filasReglas, filasPlazos) => {
    const valores = new Map(filasReglas
        .filter((f) => aTexto(f.clave))
        .map((f) => [aTexto(f.clave).toLowerCase(), aTexto(f.valor)]));
    const numero = (clave) => {
        const enHoja = valores.has(clave) ? clave : REGLAS_ANTERIORES[clave];
        return enHoja && valores.has(enHoja) ? aMontoOpcional(valores.get(enHoja)) ?? 0 : REGLAS_POR_DEFECTO[clave];
    };
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
        clientes_activos: { meta: numero('meta_clientes_activos'), bono: numero('bono_clientes_activos') },
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

// Bonificación de monto fijo por llegar a una meta (clientes activos, clientes nuevos). Meta 0 = desactivada.
const bonoPorMeta = ({ meta, bono }, logrado) => {
    const cumple = meta > 0 && logrado >= meta;
    return { meta, bono, logrado, cumple, faltan: meta > 0 ? Math.max(0, meta - logrado) : 0, monto: cumple ? redondear(bono) : 0 };
};

const ventaValida = (v) => aTexto(v.estado_entrega).toLowerCase() !== 'anulada';

// Ventas (no anuladas) del vendedor con fecha_venta en el periodo
const ventasDelMes = (idVendedor, periodo, ventas) => ventas
    .filter((v) => mismoId(v.id_vendedor, idVendedor) && aPeriodo(v.fecha_venta) === periodo && ventaValida(v));

// Unidades vendidas por producto: ventas del vendedor con fecha_venta en el periodo. Map id → { id_producto,
// producto, unidades, ventas }. Las líneas cuyo producto ya no existe se agrupan por nombre.
const unidadesPorProducto = (idVendedor, periodo, ventas, detalles, catalogo) => {
    const delMes = ventasDelMes(idVendedor, periodo, ventas);
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

// Clientes activos del vendedor en el mes: los distintos con alguna venta suya en el mes.
// [{ id_cliente, nombre, ventas, monto, ultima }]
const clientesActivos = (idVendedor, periodo, ventas, clientes) => {
    const porCliente = new Map();
    for (const v of ventasDelMes(idVendedor, periodo, ventas)) {
        if (!aTexto(v.id_cliente)) continue;
        const clave = aTexto(v.id_cliente).toUpperCase();
        const actual = porCliente.get(clave) ?? {
            id_cliente: aTexto(v.id_cliente), nombre: nombreCliente(clientes, v.id_cliente), ventas: 0, monto: 0, ultima: '',
        };
        actual.ventas += 1;
        actual.monto = redondear(actual.monto + aMonto(v.monto_total));
        const fecha = aTexto(v.fecha_venta).slice(0, 10);
        if (fecha > actual.ultima) actual.ultima = fecha;
        porCliente.set(clave, actual);
    }
    return [...porCliente.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
};

// Primer movimiento de cada cliente: su pedido (no anulado) o venta (no anulada) más antiguo.
// Map ID en mayúsculas → { fecha, tipo: 'pedido'|'venta', id, id_vendedor }. A igual fecha gana el primero leído
// (los pedidos van antes: la venta que sale de un pedido es la misma operación).
const primerMovimientoPorCliente = (pedidos, ventas) => {
    const primeros = new Map();
    const considerar = (idCliente, fecha, tipo, id, idVendedor) => {
        if (!aTexto(idCliente) || !fecha) return;
        const clave = aTexto(idCliente).toUpperCase();
        const actual = primeros.get(clave);
        if (!actual || fecha < actual.fecha) primeros.set(clave, { fecha, tipo, id: aTexto(id), id_vendedor: aTexto(idVendedor) });
    };
    for (const p of pedidos) {
        if (aTexto(p.estado).toLowerCase() === 'anulado') continue;
        considerar(p.id_cliente, aTexto(p.fecha_pedido).slice(0, 10), 'pedido', p.id_pedido, p.id_vendedor);
    }
    for (const v of ventas) {
        if (ventaValida(v)) considerar(v.id_cliente, aTexto(v.fecha_venta).slice(0, 10), 'venta', v.id_venta, v.id_vendedor);
    }
    return primeros;
};

// Clientes nuevos del vendedor en el mes: los que hicieron con él su primer pedido o su primera venta en ese mes,
// sin contar los marcados como cliente_existente. [{ id_cliente, nombre, fecha, tipo, id }]
const clientesNuevos = (idVendedor, periodo, hojas) => {
    const existentes = new Set(hojas.clientes.filter(esClienteExistente).map((c) => aTexto(c.id_cliente).toUpperCase()));
    return [...primerMovimientoPorCliente(hojas.pedidos, hojas.ventas).entries()]
        .filter(([clave, m]) => !existentes.has(clave) && aPeriodo(m.fecha) === periodo && mismoId(m.id_vendedor, idVendedor))
        .map(([clave, m]) => {
            const cliente = hojas.clientes.find((c) => aTexto(c.id_cliente).toUpperCase() === clave);
            const idCliente = aTexto(cliente?.id_cliente) || clave;
            return { id_cliente: idCliente, nombre: nombreCliente(hojas.clientes, idCliente), fecha: m.fecha, tipo: m.tipo, id: m.id };
        })
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
};

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
// hojas: { ventas, detalles, catalogo, metas, clientes, pedidos } (filas de cada hoja); reglas: ver leerReglas.
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

    const activos = clientesActivos(idVendedor, periodo, hojas.ventas, hojas.clientes);
    const nuevos = clientesNuevos(idVendedor, periodo, hojas);
    const bonoActivos = { ...bonoPorMeta(reglas.clientes_activos, activos.length), clientes: activos };
    const bonoNuevos = { ...bonoPorMeta(reglas.clientes_nuevos, nuevos.length), clientes: nuevos };

    const bonificacion = redondear(bonoCuotas + bonoPlazo.monto + bonoActivos.monto + bonoNuevos.monto);
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
        bono_clientes_activos: bonoActivos,
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

// Tiene algo que liquidar aunque no tenga sueldo (ventas, clientes activos o clientes nuevos)
const tieneActividad = (l) => l.unidades_vendidas > 0 || l.bono_clientes_activos.logrado > 0
    || l.bono_clientes_nuevos.logrado > 0;

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
        bono_clientes_activos: guardado(fila.bono_clientes_activos, fila.meta_clientes_activos,
            fila.monto_bono_clientes_activos, fila.clientes_activos),
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
    clientes_activos: l.bono_clientes_activos.logrado,
    meta_clientes_activos: l.bono_clientes_activos.meta,
    monto_bono_clientes_activos: l.bono_clientes_activos.bono,
    bono_clientes_activos: l.bono_clientes_activos.monto,
    clientes_nuevos: l.bono_clientes_nuevos.logrado,
    meta_clientes_nuevos: l.bono_clientes_nuevos.meta,
    monto_bono_clientes_nuevos: l.bono_clientes_nuevos.bono,
    bono_clientes_nuevos: l.bono_clientes_nuevos.monto,
    bonificacion: l.bonificacion,
    total_a_pagar: l.total_a_pagar,
});
const COLUMNAS_CIERRE = ['id_comision', 'id_vendedor', 'periodo', ...Object.keys(filaCierre({
    bono_plazo: {}, bono_clientes_activos: {}, bono_clientes_nuevos: {},
})), 'estado', 'fecha_cierre', 'cerrado_por', 'fecha_pago'];

// Liquidación sin los detalles (para listas)
const resumenLiquidacion = ({ productos, ...resto }) => ({
    ...resto,
    bono_clientes_activos: { ...resto.bono_clientes_activos, clientes: undefined },
    bono_clientes_nuevos: { ...resto.bono_clientes_nuevos, clientes: undefined },
});

module.exports = {
    PISO_BONIFICACION,
    TOPE_BONIFICACION,
    REGLAS_POR_DEFECTO,
    REGLAS_ANTERIORES,
    DESCRIPCION_REGLAS,
    PORCENTAJE_PLAZO_INICIAL,
    COLUMNAS_CUOTA,
    COLUMNAS_REGLAS,
    COLUMNA_PCT_PLAZO,
    COLUMNA_CLIENTE_EXISTENTE,
    COLUMNAS_VISITAS,
    COLUMNAS_CIERRE,
    RESULTADOS_VISITA,
    ESTADOS_COMISION,
    aPeriodo,
    periodoActual,
    metaVigente,
    leerReglas,
    esClienteExistente,
    cuotaDe,
    bonificacionProducto,
    calcularLiquidacion,
    tieneActividad,
    liquidacionGuardada,
    filaCierre,
    resumenLiquidacion,
};
