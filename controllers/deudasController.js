const { HOJAS, leerHojas, agregarFila, siguienteId, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    redondear,
    mismoId,
    aTexto,
    clientesDelVendedor,
    formatearDeuda,
    conCobros,
    totalesPorTramo,
    detalleFactura,
    opcionesCobro,
    responderError,
} = require('../utils/cartera');
const { aNumeroOpcional, aFecha, fechaHoy } = require('../utils/valores');

// GET /bill/api/vendedores/deudas?id_cliente=&estado=
// Cada deuda trae monto_cobrado y descuento (de la hoja Pagos)
const listarDeudas = async (req, res) => {
    const idCliente = aTexto(req.query.id_cliente);
    const estado = aTexto(req.query.estado).toLowerCase();

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas, HOJAS.pagos);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);

        const deudas = hojas[HOJAS.deudas].filas
            .filter((d) => clientes.some((c) => mismoId(c.id_cliente, d.id_cliente)))
            .filter((d) => !idCliente || mismoId(d.id_cliente, idCliente))
            .filter((d) => !estado || aTexto(d.estado).toLowerCase() === estado)
            .map((d) => conCobros(formatearDeuda(d, clientes), hojas[HOJAS.pagos].filas));

        const totalPendiente = redondear(deudas.reduce((suma, d) => suma + d.monto_pendiente, 0));
        return res.json({ ok: true, total_pendiente: totalPendiente, deudas });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las deudas');
    }
};

// GET /bill/api/vendedores/deudas/:id/cobro?fecha=YYYY-MM-DD  (fecha del pago; por defecto hoy)
// Lo que se cobraría ese día: días desde la entrega, el tramo sugerido (contado, 7, 15 o 30 días), el saldo a
// cada tramo y el detalle de la factura (productos con su precio en cada tramo). Las deudas manuales (sin venta
// ni productos) no tienen tramos ni detalle (tramos: null, detalle: null).
const obtenerCobroDeuda = async (req, res) => {
    const fechaPago = req.query.fecha ? aFecha(req.query.fecha) : fechaHoy();
    if (!fechaPago) return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.productos);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
        const deuda = hojas[HOJAS.deudas].filas.find((d) =>
            mismoId(d.id_deuda, req.params.id) && clientes.some((c) => mismoId(c.id_cliente, d.id_cliente)));
        if (!deuda) return res.status(404).json({ ok: false, mensaje: 'Deuda no encontrada.' });

        const totales = totalesPorTramo(
            deuda, hojas[HOJAS.ventas].filas, hojas[HOJAS.ventasDetalle].filas, hojas[HOJAS.productos].filas);
        const detalle = detalleFactura(deuda, hojas[HOJAS.ventas].filas, hojas[HOJAS.ventasDetalle].filas, totales);
        return res.json({ ok: true, cobro: { fecha_pago: fechaPago, ...opcionesCobro(deuda, totales, fechaPago), detalle } });
    } catch (error) {
        return responderError(res, error, 'Error al calcular el cobro');
    }
};

// POST /bill/api/vendedores/deudas
// body JSON: { id_cliente, monto_total, numero_factura?, fecha_emision?, fecha_vencimiento?, observaciones? }
const crearDeuda = async (req, res) => {
    const idCliente = aTexto(req.body?.id_cliente);
    const montoTotal = aNumeroOpcional(req.body?.monto_total);
    const fechaEmision = req.body?.fecha_emision ? aFecha(req.body.fecha_emision) : fechaHoy();
    const fechaVencimiento = req.body?.fecha_vencimiento ? aFecha(req.body.fecha_vencimiento) : '';

    if (!idCliente) {
        return res.status(400).json({ ok: false, mensaje: 'El cliente es obligatorio.' });
    }
    if (!montoTotal) {
        return res.status(400).json({ ok: false, mensaje: 'El monto total debe ser un número mayor que 0.' });
    }
    if (!fechaEmision || fechaVencimiento === null) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }
    if (fechaVencimiento && fechaVencimiento < fechaEmision) {
        return res.status(400).json({ ok: false, mensaje: 'La fecha de vencimiento no puede ser anterior a la de emisión.' });
    }

    try {
        const deuda = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas);
            const cliente = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor)
                .find((c) => mismoId(c.id_cliente, idCliente));
            if (!cliente) return null;

            const { encabezados, filas } = hojas[HOJAS.deudas];
            const nueva = await agregarFila(HOJAS.deudas, {
                id_deuda: siguienteId(filas, 'id_deuda', 'DEU'),
                id_cliente: cliente.id_cliente,
                numero_factura: aTexto(req.body?.numero_factura),
                monto_total: redondear(montoTotal),
                monto_pagado: 0,
                monto_pendiente: redondear(montoTotal),
                estado: 'pendiente',
                fecha_emision: fechaEmision,
                fecha_vencimiento: fechaVencimiento,
                observaciones: aTexto(req.body?.observaciones),
            }, encabezados);
            return formatearDeuda(nueva, [cliente]);
        });

        if (!deuda) {
            return res.status(404).json({ ok: false, mensaje: 'Cliente no encontrado.' });
        }

        registrarLog(req.vendedor.id_vendedor, 'crear_deuda', {
            id_deuda: deuda.id_deuda, id_cliente: deuda.id_cliente, monto_total: deuda.monto_total,
        });
        return res.status(201).json({ ok: true, mensaje: 'Deuda registrada.', deuda });
    } catch (error) {
        return responderError(res, error, 'Error al registrar la deuda');
    }
};

module.exports = { listarDeudas, obtenerCobroDeuda, crearDeuda };
