const fs = require('fs');
const { HOJAS, leerHojas, agregarFilas, actualizarFila, siguientesIds, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    TOLERANCIA_USD, leerDatos, resolverTasa, leerLineasPago, repartirUsd, filasPago, formatearPago,
} = require('../utils/cobros');
const { comprobantesPorLinea, guardarComprobantes, borrarComprobantes, rutaComprobante } = require('../utils/comprobantes');
const {
    aMonto,
    redondear,
    mismoId,
    aTexto,
    clientesDelVendedor,
    estadoDeuda,
    formatearDeuda,
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

// POST /bill/api/vendedores/pagos
// multipart: datos = JSON { id_deuda, fecha_pago?, tasa_bcv?, pagos: [{ metodo, monto, referencia? }] }
//            y comprobante_<n> (foto o PDF opcional de la forma de pago n). También acepta el JSON como body.
// Un abono puede combinar varias formas de pago; cada una es una fila de Pagos. Los montos en bolívares
// se convierten con tasa_bcv (o la del día del pago). Actualiza monto_pagado, monto_pendiente y estado de la deuda.
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

    let comprobantes = {};
    try {
        // Fuera del bloqueo: puede consultar el BCV y guarda la tasa con su propio bloqueo
        const { tasa, error: errorTasa } = await resolverTasa(datos, fechaPago);
        if (errorTasa) return res.status(400).json({ ok: false, mensaje: errorTasa });

        const { lineas, totalUsd, error: errorLineas } = leerLineasPago(datos.pagos, tasa);
        if (errorLineas) return res.status(400).json({ ok: false, mensaje: errorLineas });

        const archivos = comprobantesPorLinea(req.files);
        if (Object.keys(archivos).some((linea) => !lineas[linea])) {
            return res.status(400).json({ ok: false, mensaje: 'Hay un comprobante sin forma de pago.' });
        }

        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas, HOJAS.pagos);
            const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
            const deudas = hojas[HOJAS.deudas];

            const deuda = deudas.filas.find((d) =>
                mismoId(d.id_deuda, idDeuda) && clientes.some((c) => mismoId(c.id_cliente, d.id_cliente)));
            if (!deuda) return { status: 404, mensaje: 'Deuda no encontrada.' };

            const montoTotal = aMonto(deuda.monto_total);
            const pagadoAntes = aMonto(deuda.monto_pagado);
            const pendienteAntes = redondear(montoTotal - pagadoAntes);

            if (pendienteAntes <= 0) return { status: 409, mensaje: 'La deuda ya está pagada.' };
            if (totalUsd > pendienteAntes + TOLERANCIA_USD) {
                return { status: 400, mensaje: `Los pagos superan el saldo pendiente (${pendienteAntes}).` };
            }
            // Un excedente de un céntimo por el redondeo de los bolívares se descuenta del abono
            const abono = Math.min(redondear(totalUsd), pendienteAntes);
            if (abono <= 0) return { status: 400, mensaje: 'El monto en dólares debe ser mayor que 0.' };

            const montoPagado = redondear(pagadoAntes + abono);
            const montoPendiente = redondear(montoTotal - montoPagado);
            const cambiosDeuda = {
                monto_pagado: montoPagado,
                monto_pendiente: montoPendiente,
                estado: estadoDeuda(montoPagado, montoPendiente),
            };

            comprobantes = await guardarComprobantes(archivos);

            // Primero la deuda; si luego falla el registro de los pagos, se restauran sus valores anteriores
            await actualizarFila(HOJAS.deudas, deuda._fila, cambiosDeuda, deudas.encabezados);

            let pagos;
            try {
                pagos = await agregarFilas(HOJAS.pagos, filasPago(repartirUsd(lineas, abono), {
                    ids: siguientesIds(hojas[HOJAS.pagos].filas, 'id_pago', 'PAG', lineas.length),
                    comprobantes,
                    tasa,
                    id_deuda: deuda.id_deuda,
                    id_venta: '',
                    id_cliente: deuda.id_cliente,
                    fecha_pago: fechaPago,
                    registrado_por: req.vendedor.id_vendedor,
                }), hojas[HOJAS.pagos].encabezados);
            } catch (error) {
                await actualizarFila(HOJAS.deudas, deuda._fila, {
                    monto_pagado: deuda.monto_pagado,
                    monto_pendiente: deuda.monto_pendiente,
                    estado: deuda.estado,
                }, deudas.encabezados).catch((e) => console.error('No se pudo restaurar la deuda:', e.message));
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
        if (!aTexto(pago.comprobante_url)) {
            return res.status(404).json({ ok: false, mensaje: 'Este pago no tiene comprobante.' });
        }

        const ruta = rutaComprobante(aTexto(pago.comprobante_url));
        if (!fs.existsSync(ruta)) {
            return res.status(404).json({ ok: false, mensaje: 'No se encontró el archivo del comprobante.' });
        }
        return res.sendFile(ruta);
    } catch (error) {
        return responderError(res, error, 'Error al obtener el comprobante');
    }
};

module.exports = { listarPagos, registrarPago, obtenerComprobante };
