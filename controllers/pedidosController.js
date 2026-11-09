const {
    HOJAS,
    leerHojas,
    agregarFilas,
    actualizarFila,
    actualizarFilas,
    limpiarFilas,
    eliminarFila,
    exigirColumnas,
    siguienteId,
    conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    aMonto,
    redondear,
    mismoId,
    productoDeLinea,
    aTexto,
    clientesDelVendedor,
    listaVendedores,
    nombreVendedor,
    formatearDeuda,
    formatearVenta,
    ESTADOS_PEDIDO,
    formatearPedido,
    masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const { HOJAS_PRECIOS, configuracionDe, nivelPorCantidad, precioFacturaDe } = require('../utils/precios');
const { aNumeroOpcional, aFecha, fechaHoy, sumarDias } = require('../utils/valores');

const MAXIMO_PRODUCTOS = 50;
const DIGITOS_FACTURA = 6;
// Días de crédito de la deuda de una venta (fecha_vencimiento). El precio a pagar no depende de esto: se
// calcula al cobrar por los días desde la entrega (hoja Plazos).
const DIAS_VENCIMIENTO = 30;

// Siguiente número de factura (000001, 000002...): el mayor número de la hoja Ventas + 1.
// Es correlativo para todos los vendedores; los números que no son solo dígitos se ignoran.
const siguienteNumeroFactura = (ventas) => {
    const maximo = ventas.reduce((max, v) => {
        const numero = aTexto(v.numero_factura);
        return /^\d+$/.test(numero) ? Math.max(max, Number(numero)) : max;
    }, 0);
    return String(maximo + 1).padStart(DIGITOS_FACTURA, '0');
};

// Valida las líneas del pedido (producto y cantidad; el precio lo pone el catálogo). Devuelve { productos } o { error }
const leerProductos = (lista) => {
    if (!Array.isArray(lista) || !lista.length) return { error: 'El pedido debe tener al menos un producto.' };
    if (lista.length > MAXIMO_PRODUCTOS) return { error: `El pedido admite como máximo ${MAXIMO_PRODUCTOS} productos.` };

    const productos = [];
    for (const [i, linea] of lista.entries()) {
        const producto = aTexto(linea?.producto);
        const cantidad = aNumeroOpcional(linea?.cantidad);
        if (!producto) return { error: `Falta el nombre del producto en la línea ${i + 1}.` };
        if (!cantidad || cantidad < 0) return { error: `La cantidad de "${producto}" debe ser mayor que 0.` };
        productos.push({ id_producto: aTexto(linea?.id_producto), producto, cantidad });
    }
    return { productos };
};

// Busca cada línea en el catálogo (por id_producto o, si no viene, por nombre) y le pone el precio de factura del
// motor de precios: el nivel sale de la cantidad de ese producto en la línea (hoja Niveles) y el precio es el más
// alto de las dos monedas en el plazo que se factura (hoja Precios). La moneda se sabe al cobrar, y los descuentos
// por pagar antes también se hacen al cobrar. Solo se piden productos activos.
// Devuelve { productos } (con id_producto, nombre del catálogo, id_nivel, precio_unitario y subtotal) o { error }
const preciarConCatalogo = (lineas, catalogo, config) => {
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
        const nivel = nivelPorCantidad(config.niveles, linea.cantidad);
        const precio = precioFacturaDe(config, producto.id_producto, nivel.id_nivel);
        if (precio === null) {
            return { error: `"${producto.nombre}" no tiene precio para ${nivel.nombre} (${config.factura.nombre}).` };
        }
        productos.push({
            id_producto: producto.id_producto,
            producto: aTexto(producto.nombre),
            id_nivel: nivel.id_nivel,
            cantidad: linea.cantidad,
            precio_unitario: redondear(precio),
            subtotal: redondear(linea.cantidad * precio),
        });
    }
    return { productos };
};

