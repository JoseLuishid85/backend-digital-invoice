const { HOJAS, leerHojas } = require('../services/googleSheetsService');
const { mismoId, aTexto, clientesDelVendedor, listaVendedores, nombreVendedor, responderError } = require('../utils/cartera');
const { leerPeriodo, armarConsulta, pagosDeClientes } = require('../utils/consultas');

const HOJAS_CONSULTA = [HOJAS.clientes, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.deudas, HOJAS.pagos];

// GET /bill/api/vendedores/consultas/ventas?desde=&hasta=&agrupar=dia|semana|mes
// Ventas del vendedor logueado en el período: resumen, serie, productos, clientes y el listado
const consultarVentas = async (req, res) => {
    const periodo = leerPeriodo(req.query);
    if (periodo.error) return res.status(400).json({ ok: false, mensaje: periodo.error });

    try {
        const hojas = await leerHojas(...HOJAS_CONSULTA);
        const idVendedor = req.vendedor.id_vendedor;
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, idVendedor);

        const consulta = armarConsulta({
            ventas: hojas[HOJAS.ventas].filas.filter((v) => mismoId(v.id_vendedor, idVendedor)),
            pagos: pagosDeClientes(hojas[HOJAS.pagos].filas, clientes),
            detalles: hojas[HOJAS.ventasDetalle].filas,
            deudas: hojas[HOJAS.deudas].filas,
            clientes,
        }, periodo);
        return res.json({ ok: true, ...consulta });
    } catch (error) {
        return responderError(res, error, 'Error al consultar las ventas');
    }
};

// GET /bill/api/vendedores/admin/consultas/ventas?desde=&hasta=&agrupar=&id_vendedor=
// Lo mismo para todos los vendedores (o uno), con el desglose por_vendedor y la lista de vendedores para el filtro
const consultarVentasAdmin = async (req, res) => {
    const periodo = leerPeriodo(req.query);
    if (periodo.error) return res.status(400).json({ ok: false, mensaje: periodo.error });
    const idVendedor = aTexto(req.query.id_vendedor);

    try {
        const hojas = await leerHojas(HOJAS.usuarios, ...HOJAS_CONSULTA);
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const todos = hojas[HOJAS.clientes].filas;
        const clientes = idVendedor ? clientesDelVendedor(todos, idVendedor) : todos;

        const consulta = armarConsulta({
            ventas: hojas[HOJAS.ventas].filas.filter((v) => !idVendedor || mismoId(v.id_vendedor, idVendedor)),
            pagos: idVendedor ? pagosDeClientes(hojas[HOJAS.pagos].filas, clientes) : hojas[HOJAS.pagos].filas,
            detalles: hojas[HOJAS.ventasDetalle].filas,
            deudas: hojas[HOJAS.deudas].filas,
            clientes,
        }, periodo, (id) => nombreVendedor(vendedores, id));
        return res.json({ ok: true, ...consulta, vendedores });
    } catch (error) {
        return responderError(res, error, 'Error al consultar las ventas');
    }
};

module.exports = { consultarVentas, consultarVentasAdmin };
