const { HOJAS, leerHojas, actualizarFila, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const { formatearPago } = require('../utils/cobros');
const { enviarComprobante } = require('../utils/comprobantes');
const {
    redondear,
    sumar,
    mismoId,
    aTexto,
    listaVendedores,
    nombreVendedor,
    formatearDeuda,
    formatearVenta,
    conCobros,
    cobroDeVenta,
    masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const { aFecha, fechaHoy } = require('../utils/valores');

const LARGO_LISTAS = 5;

// Deuda con su vendedor: la hoja Deudas no lo guarda, sale del cliente
const deudaConVendedor = (deuda, clientes, vendedores) => {
    const idVendedor = aTexto(clientes.find((c) => mismoId(c.id_cliente, deuda.id_cliente))?.id_vendedor);
    return {
        ...formatearDeuda(deuda, clientes),
        id_vendedor: idVendedor,
        vendedor_nombre: nombreVendedor(vendedores, idVendedor),
    };
};

const ventaConVendedor = (venta, clientes, detalles, vendedores) => ({
    ...formatearVenta(venta, clientes, detalles),
    vendedor_nombre: nombreVendedor(vendedores, venta.id_vendedor),
});

// Cifras de un grupo de filas (todas o las de un vendedor) para el mes en curso
const cifras = ({ clientes, deudas, pagos, ventas }, hoy) => {
    const mes = hoy.slice(0, 7);
    const ventasHoy = ventas.filter((v) => aTexto(v.fecha_venta) === hoy);
    const ventasMes = ventas.filter((v) => aTexto(v.fecha_venta).startsWith(mes));
    const vencidas = deudas.filter((d) => d.vencida);
    const conSaldo = deudas.filter((d) => d.monto_pendiente > 0);

    return {
        clientes: clientes.length,
        ventas_hoy: { cantidad: ventasHoy.length, monto: sumar(ventasHoy, 'monto_total') },
        ventas_mes: { cantidad: ventasMes.length, monto: sumar(ventasMes, 'monto_total') },
        cobrado_mes: sumar(pagos.filter((p) => aTexto(p.fecha_pago).startsWith(mes)), 'monto'),
        por_cobrar: { cantidad: conSaldo.length, monto: sumar(conSaldo, 'monto_pendiente') },
        vencido: { cantidad: vencidas.length, monto: sumar(vencidas, 'monto_pendiente') },
    };
};

// GET /bill/api/vendedores/admin/resumen
// Panel del administrador: cifras de todos los vendedores, el detalle por vendedor y las deudas vencidas más antiguas
const obtenerResumenAdmin = async (req, res) => {
    const hoy = fechaHoy();

    try {
        const hojas = await leerHojas(HOJAS.usuarios, HOJAS.clientes, HOJAS.deudas, HOJAS.pagos, HOJAS.ventas, HOJAS.pedidos);
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const clientes = hojas[HOJAS.clientes].filas;
        const deudas = hojas[HOJAS.deudas].filas.map((d) => deudaConVendedor(d, clientes, vendedores));
        const pagos = hojas[HOJAS.pagos].filas;
        const ventas = hojas[HOJAS.ventas].filas;

        const porVerificar = pagos.filter((p) => (aTexto(p.estado_verificacion).toLowerCase() || 'pendiente') === 'pendiente');
        const porEntregar = hojas[HOJAS.pedidos].filas
            .filter((p) => (aTexto(p.estado).toLowerCase() || 'pendiente') === 'pendiente');

        const porVendedor = vendedores.map((vendedor) => {
            const suyo = (fila) => mismoId(fila.id_vendedor, vendedor.id_vendedor);
            const susClientes = clientes.filter(suyo);
            const deCliente = (fila) => susClientes.some((c) => mismoId(c.id_cliente, fila.id_cliente));
            return {
                ...vendedor,
                ...cifras({
                    clientes: susClientes,
                    deudas: deudas.filter(suyo),
                    pagos: pagos.filter(deCliente),
                    ventas: ventas.filter(suyo),
                }, hoy),
                entregas_pendientes: porEntregar.filter(suyo).length,
            };
        });

        return res.json({
            ok: true,
            resumen: {
                ...cifras({ clientes, deudas, pagos, ventas }, hoy),
                vendedores: vendedores.filter((v) => v.activo).length,
                entregas_pendientes: porEntregar.length,
                pagos_por_verificar: { cantidad: porVerificar.length, monto: sumar(porVerificar, 'monto') },
            },
            // Los que más vendieron este mes primero
            vendedores: porVendedor.sort((a, b) => b.ventas_mes.monto - a.ventas_mes.monto
                || b.por_cobrar.monto - a.por_cobrar.monto),
            // Las más antiguas primero: son las más urgentes
            deudas_vencidas: deudas
                .filter((d) => d.vencida)
                .sort((a, b) => aTexto(a.fecha_vencimiento).localeCompare(aTexto(b.fecha_vencimiento)))
                .slice(0, LARGO_LISTAS),
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener el panel del administrador');
    }
};

// GET /bill/api/vendedores/admin/ventas?id_vendedor=&tipo_pago=&desde=&hasta=
// Ventas de todos los vendedores (o de uno), con el nombre del vendedor. Incluye la lista de vendedores para el filtro.
const listarVentasAdmin = async (req, res) => {
    const idVendedor = aTexto(req.query.id_vendedor);
    const tipoPago = aTexto(req.query.tipo_pago).toLowerCase();
    const desde = aFecha(req.query.desde);
    const hasta = aFecha(req.query.hasta);

    try {
        const hojas = await leerHojas(
            HOJAS.usuarios, HOJAS.clientes, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.deudas, HOJAS.pagos,
        );
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const clientes = hojas[HOJAS.clientes].filas;
        const detalles = hojas[HOJAS.ventasDetalle].filas;

        const ventas = hojas[HOJAS.ventas].filas
            .filter((v) => !idVendedor || mismoId(v.id_vendedor, idVendedor))
            .filter((v) => !tipoPago || aTexto(v.tipo_pago).toLowerCase() === tipoPago)
            .filter((v) => !desde || aTexto(v.fecha_venta) >= desde)
            .filter((v) => !hasta || aTexto(v.fecha_venta) <= hasta)
            .sort(masRecientePrimero('fecha_venta', 'id_venta'))
            .map((v) => ({
                ...ventaConVendedor(v, clientes, detalles, vendedores),
                cobro: cobroDeVenta(v, hojas[HOJAS.deudas].filas, hojas[HOJAS.pagos].filas),
            }));

        const total = redondear(ventas.reduce((suma, v) => suma + v.monto_total, 0));
        return res.json({ ok: true, total, ventas, vendedores });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las ventas');
    }
};

// GET /bill/api/vendedores/admin/deudas?id_vendedor=&estado=
// Cuentas por cobrar de todos los vendedores (o de uno). Incluye la lista de vendedores para el filtro.
const listarDeudasAdmin = async (req, res) => {
    const idVendedor = aTexto(req.query.id_vendedor);
    const estado = aTexto(req.query.estado).toLowerCase();

    try {
        const hojas = await leerHojas(HOJAS.usuarios, HOJAS.clientes, HOJAS.deudas, HOJAS.pagos);
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const clientes = hojas[HOJAS.clientes].filas;

        const deudas = hojas[HOJAS.deudas].filas
            .filter((d) => !estado || aTexto(d.estado).toLowerCase() === estado)
            .map((d) => conCobros(deudaConVendedor(d, clientes, vendedores), hojas[HOJAS.pagos].filas))
            .filter((d) => !idVendedor || mismoId(d.id_vendedor, idVendedor));

        const totalPendiente = redondear(deudas.reduce((suma, d) => suma + d.monto_pendiente, 0));
        return res.json({ ok: true, total_pendiente: totalPendiente, deudas, vendedores });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las cuentas por cobrar');
    }
};

// Estados de estado_verificacion en la hoja Pagos (vacío cuenta como pendiente)
const ESTADOS_VERIFICACION = ['pendiente', 'verificado', 'rechazado'];

// Pago con su vendedor (sale del cliente) y la factura que paga (de la deuda o, si fue de contado, de la venta)
const pagoConVendedor = (pago, { clientes, deudas, ventas }, vendedores) => {
    const idVendedor = aTexto(clientes.find((c) => mismoId(c.id_cliente, pago.id_cliente))?.id_vendedor);
    const documento = pago.id_deuda
        ? deudas.find((d) => mismoId(d.id_deuda, pago.id_deuda))
        : ventas.find((v) => mismoId(v.id_venta, pago.id_venta));
    return {
        ...formatearPago(pago, clientes),
        numero_factura: aTexto(documento?.numero_factura),
        id_vendedor: idVendedor,
        vendedor_nombre: nombreVendedor(vendedores, idVendedor),
    };
};

// GET /bill/api/vendedores/admin/pagos?estado=pendiente|verificado|rechazado&id_vendedor=
// Pagos de todos los vendedores (o de uno) para verificarlos. Incluye la lista de vendedores para el filtro.
const listarPagosAdmin = async (req, res) => {
    const idVendedor = aTexto(req.query.id_vendedor);
    const estado = aTexto(req.query.estado).toLowerCase();
    if (estado && !ESTADOS_VERIFICACION.includes(estado)) {
        return res.status(400).json({ ok: false, mensaje: `El estado debe ser ${ESTADOS_VERIFICACION.join(', ')}.` });
    }

    try {
        const hojas = await leerHojas(HOJAS.usuarios, HOJAS.clientes, HOJAS.pagos, HOJAS.deudas, HOJAS.ventas);
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const relacionadas = {
            clientes: hojas[HOJAS.clientes].filas,
            deudas: hojas[HOJAS.deudas].filas,
            ventas: hojas[HOJAS.ventas].filas,
        };

        const pagos = hojas[HOJAS.pagos].filas
            .sort(masRecientePrimero('fecha_pago', 'id_pago'))
            .map((p) => pagoConVendedor(p, relacionadas, vendedores))
            .filter((p) => !estado || p.estado_verificacion === estado)
            .filter((p) => !idVendedor || mismoId(p.id_vendedor, idVendedor));

        const total = redondear(pagos.reduce((suma, p) => suma + p.monto, 0));
        return res.json({ ok: true, total, pagos, vendedores });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los pagos');
    }
};

// GET /bill/api/vendedores/admin/pagos/:id/comprobante  (foto o PDF de cualquier pago)
const obtenerComprobanteAdmin = async (req, res) => {
    try {
        const pago = (await leerHojas(HOJAS.pagos))[HOJAS.pagos].filas.find((p) => mismoId(p.id_pago, req.params.id));
        if (!pago) return res.status(404).json({ ok: false, mensaje: 'Pago no encontrado.' });
        return enviarComprobante(res, pago);
    } catch (error) {
        return responderError(res, error, 'Error al obtener el comprobante');
    }
};

// PATCH /bill/api/vendedores/admin/pagos/:id/verificacion  (JSON: { estado: 'verificado' })
// Cambia estado_verificacion del pago. No toca la deuda: el abono ya se descontó al registrarse.
const verificarPago = async (req, res) => {
    const estado = aTexto(req.body?.estado).toLowerCase() || 'verificado';
    if (!ESTADOS_VERIFICACION.includes(estado)) {
        return res.status(400).json({ ok: false, mensaje: `El estado debe ser ${ESTADOS_VERIFICACION.join(', ')}.` });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.usuarios, HOJAS.clientes, HOJAS.pagos, HOJAS.deudas, HOJAS.ventas);
            const { encabezados, filas } = hojas[HOJAS.pagos];
            const pago = filas.find((p) => mismoId(p.id_pago, req.params.id));
            if (!pago) return { status: 404, mensaje: 'Pago no encontrado.' };

            await actualizarFila(HOJAS.pagos, pago._fila, { estado_verificacion: estado }, encabezados);
            return {
                pago: pagoConVendedor({ ...pago, estado_verificacion: estado }, {
                    clientes: hojas[HOJAS.clientes].filas,
                    deudas: hojas[HOJAS.deudas].filas,
                    ventas: hojas[HOJAS.ventas].filas,
                }, listaVendedores(hojas[HOJAS.usuarios].filas)),
            };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        registrarLog(req.vendedor.id_vendedor, 'verificar_pago', { id_pago: resultado.pago.id_pago, estado });
        return res.json({ ok: true, mensaje: 'Pago actualizado.', pago: resultado.pago });
    } catch (error) {
        return responderError(res, error, 'Error al verificar el pago');
    }
};

module.exports = {
    obtenerResumenAdmin,
    listarVentasAdmin,
    listarDeudasAdmin,
    listarPagosAdmin,
    obtenerComprobanteAdmin,
    verificarPago,
};