// Columnas que escriben los pedidos y su entrega en cada hoja (se comprueban antes de escribir nada)
const COLUMNAS = {
    [HOJAS.pedidos]: ['id_pedido', 'id_vendedor', 'id_cliente', 'fecha_pedido', 'monto_total', 'estado', 'id_venta', 'observaciones'],
    [HOJAS.pedidosDetalle]: ['id_detalle', 'id_pedido', 'id_producto', 'producto', 'id_nivel', 'cantidad',
        'precio_unitario', 'subtotal'],
    [HOJAS.ventas]: ['id_venta', 'id_pedido', 'id_vendedor', 'id_cliente', 'numero_factura', 'fecha_venta', 'tipo_pago',
        'monto_total', 'id_deuda', 'estado_entrega', 'fecha_entrega', 'nota_entrega', 'observaciones'],
    [HOJAS.ventasDetalle]: ['id_detalle', 'id_venta', 'id_producto', 'producto', 'id_nivel', 'cantidad',
        'precio_unitario', 'subtotal'],
    [HOJAS.deudas]: ['id_deuda', 'id_cliente', 'numero_factura', 'monto_total', 'monto_pagado', 'monto_pendiente', 'estado',
        'fecha_emision', 'fecha_vencimiento', 'observaciones'],
};
const exigirHojas = (hojas, nombres) => nombres.forEach((n) => exigirColumnas(n, hojas[n].encabezados, COLUMNAS[n]));

const totalDe = (productos) => redondear(productos.reduce((suma, p) => suma + p.subtotal, 0));

// Filas de Pedidos_Detalle de un pedido
const filasDetalle = (idPedido, productos) => productos.map((p, i) => ({
    id_detalle: `${idPedido}-${i + 1}`,
    id_pedido: idPedido,
    ...p,
}));

// Inventario que se descuenta al emitir la factura: una entrada por producto del catálogo con lo entregado.
// { inventario: [{ fila, id_producto, producto, stock_anterior, descontado, stock }] } o { status, mensaje } si una
// línea ya no está en el catálogo o no alcanza el stock (nunca queda negativo).
const descuentoInventario = (productos, catalogo) => {
    const porProducto = new Map();
    for (const linea of productos) {
        const producto = productoDeLinea(catalogo, linea);
        if (!producto) return { status: 409, mensaje: `"${linea.producto}" ya no está en el catálogo: no se puede descontar del inventario.` };
        const clave = aTexto(producto.id_producto).toUpperCase();
        const actual = porProducto.get(clave) ?? {
            fila: producto._fila,
            id_producto: aTexto(producto.id_producto),
            producto: aTexto(producto.nombre),
            stock_anterior: aMonto(producto.stock),
            descontado: 0,
        };
        actual.descontado = redondear(actual.descontado + linea.cantidad);
        porProducto.set(clave, actual);
    }
    const inventario = [...porProducto.values()].map((i) => ({ ...i, stock: redondear(i.stock_anterior - i.descontado) }));
    const faltan = inventario.filter((i) => i.stock < 0);
    if (faltan.length) {
        return {
            status: 409,
            mensaje: `Stock insuficiente: ${faltan.map((i) => `${i.producto} (se entregan ${i.descontado}, hay ${i.stock_anterior})`).join('; ')}.`
                + ' Entrega menos o ajusta el stock en Productos.',
        };
    }
    return { inventario };
};

// Escribe el stock de cada producto (despues = true: el nuevo; false: el anterior, para deshacer)
const escribirStock = (inventario, encabezados, despues = true) => actualizarFilas(HOJAS.productos, inventario.map((i) => ({
    fila: i.fila,
    cambios: { stock: despues ? i.stock : i.stock_anterior },
})), encabezados);

// Vacía las filas escritas antes de un fallo (Sheets no tiene transacciones)
const deshacer = (escritas) => Promise.all(escritas.map(([hoja, filas]) =>
    limpiarFilas(hoja, filas.map((f) => f._fila))
        .catch((e) => console.error(`No se pudieron deshacer las filas de ${hoja}:`, e.message))));

