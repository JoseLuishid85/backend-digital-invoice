const { fechaHoy, diasEntre } = require('./valores');

// Montos leídos de Sheets: número, texto con coma decimal o vacío (= 0)
const aMonto = (valor) => {
    if (typeof valor === 'number') return valor;
    const n = Number(String(valor ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

// Igual que aMonto, pero una celda vacía o inválida es null (p. ej. un precio por plazo sin definir)
const aMontoOpcional = (valor) => {
    if (typeof valor === 'number') return valor;
    const texto = String(valor ?? '').trim().replace(',', '.');
    const n = Number(texto);
    return texto !== '' && Number.isFinite(n) ? n : null;
};

const redondear = (n) => Math.round(n * 100) / 100;

// Suma de un campo de monto en una lista de filas, redondeada a centavos
const sumar = (lista, campo) => redondear(lista.reduce((suma, item) => suma + aMonto(item[campo]), 0));

// Plazos de crédito (días). Precios de la hoja Productos:
// - precio: el de factura, el más alto; es el que lleva el pedido
// - precio_contado: el más bajo, si el cliente paga de contado
// - precio_7, precio_15, precio_30: si paga a esos días
const PLAZOS_CREDITO = [7, 15, 30];
const columnaTramo = (tramo) => (tramo ? `precio_${tramo}` : 'precio_contado');

const precioFactura = (producto) => aMonto(producto.precio);

// Precio de un producto al cobrar en un tramo (0 = contado); sin precio para ese tramo, el de factura (sin descuento)
const precioTramo = (producto, tramo) => aMontoOpcional(producto[columnaTramo(tramo)]) ?? precioFactura(producto);

// Tramos del cobro: 0 = contado y los plazos de crédito. Precio que corresponde según los días desde la entrega:
// el mismo día, precio_contado; de 1 a 7 días, precio_7; de 8 a 15, precio_15; de 16 en adelante, precio_30.
// El vendedor puede elegir otro (p. ej. contado si fue él quien llegó a cobrar días después).
const TRAMOS_COBRO = [0, ...PLAZOS_CREDITO];
const tramoPorDias = (dias) => (dias <= 0 ? 0 : PLAZOS_CREDITO.find((plazo) => dias <= plazo) ?? Math.max(...PLAZOS_CREDITO));

// Compara IDs ignorando mayúsculas y espacios (en la hoja se escriben a mano)
const mismoId = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

// Texto opcional recortado; '' si no viene
const aTexto = (valor) => (valor === null || valor === undefined ? '' : String(valor).trim());

// Niveles de acceso de la columna nivel_acceso de la hoja Usuarios
const NIVELES = { vendedor: 'Vendedor', administrador: 'Administrador' };

const esAdministrador = (nivel) => aTexto(nivel).toLowerCase() === NIVELES.administrador.toLowerCase();

// Usuario activo: estado vacío o "activo" (sin importar mayúsculas)
const usuarioActivo = (usuario) => {
    const estado = aTexto(usuario.estado).toLowerCase();
    return estado === '' || estado === 'activo';
};

// Vendedores de la hoja Usuarios (todos los que no son administradores), ordenados por nombre
const listaVendedores = (usuarios) => usuarios
    .filter((u) => !esAdministrador(u.nivel_acceso))
    .map((u) => ({
        id_vendedor: aTexto(u.id_usuario),
        nombre: aTexto(u.nombre) || aTexto(u.email),
        activo: usuarioActivo(u),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

const nombreVendedor = (vendedores, idVendedor) =>
    vendedores.find((v) => mismoId(v.id_vendedor, idVendedor))?.nombre ?? aTexto(idVendedor);

// Fecha y hora local: YYYY-MM-DD HH:mm:ss
const fechaHoraActual = () => {
    const ahora = new Date();
    const hora = [ahora.getHours(), ahora.getMinutes(), ahora.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join(':');
    return `${fechaHoy()} ${hora}`;
};

// Clientes que pertenecen al vendedor logueado
const clientesDelVendedor = (clientes, idVendedor) => clientes.filter((c) => mismoId(c.id_vendedor, idVendedor));

// Saldo pendiente de un cliente según sus deudas
const saldoCliente = (deudas, idCliente) => redondear(deudas
    .filter((d) => mismoId(d.id_cliente, idCliente))
    .reduce((suma, d) => suma + aMonto(d.monto_pendiente), 0));

// Estados de una deuda: pendiente (sin abonos), parcial (con abonos) y pagada
const estadoDeuda = (montoPagado, montoPendiente) => {
    if (montoPendiente <= 0) return 'pagada';
    return montoPagado > 0 ? 'parcial' : 'pendiente';
};

// Deuda lista para responder: montos como número, nombre del cliente y si está vencida
const formatearDeuda = ({ _fila, ...deuda }, clientes = []) => {
    const cliente = clientes.find((c) => mismoId(c.id_cliente, deuda.id_cliente));
    const montoPendiente = aMonto(deuda.monto_pendiente);
    const fechaVencimiento = aTexto(deuda.fecha_vencimiento);

    return {
        ...deuda,
        monto_total: aMonto(deuda.monto_total),
        monto_pagado: aMonto(deuda.monto_pagado),
        monto_pendiente: montoPendiente,
        cliente_nombre: cliente?.nombre_comercial ?? '',
        // Calculado: con saldo y vencimiento pasado (las fechas YYYY-MM-DD se comparan como texto)
        vencida: montoPendiente > 0 && !!fechaVencimiento && fechaVencimiento < fechaHoy(),
    };
};

// Líneas de detalle (Ventas_Detalle o Pedidos_Detalle) de un documento, con los montos como número
const lineasDe = (detalles, campo, id) => detalles
    .filter((d) => mismoId(d[campo], id))
    .map(({ _fila, ...d }) => ({
        ...d,
        cantidad: aMonto(d.cantidad),
        precio_unitario: aMonto(d.precio_unitario),
        subtotal: aMonto(d.subtotal),
    }));

// Venta lista para responder: montos como número, nombre del cliente y sus productos
const formatearVenta = ({ _fila, ...venta }, clientes = [], detalles = []) => {
    const cliente = clientes.find((c) => mismoId(c.id_cliente, venta.id_cliente));
    return {
        ...venta,
        monto_total: aMonto(venta.monto_total),
        plazo_dias: aMontoOpcional(venta.plazo_dias),
        tasa_bcv: aMontoOpcional(venta.tasa_bcv),
        monto_total_bs: aMontoOpcional(venta.monto_total_bs),
        cliente_nombre: cliente?.nombre_comercial ?? '',
        productos: lineasDe(detalles, 'id_venta', venta.id_venta),
    };
};

// Estados de un pedido (columna estado de la hoja Pedidos)
const ESTADOS_PEDIDO = ['pendiente', 'entregado', 'anulado'];

// Pedido listo para responder: total como número, estado en minúsculas, nombre del cliente y sus productos
const formatearPedido = ({ _fila, ...pedido }, clientes = [], detalles = []) => {
    const cliente = clientes.find((c) => mismoId(c.id_cliente, pedido.id_cliente));
    return {
        ...pedido,
        estado: aTexto(pedido.estado).toLowerCase() || 'pendiente',
        monto_total: aMonto(pedido.monto_total),
        cliente_nombre: cliente?.nombre_comercial ?? '',
        productos: lineasDe(detalles, 'id_pedido', pedido.id_pedido),
    };
};

// Producto del catálogo de una línea de venta: por su ID o, si no lo tiene, por el nombre. undefined si ya no existe.
const productoDeLinea = (catalogo, linea) => catalogo.find((p) => mismoId(p.id_producto, linea.id_producto))
    ?? catalogo.find((p) => aTexto(p.nombre).toLowerCase() === aTexto(linea.producto).toLowerCase());

// Total de la venta de una deuda facturado y en cada tramo: { factura, 0: contado, 7: ..., 15: ..., 30: ... }.
// factura es lo que se facturó (precio del pedido); los tramos usan el precio_contado / precio_7/15/30 actual del
// catálogo (sin precio para ese tramo, el de factura del catálogo; producto que ya no existe, el precio facturado).
// null si la deuda no viene de una venta con productos (deuda manual): no tiene tramos.
const totalesPorTramo = (deuda, ventas, detalles, catalogo) => {
    const venta = ventas.find((v) => mismoId(v.id_deuda, deuda.id_deuda));
    if (!venta) return null;
    const lineas = lineasDe(detalles, 'id_venta', venta.id_venta);
    if (!lineas.length) return null;

    // Precio de cada línea en cada tramo: { 0: ..., 7: ..., 15: ..., 30: ... }
    const conPrecios = lineas.map((linea) => {
        const producto = productoDeLinea(catalogo, linea);
        return {
            ...linea,
            precios: Object.fromEntries(TRAMOS_COBRO.map((tramo) =>
                [tramo, redondear(producto ? precioTramo(producto, tramo) : linea.precio_unitario)])),
        };
    });
    return {
        factura: redondear(lineas.reduce((suma, linea) => suma + linea.subtotal, 0)),
        ...Object.fromEntries(TRAMOS_COBRO.map((tramo) =>
            [tramo, redondear(conPrecios.reduce((suma, linea) => suma + linea.cantidad * linea.precios[tramo], 0))])),
        lineas: conPrecios,
    };
};

// Detalle de la factura de una deuda para el cobro: número, fecha y productos (con sus precios por tramo si los
// tiene). null si la deuda no viene de una venta (deuda manual).
const detalleFactura = (deuda, ventas, detalles, totales) => {
    const venta = ventas.find((v) => mismoId(v.id_deuda, deuda.id_deuda));
    if (!venta) return null;
    const lineas = totales?.lineas ?? lineasDe(detalles, 'id_venta', venta.id_venta).map((l) => ({ ...l, precios: null }));
    return {
        id_venta: venta.id_venta,
        numero_factura: aTexto(venta.numero_factura),
        fecha_venta: aTexto(venta.fecha_venta),
        productos: lineas.map(({ id_detalle, producto, cantidad, precio_unitario, subtotal, precios }) =>
            ({ id_detalle, producto, cantidad, precio_unitario, subtotal, precios })),
    };
};

// Cuánto se cobra de verdad a un tramo frente a lo facturado (1 sin tramos; menor que 1 = descuento).
// La deuda guarda sus montos a precio de factura: el saldo a un tramo es monto_pendiente × factor y cada abono
// descuenta abono / factor. Así cada abono paga su parte de la factura al precio de su día (proporcional).
const factorTramo = (totales, tramo) => {
    const factor = totales && totales.factura > 0 ? totales[tramo] / totales.factura : 1;
    return factor > 0 ? factor : 1; // un catálogo sin precios no puede dejar la deuda en 0
};

// Opciones de cobro de una deuda en una fecha de pago: días desde la emisión (la entrega), el tramo que
// corresponde y, si la deuda tiene tramos, el total, el saldo y el descuento sobre el saldo facturado en cada uno.
// tramos es null sin tramos.
const opcionesCobro = (deuda, totales, fechaPago) => {
    const emision = aTexto(deuda.fecha_emision);
    const dias = emision ? Math.max(diasEntre(emision, fechaPago), 0) : 0;
    const pendiente = aMonto(deuda.monto_pendiente);
    return {
        dias,
        tramo_sugerido: totales ? tramoPorDias(dias) : 0,
        tramos: totales && TRAMOS_COBRO.map((tramo) => {
            const aCobrar = redondear(pendiente * factorTramo(totales, tramo));
            return { tramo, total: totales[tramo], pendiente: aCobrar, descuento: redondear(pendiente - aCobrar) };
        }),
    };
};

// Lo cobrado de una deuda según sus filas de Pagos: monto_cobrado (lo que se recibió, en $) y descuento (lo que
// se rebajó al cobrar de contado o a un plazo; monto_factura - monto). La deuda ya viene de formatearDeuda.
const conCobros = (deuda, pagos) => {
    const suyos = pagos.filter((p) => mismoId(p.id_deuda, deuda.id_deuda));
    return { ...deuda, monto_cobrado: sumar(suyos, 'monto'), descuento: sumar(suyos, 'descuento') };
};

// Cobro de una venta: a crédito, el de su deuda; de contado (ventas anteriores a los pedidos), sus pagos con id_venta.
// { cobrado, descuento, pendiente, estado: pendiente | parcial | pagada }
const cobroDeVenta = (venta, deudas, pagos) => {
    const deuda = aTexto(venta.id_deuda) && deudas.find((d) => mismoId(d.id_deuda, venta.id_deuda));
    const suyos = pagos.filter((p) => (deuda ? mismoId(p.id_deuda, deuda.id_deuda) : mismoId(p.id_venta, venta.id_venta)));
    const cobrado = sumar(suyos, 'monto');
    const pendiente = deuda ? aMonto(deuda.monto_pendiente) : 0;
    return {
        cobrado,
        descuento: sumar(suyos, 'descuento'),
        pendiente,
        estado: deuda ? estadoDeuda(aMonto(deuda.monto_pagado), pendiente) : 'pagada',
    };
};

// Orden descendente por un campo de texto (fechas YYYY-MM-DD o IDs con ceros a la izquierda)
const masRecientePrimero = (...campos) => (a, b) => {
    for (const campo of campos) {
        const diferencia = String(b[campo] ?? '').localeCompare(String(a[campo] ?? ''));
        if (diferencia) return diferencia;
    }
    return 0;
};

// Respuesta de error de los controladores de cartera: los errores con status (p. ej. Sheets sin configurar) muestran su mensaje
const responderError = (res, error, mensaje) => {
    console.error(`${mensaje}:`, error);
    return res.status(error.status || 500).json({ ok: false, mensaje: error.status ? error.message : mensaje });
};

module.exports = {
    aMonto,
    aMontoOpcional,
    redondear,
    sumar,
    PLAZOS_CREDITO,
    TRAMOS_COBRO,
    tramoPorDias,
    columnaTramo,
    precioFactura,
    precioTramo,
    mismoId,
    aTexto,
    NIVELES,
    esAdministrador,
    usuarioActivo,
    listaVendedores,
    nombreVendedor,
    fechaHoraActual,
    clientesDelVendedor,
    saldoCliente,
    estadoDeuda,
    formatearDeuda,
    formatearVenta,
    conCobros,
    cobroDeVenta,
    ESTADOS_PEDIDO,
    formatearPedido,
    productoDeLinea,
    totalesPorTramo,
    detalleFactura,
    factorTramo,
    opcionesCobro,
    masRecientePrimero,
    responderError,
};
