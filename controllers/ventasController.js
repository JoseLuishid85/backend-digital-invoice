const {
    HOJAS,
    leerHojas,
    agregarFilas,
    actualizarFila,
    limpiarFilas,
    siguienteId,
    conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    aMonto,
    redondear,
    mismoId,
    aTexto,
    clientesDelVendedor,
    saldoCliente,
    formatearDeuda,
    formatearVenta,
    masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const { aNumeroOpcional, aFecha, fechaHoy } = require('../utils/valores');

const TIPOS_PAGO = ['contado', 'credito'];
const MAXIMO_PRODUCTOS = 50;

// Precio: número mayor o igual a 0 (puede haber productos de regalo); null si no es válido
const aPrecio = (valor) => {
    const texto = aTexto(valor).replace(',', '.');
    if (texto === '') return null;
    const n = Number(texto);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

// Valida las líneas de la venta. Devuelve { productos } o { error }
const leerProductos = (lista) => {
    if (!Array.isArray(lista) || !lista.length) return { error: 'La venta debe tener al menos un producto.' };
    if (lista.length > MAXIMO_PRODUCTOS) return { error: `La venta admite como máximo ${MAXIMO_PRODUCTOS} productos.` };

    const productos = [];
    for (const [i, linea] of lista.entries()) {
        const producto = aTexto(linea?.producto);
        const cantidad = aNumeroOpcional(linea?.cantidad);
        const precio = aPrecio(linea?.precio_unitario);
        if (!producto) return { error: `Falta el nombre del producto en la línea ${i + 1}.` };
        if (!cantidad) return { error: `La cantidad de "${producto}" debe ser mayor que 0.` };
        if (precio === null) return { error: `El precio de "${producto}" no es válido.` };
        productos.push({
            producto,
            cantidad,
            precio_unitario: redondear(precio),
            subtotal: redondear(cantidad * precio),
        });
    }
    return { productos };
};

// Vacía las filas escritas antes de un fallo (Sheets no tiene transacciones)
const deshacer = (escritas) => Promise.all(escritas.map(([hoja, filas]) =>
    limpiarFilas(hoja, filas.map((f) => f._fila))
        .catch((e) => console.error(`No se pudieron deshacer las filas de ${hoja}:`, e.message))));

// GET /bill/api/vendedores/ventas?id_cliente=&tipo_pago=&estado_entrega=&desde=&hasta=
const listarVentas = async (req, res) => {
    const idCliente = aTexto(req.query.id_cliente);
    const tipoPago = aTexto(req.query.tipo_pago).toLowerCase();
    const estadoEntrega = aTexto(req.query.estado_entrega).toLowerCase();
    const desde = aFecha(req.query.desde);
    const hasta = aFecha(req.query.hasta);

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.ventas, HOJAS.ventasDetalle);
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
            .map((v) => formatearVenta(v, clientes, detalles));

        const total = redondear(ventas.reduce((suma, v) => suma + v.monto_total, 0));
        return res.json({ ok: true, total, ventas });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las ventas');
    }
};