// Lee y valida el cuerpo de crear / editar: { datos } (cliente, fecha, productos con precio) o { status, mensaje }
const leerPedido = async (body) => {
    const idCliente = aTexto(body?.id_cliente);
    const fechaPedido = body?.fecha_pedido ? aFecha(body.fecha_pedido) : fechaHoy();
    const { productos: lineas, error } = leerProductos(body?.productos);

    if (!idCliente) return { status: 400, mensaje: 'El cliente es obligatorio.' };
    if (error) return { status: 400, mensaje: error };
    if (!fechaPedido) return { status: 400, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' };

    const hojas = await leerHojas(HOJAS.productos, ...HOJAS_PRECIOS);
    const precios = preciarConCatalogo(lineas, hojas[HOJAS.productos].filas, configuracionDe(hojas));
    if (precios.error) return { status: 400, mensaje: precios.error };
    const montoTotal = totalDe(precios.productos);
    if (montoTotal <= 0) return { status: 400, mensaje: 'El total del pedido debe ser mayor que 0.' };

    return {
        datos: {
            idCliente,
            fechaPedido,
            productos: precios.productos,
            montoTotal,
            observaciones: aTexto(body?.observaciones),
        },
    };
};

// Cliente activo del vendedor logueado, o { status, mensaje }
const clienteActivo = (clientes, idCliente) => {
    const cliente = clientes.find((c) => mismoId(c.id_cliente, idCliente));
    if (!cliente) return { status: 404, mensaje: 'Cliente no encontrado.' };
    if (aTexto(cliente.estado).toLowerCase() === 'inactivo') return { status: 409, mensaje: 'El cliente está inactivo.' };
    return { cliente };
};

// Pedido pendiente del vendedor logueado (idVendedor null = de cualquier vendedor, para el administrador),
// o { status, mensaje }
const pedidoPendiente = (pedidos, idPedido, idVendedor, accion) => {
    const pedido = pedidos.find((p) => mismoId(p.id_pedido, idPedido) && (idVendedor === null || mismoId(p.id_vendedor, idVendedor)));
    if (!pedido) return { status: 404, mensaje: 'Pedido no encontrado.' };
    const estado = aTexto(pedido.estado).toLowerCase() || 'pendiente';
    if (estado !== 'pendiente') return { status: 409, mensaje: `El pedido está ${estado}: no se puede ${accion}.` };
    return { pedido };
};

const responder = (res, resultado) => res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

// GET /bill/api/vendedores/pedidos?estado=&id_cliente=&desde=&hasta=
const listarPedidos = async (req, res) => {
    const estado = aTexto(req.query.estado).toLowerCase();
    const idCliente = aTexto(req.query.id_cliente);
    const desde = aFecha(req.query.desde);
    const hasta = aFecha(req.query.hasta);

    if (estado && !ESTADOS_PEDIDO.includes(estado)) {
        return res.status(400).json({ ok: false, mensaje: `El estado debe ser ${ESTADOS_PEDIDO.join(', ')}.` });
    }

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.pedidos, HOJAS.pedidosDetalle);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
        const detalles = hojas[HOJAS.pedidosDetalle].filas;

        const pedidos = hojas[HOJAS.pedidos].filas
            .filter((p) => mismoId(p.id_vendedor, req.vendedor.id_vendedor))
            .filter((p) => !idCliente || mismoId(p.id_cliente, idCliente))
            .filter((p) => !desde || aTexto(p.fecha_pedido) >= desde)
            .filter((p) => !hasta || aTexto(p.fecha_pedido) <= hasta)
            .sort(masRecientePrimero('fecha_pedido', 'id_pedido'))
            .map((p) => formatearPedido(p, clientes, detalles))
            .filter((p) => !estado || p.estado === estado);

        const total = redondear(pedidos.reduce((suma, p) => suma + p.monto_total, 0));
        return res.json({ ok: true, total, pedidos });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pedidos');
    }
};

