const { fechaHoy } = require('./valores');
const {
    aMonto,
    aMontoOpcional,
    redondear,
    sumar,
    mismoId,
    aTexto,
    clientesDelVendedor,
    productoDeLinea,
} = require('./cartera');
const { aMoneda, totalesCobro, plazoDelPago } = require('./precios');

// Reglas de comisión (pendientes de confirmar con finanzas; cambiarlas aquí):
// - El vendedor cobra su sueldo_base siempre; la comisión solo si lo cobrado en el mes llega a la meta.
//   Si no la cumple, las comisiones de ese mes se pierden (las facturas quedan liquidadas con comisión 0).
// - Solo comisionan las facturas pagadas por completo, en el mes en que se cancelan (o en el primer mes que se
//   cierre después, si sus pagos se verificaron tarde).
// - La comisión es un % de lo cobrado de cada producto (columna comision de Productos). Lo cobrado en cada pago
//   se reparte entre los productos según su precio en el plazo y la moneda de ese pago.
// - SOLO_PAGOS_VERIFICADOS: un pago cuenta para la meta y para la comisión solo cuando el administrador lo
//   verificó. Con false cuentan también los pendientes (nunca los rechazados).
// - Las deudas manuales (sin venta ni productos) no comisionan.
const SOLO_PAGOS_VERIFICADOS = true;

// Columna del % de comisión en la hoja Productos (vacío = sin comisión)
const COLUMNA_COMISION = 'comision';

// Estados de una liquidación en la hoja Comisiones (un mes sin fila está abierto: se calcula al consultarlo)
const ESTADOS_COMISION = { abierta: 'abierta', cerrada: 'cerrada', pagada: 'pagada' };

// Periodo YYYY-MM válido o null. Acepta también una fecha YYYY-MM-DD (se queda con el mes).
const aPeriodo = (valor) => {
    const texto = aTexto(valor).slice(0, 7);
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(texto) ? texto : null;
};

const periodoActual = () => fechaHoy().slice(0, 7);

const estadoVerificacion = (pago) => aTexto(pago.estado_verificacion).toLowerCase() || 'pendiente';

// Si el pago cuenta para la meta y la comisión (ver SOLO_PAGOS_VERIFICADOS)
const pagoCuenta = (pago) => {
    const estado = estadoVerificacion(pago);
    return SOLO_PAGOS_VERIFICADOS ? estado === 'verificado' : estado !== 'rechazado';
};

// Día en que se terminó de pagar la deuda: fecha_cancelacion o, en las anteriores a esa columna, su último pago
const fechaCancelacion = (deuda, pagosDeuda) => aTexto(deuda.fecha_cancelacion)
    || pagosDeuda.map((p) => aTexto(p.fecha_pago)).sort().pop()
    || '';

// Meta vigente del vendedor en el periodo: la de ese mes o, si no tiene, la más reciente anterior. null si no hay.
const metaVigente = (metas, idVendedor, periodo) => metas
    .filter((m) => mismoId(m.id_vendedor, idVendedor) && aPeriodo(m.periodo) && aPeriodo(m.periodo) <= periodo)
    .sort((a, b) => aPeriodo(b.periodo).localeCompare(aPeriodo(a.periodo)))[0] ?? null;

// Reparte un monto en proporción a los pesos, redondeado a centavos (la última parte absorbe el redondeo)
const repartir = (monto, pesos) => {
    const total = pesos.reduce((suma, peso) => suma + peso, 0);
    let asignado = 0;
    return pesos.map((peso, i) => {
        if (i === pesos.length - 1) return redondear(monto - asignado);
        const parte = redondear(total > 0 ? (monto * peso) / total : monto / pesos.length);
        asignado += parte;
        return parte;
    });
};

