const {
    HOJAS, exigirColumnas, leerHoja, leerHojas, agregarFilas, actualizarFila, siguientesIds, conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    TOLERANCIA_USD, leerDatos, hayBancos, resolverTasa, leerLineasPago, repartirUsd, filasPago, formatearPago,
} = require('../utils/cobros');
const { comprobantesPorLinea, guardarComprobantes, borrarComprobantes, enviarComprobante } = require('../utils/comprobantes');
const {
    aMonto,
    redondear,
    mismoId,
    aTexto,
    clientesDelVendedor,
    estadoDeuda,
    formatearDeuda,
    TRAMOS_COBRO,
    totalesPorTramo,
    factorTramo,
    opcionesCobro,
    masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const { aFecha, fechaHoy } = require('../utils/valores');

// GET /bill/api/vendedores/pagos?id_deuda=&id_venta=&id_cliente=
const listarPagos = async (req, res) => {
    const idDeuda = aTexto(req.query.id_deuda);
    const idVenta = aTexto(req.query.id_venta);
    const idCliente = aTexto(req.query.id_cliente);

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.pagos);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);

        const pagos = hojas[HOJAS.pagos].filas
            .filter((p) => clientes.some((c) => mismoId(c.id_cliente, p.id_cliente)))
            .filter((p) => !idDeuda || mismoId(p.id_deuda, idDeuda))
            .filter((p) => !idVenta || mismoId(p.id_venta, idVenta))
            .filter((p) => !idCliente || mismoId(p.id_cliente, idCliente))
            .sort(masRecientePrimero('fecha_pago', 'id_pago'))
            .map((p) => formatearPago(p, clientes));

        return res.json({ ok: true, pagos });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pagos');
    }
};

// Columnas de Pagos que escribe el abono (se exigen: sin ellas se perderían el banco o el descuento)
const COLUMNAS_ABONO = ['banco', 'plazo_dias', 'monto_factura', 'descuento'];

