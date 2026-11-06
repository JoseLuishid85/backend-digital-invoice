const { fechaHoy } = require('./valores');

// Montos leídos de Sheets: número, texto con coma decimal o vacío (= 0)
const aMonto = (valor) => {
    if (typeof valor === 'number') return valor;
    const n = Number(String(valor ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
};

// Igual que aMonto, pero una celda vacía o inválida es null (p. ej. un precio sin definir)
const aMontoOpcional = (valor) => {
    if (typeof valor === 'number') return valor;
    const texto = String(valor ?? '').trim().replace(',', '.');
    const n = Number(texto);
    return texto !== '' && Number.isFinite(n) ? n : null;
};

const redondear = (n) => Math.round(n * 100) / 100;

// Suma de un campo de monto en una lista de filas, redondeada a centavos
const sumar = (lista, campo) => redondear(lista.reduce((suma, item) => suma + aMonto(item[campo]), 0));

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

// Líneas de detalle (Ventas_Detalle o Pedidos_Detalle) de un documento, con los montos como número.
// id_nivel es el nivel de volumen con que se calculó su precio (vacío en las anteriores al motor de precios).
const lineasDe = (detalles, campo, id) => detalles
    .filter((d) => mismoId(d[campo], id))
    .map(({ _fila, ...d }) => ({
        ...d,
        cantidad: aMonto(d.cantidad),
        precio_unitario: aMonto(d.precio_unitario),
        subtotal: aMonto(d.subtotal),
        id_nivel: aTexto(d.id_nivel),
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

// Lo cobrado de una deuda según sus filas de Pagos: monto_cobrado (lo que se recibió, en $) y descuento (lo que
// se rebajó por pagar antes del plazo que se factura; monto_factura - monto). La deuda ya viene de formatearDeuda.
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
    lineasDe,
    formatearVenta,
    conCobros,
    cobroDeVenta,
    ESTADOS_PEDIDO,
    formatearPedido,
    productoDeLinea,
    masRecientePrimero,
    responderError,
};