// Comisión de una factura pagada: por cada pago y cada producto, la parte de lo cobrado que le toca al producto
// (según su precio en el plazo y la moneda del pago) por el % de comisión del producto en el catálogo.
const lineasComision = (deuda, pagosDeuda, totales, catalogo, config) => pagosDeuda.flatMap((pago) => {
    const idPlazo = plazoDelPago(pago, deuda, config);
    const moneda = aMoneda(pago.moneda) ?? 'USD';
    const pesos = totales.lineas.map((linea) => linea.cantidad * linea.precios[idPlazo][moneda] || linea.subtotal);
    const bases = repartir(aMonto(pago.monto), pesos);

    return totales.lineas.map((linea, i) => {
        const producto = productoDeLinea(catalogo, linea);
        const porcentaje = (producto && aMontoOpcional(producto[COLUMNA_COMISION])) || 0;
        return {
            id_pago: aTexto(pago.id_pago),
            id_producto: aTexto(linea.id_producto),
            producto: aTexto(linea.producto),
            id_plazo: idPlazo,
            base: bases[i],
            porcentaje,
            monto_comision: redondear((bases[i] * porcentaje) / 100),
        };
    });
});

// Liquidación de un vendedor en un periodo abierto (calculada con los datos actuales, sin guardar nada).
// hojas: { clientes, deudas, pagos, ventas, detalles, catalogo, metas } (filas de cada hoja) y config (motor de precios).
// facturas: las que comisionan; por_verificar: pagadas con algún pago sin verificar (o rechazado), que entran
// cuando se verifiquen; sin_productos: deudas manuales pagadas (no comisionan).
const calcularLiquidacion = (idVendedor, periodo, hojas) => {
    const clientes = clientesDelVendedor(hojas.clientes, idVendedor);
    const deCliente = (fila) => clientes.some((c) => mismoId(c.id_cliente, fila.id_cliente));
    const pagos = hojas.pagos.filter(deCliente);
    const meta = metaVigente(hojas.metas, idVendedor, periodo);

    const facturas = [];
    const porVerificar = [];
    const sinProductos = [];
    for (const deuda of hojas.deudas.filter(deCliente)) {
        if (aTexto(deuda.id_comision) || aMonto(deuda.monto_pendiente) > 0) continue;
        const pagosDeuda = pagos.filter((p) => mismoId(p.id_deuda, deuda.id_deuda));
        const cancelada = fechaCancelacion(deuda, pagosDeuda);
        if (!aPeriodo(cancelada) || aPeriodo(cancelada) > periodo) continue;

        const venta = hojas.ventas.find((v) => mismoId(v.id_deuda, deuda.id_deuda));
        const factura = {
            id_deuda: aTexto(deuda.id_deuda),
            id_venta: aTexto(venta?.id_venta),
            numero_factura: aTexto(deuda.numero_factura),
            id_cliente: aTexto(deuda.id_cliente),
            cliente_nombre: aTexto(clientes.find((c) => mismoId(c.id_cliente, deuda.id_cliente))?.nombre_comercial),
            fecha_cancelacion: cancelada,
            cobrado: sumar(pagosDeuda, 'monto'),
        };

        if (pagosDeuda.some((p) => !pagoCuenta(p))) {
            porVerificar.push(factura);
            continue;
        }
        const totales = totalesCobro(deuda, hojas.ventas, hojas.detalles, hojas.catalogo, hojas.config);
        if (!totales) {
            sinProductos.push(factura);
            continue;
        }
        const lineas = lineasComision(deuda, pagosDeuda, totales, hojas.catalogo, hojas.config);
        facturas.push({ ...factura, comision: sumar(lineas, 'monto_comision'), lineas });
    }

    const metaMonto = meta ? aMonto(meta.meta_monto) : 0;
    const sueldoBase = meta ? aMonto(meta.sueldo_base) : 0;
    const montoCobrado = sumar(pagos.filter((p) => aPeriodo(p.fecha_pago) === periodo && pagoCuenta(p)), 'monto');
    const metaCumplida = Boolean(meta) && montoCobrado >= metaMonto;
    const comisionCalculada = sumar(facturas, 'comision');
    const comisionPagada = metaCumplida ? comisionCalculada : 0;

    return {
        id_comision: '',
        id_vendedor: aTexto(idVendedor),
        periodo,
        estado: ESTADOS_COMISION.abierta,
        tiene_meta: Boolean(meta),
        meta_monto: metaMonto,
        sueldo_base: sueldoBase,
        monto_cobrado: montoCobrado,
        meta_cumplida: metaCumplida,
        comision_calculada: comisionCalculada,
        comision_pagada: comisionPagada,
        total_a_pagar: redondear(sueldoBase + comisionPagada),
        fecha_cierre: '',
        cerrado_por: '',
        fecha_pago: '',
        facturas,
        por_verificar: porVerificar,
        sin_productos: sinProductos,
    };
};