// POST /bill/api/vendedores/pagos
// multipart: datos = JSON { id_deuda, fecha_pago?, tasa_bcv?, plazo_dias?, pagos: [{ metodo, monto, referencia?, banco? }] }
//            y comprobante_<n> (foto o PDF opcional de la forma de pago n). También acepta el JSON como body.
// Un abono puede combinar varias formas de pago; cada una es una fila de Pagos. Los montos en bolívares
// se convierten con tasa_bcv (o la del día del pago). banco (id_banco) es obligatorio en pago móvil y transferencia.
// Las deudas de pedidos entregados se cobran por tramos: plazo_dias (0 = contado, 7, 15 o 30; por defecto el que
// corresponde a los días desde la entrega; el vendedor puede elegir otro) fija el precio. La deuda guarda sus montos
// a precio de factura: el abono se convierte con el factor del tramo, así cada abono paga su parte de la factura al
// precio de su día. Cada fila guarda monto_factura (lo que salda de la factura) y descuento (monto_factura - monto).
// Actualiza monto_pagado, monto_pendiente y estado de la deuda.
const registrarPago = async (req, res) => {
    const datos = leerDatos(req);
    if (!datos) {
        return res.status(400).json({ ok: false, mensaje: 'Los datos del pago no son un JSON válido.' });
    }
    const idDeuda = aTexto(datos.id_deuda);
    const fechaPago = datos.fecha_pago ? aFecha(datos.fecha_pago) : fechaHoy();

    if (!idDeuda) {
        return res.status(400).json({ ok: false, mensaje: 'La deuda es obligatoria.' });
    }
    if (!fechaPago) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }
    const tramoEnviado = datos.plazo_dias === undefined || datos.plazo_dias === null || datos.plazo_dias === ''
        ? null : Number(datos.plazo_dias);
    if (tramoEnviado !== null && !TRAMOS_COBRO.includes(tramoEnviado)) {
        return res.status(400).json({ ok: false, mensaje: `El plazo debe ser ${TRAMOS_COBRO.join(', ')} días (0 = contado).` });
    }

    let comprobantes = {};
    try {
        // Fuera del bloqueo: puede consultar el BCV y guarda la tasa con su propio bloqueo
        const { tasa, error: errorTasa } = await resolverTasa(datos, fechaPago);
        if (errorTasa) return res.status(400).json({ ok: false, mensaje: errorTasa });

        const bancos = hayBancos(datos.pagos) ? (await leerHoja(HOJAS.bancos)).filas : [];
        const { lineas, totalUsd, error: errorLineas } = leerLineasPago(datos.pagos, tasa, bancos);
        if (errorLineas) return res.status(400).json({ ok: false, mensaje: errorLineas });

        const archivos = comprobantesPorLinea(req.files);
        if (Object.keys(archivos).some((linea) => !lineas[linea])) {
            return res.status(400).json({ ok: false, mensaje: 'Hay un comprobante sin forma de pago.' });
        }

        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(
                HOJAS.clientes, HOJAS.deudas, HOJAS.pagos, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.productos,
            );
            exigirColumnas(HOJAS.pagos, hojas[HOJAS.pagos].encabezados, COLUMNAS_ABONO);
            const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
            const deudas = hojas[HOJAS.deudas];

            const deuda = deudas.filas.find((d) =>
                mismoId(d.id_deuda, idDeuda) && clientes.some((c) => mismoId(c.id_cliente, d.id_cliente)));
            if (!deuda) return { status: 404, mensaje: 'Deuda no encontrada.' };

            const montoTotal = aMonto(deuda.monto_total);
            const pagadoAntes = aMonto(deuda.monto_pagado);
            const pendienteAntes = redondear(montoTotal - pagadoAntes);

            if (pendienteAntes <= 0) return { status: 409, mensaje: 'La deuda ya está pagada.' };

            // Saldo al tramo elegido (sin tramos, el factor es 1 y todo queda como antes)
            const totales = totalesPorTramo(
                deuda, hojas[HOJAS.ventas].filas, hojas[HOJAS.ventasDetalle].filas, hojas[HOJAS.productos].filas);
            const tramo = totales ? (tramoEnviado ?? opcionesCobro(deuda, totales, fechaPago).tramo_sugerido) : null;
            const factor = totales ? factorTramo(totales, tramo) : 1;
            const saldoTramo = redondear(pendienteAntes * factor);

            if (totalUsd > saldoTramo + TOLERANCIA_USD) {
                return { status: 400, mensaje: `Los pagos superan el saldo pendiente (${saldoTramo}).` };
            }
            // Un excedente de un céntimo por el redondeo de los bolívares se descuenta del abono
            const abono = Math.min(redondear(totalUsd), saldoTramo);
            if (abono <= 0) return { status: 400, mensaje: 'El monto en dólares debe ser mayor que 0.' };
            // Lo que el abono salda de la deuda a precio de factura; si cubre el saldo, la salda exacta
            const abonoFactura = abono >= saldoTramo - TOLERANCIA_USD
                ? pendienteAntes
                : Math.min(redondear(abono / factor), pendienteAntes);

            const montoPagado = redondear(pagadoAntes + abonoFactura);
            const montoPendiente = redondear(montoTotal - montoPagado);
            const cambiosDeuda = {
                monto_pagado: montoPagado,
                monto_pendiente: montoPendiente,
                estado: estadoDeuda(montoPagado, montoPendiente),
            };
            // El día en que se termina de pagar decide en qué mes comisiona (si la hoja ya tiene la columna)
            if (montoPendiente <= 0 && deudas.encabezados.includes('fecha_cancelacion')) {
                cambiosDeuda.fecha_cancelacion = fechaPago;
            }

            comprobantes = await guardarComprobantes(archivos);

            // Primero la deuda; si luego falla el registro de los pagos, se restauran sus valores anteriores
            await actualizarFila(HOJAS.deudas, deuda._fila, cambiosDeuda, deudas.encabezados);

            let pagos;
            try {
                // Cada fila guarda el tramo, su parte de la factura y el descuento (la última absorbe el redondeo)
                const repartidas = repartirUsd(lineas, abono);
                const facturaPorLinea = repartirUsd(repartidas.map((l) => ({ usd: l.monto / factor })), abonoFactura);
                pagos = await agregarFilas(HOJAS.pagos, filasPago(repartidas, {
                    ids: siguientesIds(hojas[HOJAS.pagos].filas, 'id_pago', 'PAG', lineas.length),
                    comprobantes,
                    tasa,
                    id_deuda: deuda.id_deuda,
                    id_venta: '',
                    id_cliente: deuda.id_cliente,
                    fecha_pago: fechaPago,
                    registrado_por: req.vendedor.id_vendedor,
                    plazo_dias: tramo ?? '',
                }).map((fila, i) => ({
                    ...fila,
                    monto_factura: facturaPorLinea[i].monto,
                    descuento: redondear(facturaPorLinea[i].monto - fila.monto),
                })), hojas[HOJAS.pagos].encabezados);
            } catch (error) {
                const anteriores = Object.fromEntries(Object.keys(cambiosDeuda).map((campo) => [campo, deuda[campo] ?? '']));
                await actualizarFila(HOJAS.deudas, deuda._fila, anteriores, deudas.encabezados).catch((e) => console.error('No se pudo restaurar la deuda:', e.message));
                throw error;
            }

            return {
                pagos: pagos.map((p) => formatearPago(p, clientes)),
                deuda: formatearDeuda({ ...deuda, ...cambiosDeuda }, clientes),
            };
        });

        if (resultado.status) {
            await borrarComprobantes(Object.values(comprobantes));
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        const { pagos, deuda } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'registrar_pago', {
            id_deuda: deuda.id_deuda,
            pagos: pagos.map((p) => ({ id_pago: p.id_pago, metodo_pago: p.metodo_pago, monto: p.monto, monto_bs: p.monto_bs })),
            plazo_dias: pagos[0]?.plazo_dias ?? null,
            monto_pendiente: deuda.monto_pendiente,
        });
        return res.status(201).json({ ok: true, mensaje: 'Pago registrado.', pagos, deuda });
    } catch (error) {
        await borrarComprobantes(Object.values(comprobantes));
        return responderError(res, error, 'Error al registrar el pago');
    }
};

// GET /bill/api/vendedores/pagos/:id/comprobante
// Envía la foto o el PDF del pago (solo de los clientes del vendedor logueado)
const obtenerComprobante = async (req, res) => {
    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.pagos);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
        const pago = hojas[HOJAS.pagos].filas.find((p) =>
            mismoId(p.id_pago, req.params.id) && clientes.some((c) => mismoId(c.id_cliente, p.id_cliente)));

        if (!pago) return res.status(404).json({ ok: false, mensaje: 'Pago no encontrado.' });
        return enviarComprobante(res, pago);
    } catch (error) {
        return responderError(res, error, 'Error al obtener el comprobante');
    }
};

module.exports = { listarPagos, registrarPago, obtenerComprobante };