// POST /bill/api/vendedores/ventas
// body JSON: { id_cliente, tipo_pago, productos: [{ producto, cantidad, precio_unitario }],
//              numero_factura?, fecha_venta?, fecha_vencimiento?, entregada?, observaciones? }
// Una venta a crédito crea también su deuda y respeta el límite de crédito del cliente (0 = sin límite).
const crearVenta = async (req, res) => {
    const idCliente = aTexto(req.body?.id_cliente);
    const tipoPago = aTexto(req.body?.tipo_pago).toLowerCase() || 'contado';
    const fechaVenta = req.body?.fecha_venta ? aFecha(req.body.fecha_venta) : fechaHoy();
    const fechaVencimiento = req.body?.fecha_vencimiento ? aFecha(req.body.fecha_vencimiento) : '';
    const entregada = req.body?.entregada === true;
    const numeroFactura = aTexto(req.body?.numero_factura);
    const { productos, error: errorProductos } = leerProductos(req.body?.productos);

    if (!idCliente) {
        return res.status(400).json({ ok: false, mensaje: 'El cliente es obligatorio.' });
    }
    if (!TIPOS_PAGO.includes(tipoPago)) {
        return res.status(400).json({ ok: false, mensaje: 'El tipo de pago debe ser contado o credito.' });
    }
    if (errorProductos) {
        return res.status(400).json({ ok: false, mensaje: errorProductos });
    }
    if (!fechaVenta || fechaVencimiento === null) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }
    if (fechaVencimiento && fechaVencimiento < fechaVenta) {
        return res.status(400).json({ ok: false, mensaje: 'La fecha de vencimiento no puede ser anterior a la de la venta.' });
    }

    const montoTotal = redondear(productos.reduce((suma, p) => suma + p.subtotal, 0));
    if (montoTotal <= 0) {
        return res.status(400).json({ ok: false, mensaje: 'El total de la venta debe ser mayor que 0.' });
    }
    const esCredito = tipoPago === 'credito';

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas, HOJAS.ventas, HOJAS.ventasDetalle);
            const cliente = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor)
                .find((c) => mismoId(c.id_cliente, idCliente));
            if (!cliente) return { status: 404, mensaje: 'Cliente no encontrado.' };
            if (aTexto(cliente.estado).toLowerCase() === 'inactivo') {
                return { status: 409, mensaje: 'El cliente está inactivo.' };
            }

            if (esCredito) {
                const limite = aMonto(cliente.limite_credito);
                const disponible = redondear(limite - saldoCliente(hojas[HOJAS.deudas].filas, cliente.id_cliente));
                if (limite > 0 && montoTotal > disponible) {
                    return {
                        status: 409,
                        mensaje: `La venta supera el crédito disponible del cliente (${Math.max(disponible, 0)}).`,
                    };
                }
            }

            const idVenta = siguienteId(hojas[HOJAS.ventas].filas, 'id_venta', 'VEN');
            const escritas = [];
            try {
                const detalles = await agregarFilas(HOJAS.ventasDetalle, productos.map((p, i) => ({
                    id_detalle: `${idVenta}-${i + 1}`,
                    id_venta: idVenta,
                    ...p,
                })), hojas[HOJAS.ventasDetalle].encabezados);
                escritas.push([HOJAS.ventasDetalle, detalles]);

                let deuda = null;
                if (esCredito) {
                    [deuda] = await agregarFilas(HOJAS.deudas, [{
                        id_deuda: siguienteId(hojas[HOJAS.deudas].filas, 'id_deuda', 'DEU'),
                        id_cliente: cliente.id_cliente,
                        numero_factura: numeroFactura || idVenta,
                        monto_total: montoTotal,
                        monto_pagado: 0,
                        monto_pendiente: montoTotal,
                        estado: 'pendiente',
                        fecha_emision: fechaVenta,
                        fecha_vencimiento: fechaVencimiento,
                        observaciones: `Venta ${idVenta}`,
                    }], hojas[HOJAS.deudas].encabezados);
                    escritas.push([HOJAS.deudas, [deuda]]);
                }

                // La venta se escribe al final: si existe, sus productos y su deuda también
                const [venta] = await agregarFilas(HOJAS.ventas, [{
                    id_venta: idVenta,
                    id_vendedor: req.vendedor.id_vendedor,
                    id_cliente: cliente.id_cliente,
                    numero_factura: numeroFactura,
                    fecha_venta: fechaVenta,
                    tipo_pago: tipoPago,
                    monto_total: montoTotal,
                    id_deuda: deuda?.id_deuda ?? '',
                    estado_entrega: entregada ? 'entregada' : 'pendiente',
                    fecha_entrega: entregada ? fechaVenta : '',
                    nota_entrega: '',
                    observaciones: aTexto(req.body?.observaciones),
                }], hojas[HOJAS.ventas].encabezados);

                return {
                    venta: formatearVenta(venta, [cliente], detalles),
                    deuda: deuda && formatearDeuda(deuda, [cliente]),
                };
            } catch (error) {
                await deshacer(escritas);
                throw error;
            }
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        const { venta, deuda } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'crear_venta', {
            id_venta: venta.id_venta, id_cliente: venta.id_cliente, monto_total: venta.monto_total, tipo_pago: tipoPago,
        });
        return res.status(201).json({ ok: true, mensaje: 'Venta registrada.', venta, deuda });
    } catch (error) {
        return responderError(res, error, 'Error al registrar la venta');
    }
};

// PATCH /bill/api/vendedores/ventas/:id/entrega  (body JSON: { fecha_entrega?, nota_entrega? })
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

module.exports = { listarVentas, crearVenta, registrarEntrega };