const esSi = (valor) => ['si', 'sí', 'true', '1'].includes(aTexto(valor).toLowerCase());

// Liquidación ya cerrada, desde su fila de Comisiones y sus filas de Comisiones_Detalle (agrupadas por factura).
// El cliente de cada factura sale de su deuda (la hoja de detalle no lo guarda).
const liquidacionGuardada = ({ _fila, ...fila }, detalles, deudas, clientes) => {
    const facturas = [];
    for (const linea of detalles.filter((d) => mismoId(d.id_comision, fila.id_comision))) {
        let factura = facturas.find((f) => mismoId(f.id_deuda, linea.id_deuda));
        if (!factura) {
            const deuda = deudas.find((d) => mismoId(d.id_deuda, linea.id_deuda));
            factura = {
                id_deuda: aTexto(linea.id_deuda),
                id_venta: aTexto(linea.id_venta),
                numero_factura: aTexto(linea.numero_factura),
                id_cliente: aTexto(deuda?.id_cliente),
                cliente_nombre: aTexto(clientes.find((c) => mismoId(c.id_cliente, deuda?.id_cliente))?.nombre_comercial),
                fecha_cancelacion: aTexto(deuda?.fecha_cancelacion),
                lineas: [],
            };
            facturas.push(factura);
        }
        factura.lineas.push({
            id_pago: aTexto(linea.id_pago),
            id_producto: aTexto(linea.id_producto),
            producto: aTexto(linea.producto),
            // Las liquidaciones anteriores al motor de precios guardaban plazo_dias (0, 7, 15 o 30)
            id_plazo: aTexto(linea.id_plazo) || (aTexto(linea.plazo_dias) !== '' ? `${aMonto(linea.plazo_dias)} días` : ''),
            base: aMonto(linea.base),
            porcentaje: aMonto(linea.porcentaje),
            monto_comision: aMonto(linea.monto_comision),
        });
    }

    return {
        id_comision: aTexto(fila.id_comision),
        id_vendedor: aTexto(fila.id_vendedor),
        periodo: aPeriodo(fila.periodo),
        estado: aTexto(fila.estado).toLowerCase() || ESTADOS_COMISION.cerrada,
        tiene_meta: true,
        meta_monto: aMonto(fila.meta_monto),
        sueldo_base: aMonto(fila.sueldo_base),
        monto_cobrado: aMonto(fila.monto_cobrado),
        meta_cumplida: esSi(fila.meta_cumplida),
        comision_calculada: aMonto(fila.comision_calculada),
        comision_pagada: aMonto(fila.comision_pagada),
        total_a_pagar: aMonto(fila.total_a_pagar),
        fecha_cierre: aTexto(fila.fecha_cierre),
        cerrado_por: aTexto(fila.cerrado_por),
        fecha_pago: aTexto(fila.fecha_pago),
        facturas: facturas.map((f) => ({ ...f, cobrado: sumar(f.lineas, 'base'), comision: sumar(f.lineas, 'monto_comision') })),
        por_verificar: [],
        sin_productos: [],
    };
};

// Liquidación sin el detalle por producto (para listas)
const resumenLiquidacion = ({ facturas, por_verificar, sin_productos, ...resto }) => ({
    ...resto,
    facturas: facturas.length,
    por_verificar: por_verificar.length,
});

module.exports = {
    SOLO_PAGOS_VERIFICADOS,
    COLUMNA_COMISION,
    ESTADOS_COMISION,
    aPeriodo,
    periodoActual,
    metaVigente,
    calcularLiquidacion,
    liquidacionGuardada,
    resumenLiquidacion,
};
