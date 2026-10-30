const { HOJAS, leerHojas, actualizarFila, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    redondear,
    mismoId,
    aTexto,
    clientesDelVendedor,
    formatearVenta,
    cobroDeVenta,
    masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const { aFecha, fechaHoy } = require('../utils/valores');

// Las ventas se crean al entregar un pedido (pedidosController.entregarPedido). Aquí solo se consultan.

// GET /bill/api/vendedores/ventas?id_cliente=&tipo_pago=&estado_entrega=&desde=&hasta=
// Cada venta trae cobro: { cobrado, descuento, pendiente, estado }
const listarVentas = async (req, res) => {
    const idCliente = aTexto(req.query.id_cliente);
    const tipoPago = aTexto(req.query.tipo_pago).toLowerCase();
    const estadoEntrega = aTexto(req.query.estado_entrega).toLowerCase();
    const desde = aFecha(req.query.desde);
    const hasta = aFecha(req.query.hasta);

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.deudas, HOJAS.pagos);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
        const detalles = hojas[HOJAS.ventasDetalle].filas;

        const ventas = hojas[HOJAS.ventas].filas
            .filter((v) => mismoId(v.id_vendedor, req.vendedor.id_vendedor))
            .filter((v) => !idCliente || mismoId(v.id_cliente, idCliente))
            .filter((v) => !tipoPago || aTexto(v.tipo_pago).toLowerCase() === tipoPago)
            .filter((v) => !estadoEntrega || aTexto(v.estado_entrega).toLowerCase() === estadoEntrega)
            .filter((v) => !desde || aTexto(v.fecha_venta) >= desde)
            .filter((v) => !hasta || aTexto(v.fecha_venta) <= hasta)
            .sort(masRecientePrimero('fecha_venta', 'id_venta'))
            .map((v) => ({
                ...formatearVenta(v, clientes, detalles),
                cobro: cobroDeVenta(v, hojas[HOJAS.deudas].filas, hojas[HOJAS.pagos].filas),
            }));

        const total = redondear(ventas.reduce((suma, v) => suma + v.monto_total, 0));
        return res.json({ ok: true, total, ventas });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las ventas');
    }
};

// PATCH /bill/api/vendedores/ventas/:id/entrega  (body JSON: { fecha_entrega?, nota_entrega? })
// Solo para las ventas anteriores a los pedidos que quedaron por entregar
const registrarEntrega = async (req, res) => {
    const idVenta = aTexto(req.params.id);
    const fechaEntrega = req.body?.fecha_entrega ? aFecha(req.body.fecha_entrega) : fechaHoy();
    if (!fechaEntrega) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.ventas, HOJAS.ventasDetalle);
            const { encabezados, filas } = hojas[HOJAS.ventas];
            const venta = filas.find((v) =>
                mismoId(v.id_venta, idVenta) && mismoId(v.id_vendedor, req.vendedor.id_vendedor));
            if (!venta) return { status: 404, mensaje: 'Venta no encontrada.' };
            if (aTexto(venta.estado_entrega).toLowerCase() === 'entregada') {
                return { status: 409, mensaje: 'La venta ya fue entregada.' };
            }
            if (fechaEntrega < aTexto(venta.fecha_venta)) {
                return { status: 400, mensaje: 'La fecha de entrega no puede ser anterior a la de la venta.' };
            }

            const cambios = {
                estado_entrega: 'entregada',
                fecha_entrega: fechaEntrega,
                nota_entrega: aTexto(req.body?.nota_entrega),
            };
            await actualizarFila(HOJAS.ventas, venta._fila, cambios, encabezados);

            const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
            return { venta: formatearVenta({ ...venta, ...cambios }, clientes, hojas[HOJAS.ventasDetalle].filas) };
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        registrarLog(req.vendedor.id_vendedor, 'registrar_entrega', {
            id_venta: resultado.venta.id_venta, fecha_entrega: fechaEntrega,
        });
        return res.json({ ok: true, mensaje: 'Entrega registrada.', venta: resultado.venta });
    } catch (error) {
        return responderError(res, error, 'Error al registrar la entrega');
    }
};

module.exports = { listarVentas, registrarEntrega };
