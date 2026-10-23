const { fechaHoy } = require('./valores');

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

// Plazos de las ventas a crédito (días). Cada uno tiene su precio en Productos: precio_7, precio_15, precio_30
const PLAZOS_CREDITO = [7, 15, 30];
const columnaPrecio = (plazo) => (plazo ? `precio_${plazo}` : 'precio');

// Precio de un producto de la hoja de contado (plazo vacío) o a un plazo; sin precio a ese plazo, el de contado
const precioSegunPlazo = (producto, plazo) => aMontoOpcional(producto[columnaPrecio(plazo)]) ?? aMonto(producto.precio);

// Compara IDs ignorando mayúsculas y espacios (en la hoja se escriben a mano)
const mismoId = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

// Texto opcional recortado; '' si no viene
const aTexto = (valor) => (valor === null || valor === undefined ? '' : String(valor).trim());

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
        productos: detalles
            .filter((d) => mismoId(d.id_venta, venta.id_venta))
            .map(({ _fila: _, ...d }) => ({
                ...d,
                cantidad: aMonto(d.cantidad),
                precio_unitario: aMonto(d.precio_unitario),
                subtotal: aMonto(d.subtotal),
            })),
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
    PLAZOS_CREDITO,
    columnaPrecio,
    precioSegunPlazo,
    mismoId,
    aTexto,
    fechaHoraActual,
    clientesDelVendedor,
    saldoCliente,
    estadoDeuda,
    formatearDeuda,
    formatearVenta,
    masRecientePrimero,
    responderError,
};