// GET /bill/api/vendedores/admin/pedidos?estado=&id_vendedor=
// Pedidos de todos los vendedores (o de uno), con vendedor_nombre y la lista de vendedores para el filtro.
const listarPedidosAdmin = async (req, res) => {
    const estado = aTexto(req.query.estado).toLowerCase();
    const idVendedor = aTexto(req.query.id_vendedor);

    if (estado && !ESTADOS_PEDIDO.includes(estado)) {
        return res.status(400).json({ ok: false, mensaje: `El estado debe ser ${ESTADOS_PEDIDO.join(', ')}.` });
    }

    try {
        const hojas = await leerHojas(HOJAS.usuarios, HOJAS.clientes, HOJAS.pedidos, HOJAS.pedidosDetalle, HOJAS.productos);
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const clientes = hojas[HOJAS.clientes].filas;
        const detalles = hojas[HOJAS.pedidosDetalle].filas;
        const catalogo = hojas[HOJAS.productos].filas;
        // Stock actual de cada línea (null si el producto ya no está en el catálogo), para la emisión de la factura
        const conStock = (pedido) => ({
            ...pedido,
            productos: pedido.productos.map((l) => {
                const producto = productoDeLinea(catalogo, l);
                return { ...l, stock: producto ? aMonto(producto.stock) : null };
            }),
        });

        const pedidos = hojas[HOJAS.pedidos].filas
            .filter((p) => !idVendedor || mismoId(p.id_vendedor, idVendedor))
            .sort(masRecientePrimero('fecha_pedido', 'id_pedido'))
            .map((p) => ({ ...conStock(formatearPedido(p, clientes, detalles)), vendedor_nombre: nombreVendedor(vendedores, p.id_vendedor) }))
            .filter((p) => !estado || p.estado === estado);

        const total = redondear(pedidos.reduce((suma, p) => suma + p.monto_total, 0));
        return res.json({ ok: true, total, pedidos, vendedores });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pedidos');
    }
};

// GET /bill/api/vendedores/pedidos/:id
const obtenerPedido = async (req, res) => {
    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.pedidos, HOJAS.pedidosDetalle);
        const pedido = hojas[HOJAS.pedidos].filas.find((p) =>
            mismoId(p.id_pedido, req.params.id) && mismoId(p.id_vendedor, req.vendedor.id_vendedor));
        if (!pedido) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado.' });

        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
        return res.json({ ok: true, pedido: formatearPedido(pedido, clientes, hojas[HOJAS.pedidosDetalle].filas) });
    } catch (error) {
        return responderError(res, error, 'Error al obtener el pedido');
    }
};

// POST /bill/api/vendedores/pedidos  (JSON: { id_cliente, productos: [{ producto, cantidad, id_producto? }],
//                                    fecha_pedido?, observaciones? })
// Sin forma de pago ni moneda: el pedido solo reserva lo que pidió el cliente, al precio de factura del nivel
// de cada línea.
// Pasa a venta (con su número de factura y su deuda) cuando se entrega.
const crearPedido = async (req, res) => {
    try {
        const leido = await leerPedido(req.body);
        if (leido.status) return responder(res, leido);
        const { idCliente, fechaPedido, productos, montoTotal, observaciones } = leido.datos;

        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.pedidos, HOJAS.pedidosDetalle);
            exigirHojas(hojas, [HOJAS.pedidos, HOJAS.pedidosDetalle]);
            const { cliente, ...problema } = clienteActivo(
                clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor), idCliente);
            if (!cliente) return problema;

            const idPedido = siguienteId(hojas[HOJAS.pedidos].filas, 'id_pedido', 'PED');
            const detalles = await agregarFilas(
                HOJAS.pedidosDetalle, filasDetalle(idPedido, productos), hojas[HOJAS.pedidosDetalle].encabezados);
            try {
                // El pedido se escribe al final: si existe, sus productos también
                const [pedido] = await agregarFilas(HOJAS.pedidos, [{
                    id_pedido: idPedido,
                    id_vendedor: req.vendedor.id_vendedor,
                    id_cliente: cliente.id_cliente,
                    fecha_pedido: fechaPedido,
                    monto_total: montoTotal,
                    estado: 'pendiente',
                    id_venta: '',
                    observaciones,
                }], hojas[HOJAS.pedidos].encabezados);
                return { pedido: formatearPedido(pedido, [cliente], detalles) };
            } catch (error) {
                await deshacer([[HOJAS.pedidosDetalle, detalles]]);
                throw error;
            }
        });
        if (resultado.status) return responder(res, resultado);

        const { pedido } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'crear_pedido', {
            id_pedido: pedido.id_pedido, id_cliente: pedido.id_cliente, monto_total: pedido.monto_total,
        });
        return res.status(201).json({ ok: true, mensaje: 'Pedido registrado.', pedido });
    } catch (error) {
        return responderError(res, error, 'Error al registrar el pedido');
    }
};

