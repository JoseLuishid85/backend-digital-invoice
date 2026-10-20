const { HOJAS, leerHojas, agregarFila, actualizarFila, siguienteId, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
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
const { aNumeroOpcional, aFecha, fechaHoy } = require('../utils/valores');

// Pago listo para responder: monto como número y nombre del cliente
const formatearPago = ({ _fila, ...pago }, clientes = []) => ({
    ...pago,
    monto: aMonto(pago.monto),
    cliente_nombre: clientes.find((c) => mismoId(c.id_cliente, pago.id_cliente))?.nombre_comercial ?? '',
});

// GET /bill/api/vendedores/pagos?id_deuda=&id_cliente=
const listarPagos = async (req, res) => {
    const idDeuda = aTexto(req.query.id_deuda);
    const idCliente = aTexto(req.query.id_cliente);

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.pagos);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);

        const pagos = hojas[HOJAS.pagos].filas
            .filter((p) => clientes.some((c) => mismoId(c.id_cliente, p.id_cliente)))
            .filter((p) => !idDeuda || mismoId(p.id_deuda, idDeuda))
            .filter((p) => !idCliente || mismoId(p.id_cliente, idCliente))
            .sort(masRecientePrimero('fecha_pago', 'id_pago'))
            .map((p) => formatearPago(p, clientes));

        return res.json({ ok: true, pagos });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pagos');
    }
};

// POST /bill/api/vendedores/pagos
// body JSON: { id_deuda, monto, metodo_pago, referencia?, fecha_pago?, comprobante_url? }
// Registra el abono y actualiza monto_pagado, monto_pendiente y estado de la deuda.
const registrarPago = async (req, res) => {
    const idDeuda = aTexto(req.body?.id_deuda);
    const monto = aNumeroOpcional(req.body?.monto);
    const metodoPago = aTexto(req.body?.metodo_pago);
    const fechaPago = req.body?.fecha_pago ? aFecha(req.body.fecha_pago) : fechaHoy();

    if (!idDeuda) {
        return res.status(400).json({ ok: false, mensaje: 'La deuda es obligatoria.' });
    }
    if (!monto) {
        return res.status(400).json({ ok: false, mensaje: 'El monto debe ser un número mayor que 0.' });
    }
    if (!metodoPago) {
        return res.status(400).json({ ok: false, mensaje: 'El método de pago es obligatorio.' });
    }
    if (!fechaPago) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }

    try {
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
            const abono = redondear(monto);

            if (pendienteAntes <= 0) return { status: 409, mensaje: 'La deuda ya está pagada.' };
            if (abono > pendienteAntes) {
                return { status: 400, mensaje: `El monto supera el saldo pendiente (${pendienteAntes}).` };
            }

            const montoPagado = redondear(pagadoAntes + abono);
            const montoPendiente = redondear(montoTotal - montoPagado);
            const cambiosDeuda = {
                monto_pagado: montoPagado,
                monto_pendiente: montoPendiente,
                estado: estadoDeuda(montoPagado, montoPendiente),
            };

            // Primero la deuda; si luego falla el registro del pago, se restauran sus valores anteriores
            await actualizarFila(HOJAS.deudas, deuda._fila, cambiosDeuda, deudas.encabezados);

            let pago;
            try {
                pago = await agregarFila(HOJAS.pagos, {
                    id_pago: siguienteId(hojas[HOJAS.pagos].filas, 'id_pago', 'PAG'),
                    id_deuda: deuda.id_deuda,
                    id_cliente: deuda.id_cliente,
                    monto: abono,
                    metodo_pago: metodoPago,
                    referencia: aTexto(req.body?.referencia),
                    fecha_pago: fechaPago,
                    registrado_por: req.vendedor.id_vendedor,
                    comprobante_url: aTexto(req.body?.comprobante_url),
                }, hojas[HOJAS.pagos].encabezados);
            } catch (error) {
                await actualizarFila(HOJAS.deudas, deuda._fila, {
                    monto_pagado: deuda.monto_pagado,
                    monto_pendiente: deuda.monto_pendiente,
                    estado: deuda.estado,
                }, deudas.encabezados).catch((e) => console.error('No se pudo restaurar la deuda:', e.message));
                throw error;
            }

            return { pago, deuda: formatearDeuda({ ...deuda, ...cambiosDeuda }, clientes) };
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        const { pago, deuda } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'registrar_pago', {
            id_pago: pago.id_pago, id_deuda: deuda.id_deuda, monto: pago.monto, monto_pendiente: deuda.monto_pendiente,
        });
        return res.status(201).json({ ok: true, mensaje: 'Pago registrado.', pago, deuda });
    } catch (error) {
        return responderError(res, error, 'Error al registrar el pago');
    }
};

module.exports = { listarPagos, registrarPago };
