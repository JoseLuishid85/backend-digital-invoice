const { HOJAS, leerHojas } = require('../services/googleSheetsService');
const {
    aMonto,
    redondear,
    mismoId,
    aTexto,
    clientesDelVendedor,
    formatearDeuda,
    formatearVenta,
    responderError,
} = require('../utils/cartera');
const { fechaHoy } = require('../utils/valores');

const LARGO_LISTAS = 5;

const sumar = (lista, campo) => redondear(lista.reduce((suma, item) => suma + aMonto(item[campo]), 0));

// GET /bill/api/vendedores/resumen
// Cifras de la pantalla de inicio del vendedor: ventas, cobros, saldo por cobrar y entregas pendientes
const obtenerResumen = async (req, res) => {
    const hoy = fechaHoy();
    const mes = hoy.slice(0, 7);

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas, HOJAS.pagos, HOJAS.ventas, HOJAS.ventasDetalle);
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor);
        const deCliente = (fila) => clientes.some((c) => mismoId(c.id_cliente, fila.id_cliente));

        const deudas = hojas[HOJAS.deudas].filas.filter(deCliente).map((d) => formatearDeuda(d, clientes));
        const pagos = hojas[HOJAS.pagos].filas.filter(deCliente);
        const ventas = hojas[HOJAS.ventas].filas.filter((v) => mismoId(v.id_vendedor, req.vendedor.id_vendedor));

        const ventasHoy = ventas.filter((v) => aTexto(v.fecha_venta) === hoy);
        const ventasMes = ventas.filter((v) => aTexto(v.fecha_venta).startsWith(mes));
        const vencidas = deudas.filter((d) => d.vencida);
        const porEntregar = ventas.filter((v) => aTexto(v.estado_entrega).toLowerCase() !== 'entregada');

        return res.json({
            ok: true,
            resumen: {
                clientes: clientes.length,
                ventas_hoy: { cantidad: ventasHoy.length, monto: sumar(ventasHoy, 'monto_total') },
                ventas_mes: { cantidad: ventasMes.length, monto: sumar(ventasMes, 'monto_total') },
                cobrado_mes: sumar(pagos.filter((p) => aTexto(p.fecha_pago).startsWith(mes)), 'monto'),
                por_cobrar: sumar(deudas, 'monto_pendiente'),
                vencido: { cantidad: vencidas.length, monto: sumar(vencidas, 'monto_pendiente') },
                entregas_pendientes: porEntregar.length,
            },
            // Las más antiguas primero: son las más urgentes
            entregas_pendientes: porEntregar
                .sort((a, b) => aTexto(a.fecha_venta).localeCompare(aTexto(b.fecha_venta)))
                .slice(0, LARGO_LISTAS)
                .map((v) => formatearVenta(v, clientes, hojas[HOJAS.ventasDetalle].filas)),
            deudas_vencidas: vencidas
                .sort((a, b) => aTexto(a.fecha_vencimiento).localeCompare(aTexto(b.fecha_vencimiento)))
                .slice(0, LARGO_LISTAS),
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener el resumen');
    }
};

module.exports = { obtenerResumen };