// PUT /bill/api/vendedores/pedidos/:id  (mismo cuerpo que crear; solo pedidos pendientes)
// Reemplaza el cliente, la fecha, los productos (con el nivel y el precio actuales) y las observaciones.
const actualizarPedido = async (req, res) => {
    try {
        const leido = await leerPedido(req.body);
        if (leido.status) return responder(res, leido);
        const { idCliente, fechaPedido, productos, montoTotal, observaciones } = leido.datos;

        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.pedidos, HOJAS.pedidosDetalle);
            const { pedido, ...problemaPedido } = pedidoPendiente(
                hojas[HOJAS.pedidos].filas, req.params.id, req.vendedor.id_vendedor, 'editar');
            if (!pedido) return problemaPedido;
            const { cliente, ...problemaCliente } = clienteActivo(
                clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor), idCliente);
            if (!cliente) return problemaCliente;

            // Primero las líneas nuevas; las anteriores se borran al final (de abajo arriba, porque las de
            // abajo suben al borrar una fila). Si falla antes de borrar, el pedido queda como estaba.
            const anteriores = hojas[HOJAS.pedidosDetalle].filas.filter((d) => mismoId(d.id_pedido, pedido.id_pedido));
            const detalles = await agregarFilas(
                HOJAS.pedidosDetalle, filasDetalle(pedido.id_pedido, productos), hojas[HOJAS.pedidosDetalle].encabezados);
            const cambios = {
                id_cliente: cliente.id_cliente,
                fecha_pedido: fechaPedido,
                monto_total: montoTotal,
                observaciones,
            };
            try {
                await actualizarFila(HOJAS.pedidos, pedido._fila, cambios, hojas[HOJAS.pedidos].encabezados);
            } catch (error) {
                await deshacer([[HOJAS.pedidosDetalle, detalles]]);
                throw error;
            }
            for (const fila of anteriores.map((d) => d._fila).sort((a, b) => b - a)) {
                await eliminarFila(HOJAS.pedidosDetalle, fila);
            }
            return { pedido: formatearPedido({ ...pedido, ...cambios }, [cliente], detalles) };
        });
        if (resultado.status) return responder(res, resultado);

        const { pedido } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'editar_pedido', {
            id_pedido: pedido.id_pedido, id_cliente: pedido.id_cliente, monto_total: pedido.monto_total,
        });
        return res.json({ ok: true, mensaje: 'Pedido actualizado.', pedido });
    } catch (error) {
        return responderError(res, error, 'Error al actualizar el pedido');
    }
};

// PATCH /bill/api/vendedores/pedidos/:id/anular  (body JSON: { motivo? }; solo pedidos pendientes)
// No borra la fila: queda con estado anulado (el motivo se agrega a las observaciones)
const anularPedido = async (req, res) => {
    const motivo = aTexto(req.body?.motivo);

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.pedidos, HOJAS.pedidosDetalle);
            const { pedido, ...problema } = pedidoPendiente(
                hojas[HOJAS.pedidos].filas, req.params.id, req.vendedor.id_vendedor, 'anular');
            if (!pedido) return problema;

            const cambios = { estado: 'anulado' };
            if (motivo) {
                cambios.observaciones = [aTexto(pedido.observaciones), `Anulado: ${motivo}`].filter(Boolean).join(' · ');
            }
            await actualizarFila(HOJAS.pedidos, pedido._fila, cambios, hojas[HOJAS.pedidos].encabezados);

            const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
            return { pedido: formatearPedido({ ...pedido, ...cambios }, clientes, hojas[HOJAS.pedidosDetalle].filas) };
        });
        if (resultado.status) return responder(res, resultado);

        registrarLog(req.vendedor.id_vendedor, 'anular_pedido', { id_pedido: resultado.pedido.id_pedido, motivo });
        return res.json({ ok: true, mensaje: 'Pedido anulado.', pedido: resultado.pedido });
    } catch (error) {
        return responderError(res, error, 'Error al anular el pedido');
    }
};

