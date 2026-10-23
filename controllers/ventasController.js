const {
    HOJAS,
    leerHoja,
    leerHojas,
    agregarFilas,
    actualizarFila,
    limpiarFilas,
    siguienteId,
    siguientesIds,
    conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const { tasaDelDia, aBolivares } = require('../utils/tasaDolar');
const { TOLERANCIA_USD, leerDatos, leerLineasPago, repartirUsd, filasPago, formatearPago } = require('../utils/cobros');
const { comprobantesPorLinea, guardarComprobantes, borrarComprobantes } = require('../utils/comprobantes');
const {
    aMonto,
    redondear,
    PLAZOS_CREDITO,
    precioSegunPlazo,
    mismoId,
    aTexto,
    clientesDelVendedor,
    saldoCliente,
    formatearDeuda,
    formatearVenta,
    masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const { aNumeroOpcional, aFecha, fechaHoy, sumarDias } = require('../utils/valores');

const TIPOS_PAGO = ['contado', 'credito'];
const MAXIMO_PRODUCTOS = 50;
const DIGITOS_FACTURA = 6;

// Siguiente número de factura (000001, 000002...): el mayor número de la hoja Ventas + 1.
// Es correlativo para todos los vendedores; los números que no son solo dígitos se ignoran.
const siguienteNumeroFactura = (ventas) => {
    const maximo = ventas.reduce((max, v) => {
        const numero = aTexto(v.numero_factura);
        return /^\d+$/.test(numero) ? Math.max(max, Number(numero)) : max;
    }, 0);
    return String(maximo + 1).padStart(DIGITOS_FACTURA, '0');
};

// Valida las líneas de la venta (producto y cantidad; el precio lo pone el catálogo). Devuelve { productos } o { error }
const leerProductos = (lista) => {
    if (!Array.isArray(lista) || !lista.length) return { error: 'La venta debe tener al menos un producto.' };
    if (lista.length > MAXIMO_PRODUCTOS) return { error: `La venta admite como máximo ${MAXIMO_PRODUCTOS} productos.` };

    const productos = [];
    for (const [i, linea] of lista.entries()) {
        const producto = aTexto(linea?.producto);
        const cantidad = aNumeroOpcional(linea?.cantidad);
        if (!producto) return { error: `Falta el nombre del producto en la línea ${i + 1}.` };
        if (!cantidad) return { error: `La cantidad de "${producto}" debe ser mayor que 0.` };
        productos.push({ id_producto: aTexto(linea?.id_producto), producto, cantidad });
    }
    return { productos };
};

// Busca cada línea en el catálogo (por id_producto o, si no viene, por nombre) y le pone el precio del
// catálogo para contado o el plazo: el vendedor no puede cambiarlo. Solo se venden productos activos del
// catálogo. Devuelve { productos } (con id_producto, nombre del catálogo, precio_unitario y subtotal) o { error }
const preciarConCatalogo = (lineas, catalogo, plazo) => {
    const productos = [];
    for (const linea of lineas) {
        const nombre = linea.producto.toLowerCase();
        const producto = linea.id_producto
            ? catalogo.find((p) => mismoId(p.id_producto, linea.id_producto))
            : catalogo.find((p) => aTexto(p.nombre).toLowerCase() === nombre);
        if (!producto) return { error: `"${linea.producto}" no está en el catálogo de productos.` };
        if (aTexto(producto.estado).toLowerCase() === 'inactivo') {
            return { error: `El producto "${producto.nombre}" está inactivo.` };
        }
        const precio = redondear(precioSegunPlazo(producto, plazo));
        productos.push({
            id_producto: producto.id_producto,
            producto: aTexto(producto.nombre),
            cantidad: linea.cantidad,
            precio_unitario: precio,
            subtotal: redondear(linea.cantidad * precio),
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
// multipart: datos = JSON { id_cliente, tipo_pago, plazo_dias?, productos: [{ producto, cantidad, id_producto? }],
//              pagos?, fecha_venta?, entregada?, observaciones? } + comprobante_<n> (o el JSON como body)
// El número de factura se asigna solo (000001, 000002...); un numero_factura enviado se ignora.
// Una venta a crédito lleva plazo_dias (7, 15 o 30), crea también su deuda con vencimiento a ese plazo
// y respeta el límite de crédito del cliente (0 = sin límite). Los precios salen del catálogo según contado o
// plazo (un precio_unitario enviado se ignora). Los montos son en dólares. Solo la venta de contado guarda
// la tasa del día y el total en bolívares: una deuda se cobra en dólares y, si se paga en bolívares, a la tasa
// del día del pago, así que guardar su equivalente de hoy no serviría. Una venta de contado se cobra con una o varias formas de
// pago (pagos, en la moneda de cada método) que deben sumar el total; cada una es una fila de Pagos con id_venta.
const crearVenta = async (req, res) => {
    const datos = leerDatos(req);
    if (!datos) {
        return res.status(400).json({ ok: false, mensaje: 'Los datos de la venta no son un JSON válido.' });
    }
    const idCliente = aTexto(datos.id_cliente);
    const tipoPago = aTexto(datos.tipo_pago).toLowerCase() || 'contado';
    const fechaVenta = datos.fecha_venta ? aFecha(datos.fecha_venta) : fechaHoy();
    const plazoDias = Number(datos.plazo_dias);
    const entregada = datos.entregada === true;
    const { productos: lineas, error: errorProductos } = leerProductos(datos.productos);

    if (!idCliente) {
        return res.status(400).json({ ok: false, mensaje: 'El cliente es obligatorio.' });
    }
    if (!TIPOS_PAGO.includes(tipoPago)) {
        return res.status(400).json({ ok: false, mensaje: 'El tipo de pago debe ser contado o credito.' });
    }
    if (errorProductos) {
        return res.status(400).json({ ok: false, mensaje: errorProductos });
    }
    if (!fechaVenta) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }
    if (tipoPago === 'credito' && !PLAZOS_CREDITO.includes(plazoDias)) {
        return res.status(400).json({ ok: false, mensaje: `El plazo de crédito debe ser de ${PLAZOS_CREDITO.join(', ')} días.` });
    }

    const esCredito = tipoPago === 'credito';

    // Precios del catálogo (fuera del bloqueo: el total hace falta para validar el cobro)
    let productos;
    try {
        const precios = preciarConCatalogo(lineas, (await leerHoja(HOJAS.productos)).filas, esCredito ? plazoDias : null);
        if (precios.error) return res.status(400).json({ ok: false, mensaje: precios.error });
        productos = precios.productos;
    } catch (error) {
        return responderError(res, error, 'Error al leer el catálogo de productos');
    }

    const montoTotal = redondear(productos.reduce((suma, p) => suma + p.subtotal, 0));
    if (montoTotal <= 0) {
        return res.status(400).json({ ok: false, mensaje: 'El total de la venta debe ser mayor que 0.' });
    }
    const fechaVencimiento = esCredito ? sumarDias(fechaVenta, plazoDias) : '';

    // Solo contado usa la tasa (a crédito se cobra a la tasa del día del pago). Fuera del bloqueo: puede
    // consultar el BCV y guarda la tasa con su propio bloqueo. Sin tasa la venta se registra igual, solo en dólares.
    const tasa = esCredito ? null : await tasaDelDia(fechaVenta).catch((error) => {
        console.error(`No se pudo obtener la tasa del ${fechaVenta}:`, error.message);
        return null;
    });

    // Contado: las formas de pago deben cubrir el total (los bolívares se convierten con la tasa del día)
    let cobro = null;
    if (!esCredito) {
        const { lineas, totalUsd, error } = leerLineasPago(datos.pagos, tasa?.tasa);
        if (error) return res.status(400).json({ ok: false, mensaje: error });
        if (Math.abs(totalUsd - montoTotal) > TOLERANCIA_USD) {
            const diferencia = redondear(montoTotal - totalUsd);
            return res.status(400).json({
                ok: false,
                mensaje: diferencia > 0
                    ? `Faltan ${diferencia} $ por cobrar para completar el total de la venta.`
                    : `Los pagos superan el total de la venta por ${-diferencia} $.`,
            });
        }
        cobro = repartirUsd(lineas, montoTotal);
    }
    const archivos = comprobantesPorLinea(req.files);
    if (Object.keys(archivos).some((linea) => !cobro?.[linea])) {
        return res.status(400).json({ ok: false, mensaje: 'Hay un comprobante sin forma de pago.' });
    }

    let comprobantes = {};
    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(
                HOJAS.clientes, HOJAS.deudas, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.pagos,
            );
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
            const numeroFactura = siguienteNumeroFactura(hojas[HOJAS.ventas].filas);
            const escritas = [];
            comprobantes = await guardarComprobantes(archivos);
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
                        numero_factura: numeroFactura,
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

                let pagos = [];
                if (cobro) {
                    pagos = await agregarFilas(HOJAS.pagos, filasPago(cobro, {
                        ids: siguientesIds(hojas[HOJAS.pagos].filas, 'id_pago', 'PAG', cobro.length),
                        comprobantes,
                        tasa: tasa?.tasa ?? '',
                        id_deuda: '',
                        id_venta: idVenta,
                        id_cliente: cliente.id_cliente,
                        fecha_pago: fechaVenta,
                        registrado_por: req.vendedor.id_vendedor,
                    }), hojas[HOJAS.pagos].encabezados);
                    escritas.push([HOJAS.pagos, pagos]);
                }

                // La venta se escribe al final: si existe, sus productos y su deuda también
                const [venta] = await agregarFilas(HOJAS.ventas, [{
                    id_venta: idVenta,
                    id_vendedor: req.vendedor.id_vendedor,
                    id_cliente: cliente.id_cliente,
                    numero_factura: numeroFactura,
                    fecha_venta: fechaVenta,
                    tipo_pago: tipoPago,
                    plazo_dias: esCredito ? plazoDias : '',
                    monto_total: montoTotal,
                    tasa_bcv: tasa?.tasa ?? '',
                    monto_total_bs: aBolivares(montoTotal, tasa?.tasa) ?? '',
                    id_deuda: deuda?.id_deuda ?? '',
                    estado_entrega: entregada ? 'entregada' : 'pendiente',
                    fecha_entrega: entregada ? fechaVenta : '',
                    nota_entrega: '',
                    observaciones: aTexto(datos.observaciones),
                }], hojas[HOJAS.ventas].encabezados);

                return {
                    venta: formatearVenta(venta, [cliente], detalles),
                    deuda: deuda && formatearDeuda(deuda, [cliente]),
                    pagos: pagos.map((p) => formatearPago(p, [cliente])),
                };
            } catch (error) {
                await deshacer(escritas);
                throw error;
            }
        });

        if (resultado.status) {
            await borrarComprobantes(Object.values(comprobantes));
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        const { venta, deuda, pagos } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'crear_venta', {
            id_venta: venta.id_venta,
            id_cliente: venta.id_cliente,
            monto_total: venta.monto_total,
            tipo_pago: tipoPago,
            pagos: pagos.map((p) => ({ id_pago: p.id_pago, metodo_pago: p.metodo_pago, monto: p.monto, monto_bs: p.monto_bs })),
        });
        return res.status(201).json({ ok: true, mensaje: 'Venta registrada.', venta, deuda, pagos });
    } catch (error) {
        await borrarComprobantes(Object.values(comprobantes));
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