// POST /bill/api/vendedores/admin/pedidos/:id/entrega  (solo el administrador emite la factura)
// body JSON: { fecha_entrega?, nota_entrega?, productos?: [{ id_detalle, cantidad }] }
// Convierte el pedido en venta. productos indica cuánto se entregó de cada línea del pedido (0 = no se entregó;
// nunca más de lo pedido); sin productos se entrega todo. La venta lleva el número de factura correlativo, los
// precios y niveles del pedido (aunque se entregue menos, no cambia de nivel) y siempre una deuda por el total en
// dólares, que vence a los DIAS_VENCIMIENTO días. Lo entregado se descuenta del stock de Productos; si no alcanza
// para algún producto responde 409 y no escribe nada.
const entregarPedido = async (req, res) => {
    const fechaEntrega = req.body?.fecha_entrega ? aFecha(req.body.fecha_entrega) : fechaHoy();
    const entregados = req.body?.productos;
    if (!fechaEntrega) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }
    if (entregados !== undefined && !Array.isArray(entregados)) {
        return res.status(400).json({ ok: false, mensaje: 'productos debe ser una lista de { id_detalle, cantidad }.' });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(
                HOJAS.clientes, HOJAS.pedidos, HOJAS.pedidosDetalle, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.deudas,
                HOJAS.productos,
            );
            exigirHojas(hojas, [HOJAS.pedidos, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.deudas]);
            exigirColumnas(HOJAS.productos, hojas[HOJAS.productos].encabezados, ['id_producto', 'stock']);
            const { pedido, ...problema } = pedidoPendiente(hojas[HOJAS.pedidos].filas, req.params.id, null, 'facturar');
            if (!pedido) return problema;
            // La venta y el cliente son del vendedor que tomó el pedido
            const idVendedor = aTexto(pedido.id_vendedor);
            if (fechaEntrega < aTexto(pedido.fecha_pedido)) {
                return { status: 400, mensaje: 'La fecha de entrega no puede ser anterior a la del pedido.' };
            }
            const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, idVendedor);
            const cliente = clientes.find((c) => mismoId(c.id_cliente, pedido.id_cliente));
            if (!cliente) return { status: 404, mensaje: 'El cliente del pedido no existe.' };

            // Cantidades entregadas de cada línea del pedido, al precio del pedido
            const pedidas = formatearPedido(pedido, clientes, hojas[HOJAS.pedidosDetalle].filas).productos;
            const productos = [];
            for (const linea of pedidas) {
                const indicada = entregados?.find((e) => mismoId(e?.id_detalle, linea.id_detalle));
                const cantidad = entregados ? (aNumeroOpcional(indicada?.cantidad) ?? 0) : linea.cantidad;
                if (cantidad < 0) return { status: 400, mensaje: `La cantidad de "${linea.producto}" no puede ser negativa.` };
                if (cantidad > linea.cantidad) {
                    return { status: 400, mensaje: `No se pueden entregar más de ${linea.cantidad} de "${linea.producto}".` };
                }
                if (cantidad > 0) {
                    productos.push({
                        id_producto: linea.id_producto,
                        producto: linea.producto,
                        id_nivel: linea.id_nivel,
                        cantidad,
                        precio_unitario: linea.precio_unitario,
                        subtotal: redondear(cantidad * linea.precio_unitario),
                    });
                }
            }
            const montoTotal = totalDe(productos);
            if (!productos.length || montoTotal <= 0) {
                return { status: 400, mensaje: 'Indica al menos un producto entregado. Si no se entregó nada, anula el pedido.' };
            }
            const { inventario, ...sinStock } = descuentoInventario(productos, hojas[HOJAS.productos].filas);
            if (!inventario) return sinStock;

            const idVenta = siguienteId(hojas[HOJAS.ventas].filas, 'id_venta', 'VEN');
            const numeroFactura = siguienteNumeroFactura(hojas[HOJAS.ventas].filas);
            const notaEntrega = aTexto(req.body?.nota_entrega);
            const escritas = [];
            let stockEscrito = false;
            try {
                const detalles = await agregarFilas(HOJAS.ventasDetalle, productos.map((p, i) => ({
                    id_detalle: `${idVenta}-${i + 1}`,
                    id_venta: idVenta,
                    ...p,
                })), hojas[HOJAS.ventasDetalle].encabezados);
                escritas.push([HOJAS.ventasDetalle, detalles]);

                const [deuda] = await agregarFilas(HOJAS.deudas, [{
                    id_deuda: siguienteId(hojas[HOJAS.deudas].filas, 'id_deuda', 'DEU'),
                    id_cliente: cliente.id_cliente,
                    numero_factura: numeroFactura,
                    monto_total: montoTotal,
                    monto_pagado: 0,
                    monto_pendiente: montoTotal,
                    estado: 'pendiente',
                    fecha_emision: fechaEntrega,
                    fecha_vencimiento: sumarDias(fechaEntrega, DIAS_VENCIMIENTO),
                    observaciones: `Venta ${idVenta} (pedido ${pedido.id_pedido})`,
                }], hojas[HOJAS.deudas].encabezados);
                escritas.push([HOJAS.deudas, [deuda]]);

                const [venta] = await agregarFilas(HOJAS.ventas, [{
                    id_venta: idVenta,
                    id_pedido: pedido.id_pedido,
                    id_vendedor: idVendedor,
                    id_cliente: cliente.id_cliente,
                    numero_factura: numeroFactura,
                    fecha_venta: fechaEntrega,
                    tipo_pago: 'credito',
                    plazo_dias: '',
                    monto_total: montoTotal,
                    tasa_bcv: '',
                    monto_total_bs: '',
                    id_deuda: deuda.id_deuda,
                    estado_entrega: 'entregada',
                    fecha_entrega: fechaEntrega,
                    nota_entrega: notaEntrega,
                    observaciones: aTexto(pedido.observaciones),
                }], hojas[HOJAS.ventas].encabezados);
                escritas.push([HOJAS.ventas, [venta]]);

                await escribirStock(inventario, hojas[HOJAS.productos].encabezados);
                stockEscrito = true;

                // El pedido se marca al final: si dice entregado, su venta y su deuda existen
                const cambios = { estado: 'entregado', id_venta: idVenta };
                await actualizarFila(HOJAS.pedidos, pedido._fila, cambios, hojas[HOJAS.pedidos].encabezados);

                return {
                    pedido: formatearPedido({ ...pedido, ...cambios }, clientes, hojas[HOJAS.pedidosDetalle].filas),
                    venta: formatearVenta(venta, [cliente], detalles),
                    deuda: formatearDeuda(deuda, [cliente]),
                    inventario: inventario.map(({ fila, ...i }) => i),
                };
            } catch (error) {
                await deshacer(escritas);
                if (stockEscrito) {
                    await escribirStock(inventario, hojas[HOJAS.productos].encabezados, false)
                        .catch((e) => console.error('No se pudo devolver el stock:', e.message));
                }
                throw error;
            }
        });
        if (resultado.status) return responder(res, resultado);

        const { pedido, venta, deuda, inventario } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'entregar_pedido', {
            id_pedido: pedido.id_pedido,
            id_vendedor: pedido.id_vendedor,
            id_venta: venta.id_venta,
            id_deuda: deuda.id_deuda,
            monto_total: venta.monto_total,
            fecha_entrega: fechaEntrega,
            inventario: inventario.map((i) => ({ id_producto: i.id_producto, descontado: i.descontado, stock: i.stock })),
        });
        return res.status(201).json({
            ok: true,
            mensaje: `Factura ${venta.numero_factura} emitida. Se descontó del inventario.`,
            pedido,
            venta,
            deuda,
            inventario,
        });
    } catch (error) {
        return responderError(res, error, 'Error al registrar la entrega del pedido');
    }
};

module.exports = { listarPedidos, listarPedidosAdmin, obtenerPedido, crearPedido, actualizarPedido, anularPedido, entregarPedido };
