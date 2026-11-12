const {
    HOJAS, leerHojas, agregarFila, eliminarFila, exigirColumnas, siguienteId, conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    aTexto, mismoId, clientesDelVendedor, listaVendedores, nombreVendedor, fechaHoraActual, responderError,
} = require('../utils/cartera');
const { COLUMNAS_VISITAS, RESULTADOS_VISITA, aPeriodo, periodoActual, leerReglas } = require('../utils/comisiones');
const { aFecha, fechaHoy } = require('../utils/valores');

// Visitas del vendedor a sus clientes (hoja Visitas). Cuentan para la bonificación por clientes visitados: los
// clientes distintos visitados en el mes (utils/comisiones.js). Un mes con la liquidación cerrada no admite cambios.

const nombreCliente = (cliente, idCliente) => aTexto(cliente?.nombre_comercial) || aTexto(cliente?.contacto_nombre) || aTexto(idCliente);

const formatearVisita = ({ _fila, ...visita }, clientes, vendedores) => {
    const cliente = clientes.find((c) => mismoId(c.id_cliente, visita.id_cliente));
    const resultado = aTexto(visita.resultado).toLowerCase();
    return {
        id_visita: aTexto(visita.id_visita),
        id_vendedor: aTexto(visita.id_vendedor),
        id_cliente: aTexto(visita.id_cliente),
        cliente_nombre: nombreCliente(cliente, visita.id_cliente),
        fecha_visita: aTexto(visita.fecha_visita).slice(0, 10),
        resultado,
        resultado_texto: RESULTADOS_VISITA[resultado] ?? aTexto(visita.resultado),
        observaciones: aTexto(visita.observaciones),
        fecha_registro: aTexto(visita.fecha_registro),
        ...(vendedores && { vendedor_nombre: nombreVendedor(vendedores, visita.id_vendedor) }),
    };
};

// Rango de la consulta: ?periodo=YYYY-MM (por defecto el mes en curso). null si no es válido.
const periodoConsulta = (valor) => (aTexto(valor) ? aPeriodo(valor) : periodoActual());

const ordenar = (a, b) => b.fecha_visita.localeCompare(a.fecha_visita) || b.id_visita.localeCompare(a.id_visita);

// Resumen del mes: visitas y clientes distintos visitados
const resumenDe = (visitas) => ({
    visitas: visitas.length,
    clientes_visitados: new Set(visitas.map((v) => v.id_cliente.toUpperCase())).size,
});

const mesCerrado = (comisiones, idVendedor, periodo) => comisiones
    .some((c) => mismoId(c.id_vendedor, idVendedor) && aPeriodo(c.periodo) === periodo);

// GET /bill/api/vendedores/visitas?periodo=YYYY-MM&id_cliente=
const listarVisitas = async (req, res) => {
    const periodo = periodoConsulta(req.query.periodo);
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });
    const idCliente = aTexto(req.query.id_cliente);

    try {
        const hojas = await leerHojas(HOJAS.visitas, HOJAS.clientes, HOJAS.comisiones, HOJAS.reglasBonificacion, HOJAS.plazos);
        const idVendedor = req.vendedor.id_vendedor;
        const visitas = hojas[HOJAS.visitas].filas
            .filter((v) => mismoId(v.id_vendedor, idVendedor) && aPeriodo(v.fecha_visita) === periodo)
            .filter((v) => !idCliente || mismoId(v.id_cliente, idCliente))
            .map((v) => formatearVisita(v, hojas[HOJAS.clientes].filas))
            .sort(ordenar);

        return res.json({
            ok: true,
            periodo,
            cerrado: mesCerrado(hojas[HOJAS.comisiones].filas, idVendedor, periodo),
            resultados: RESULTADOS_VISITA,
            // Meta del mes: { meta } (clientes distintos que hay que visitar). Sin el monto del bono: el vendedor
            // no ve sus bonificaciones
            meta: { meta: leerReglas(hojas[HOJAS.reglasBonificacion].filas, hojas[HOJAS.plazos].filas).visitas.meta },
            resumen: resumenDe(visitas),
            visitas,
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las visitas');
    }
};

// POST /bill/api/vendedores/visitas
// body JSON: { id_cliente, fecha_visita? (YYYY-MM-DD, por defecto hoy; no futura), resultado?, observaciones? }
const registrarVisita = async (req, res) => {
    const idCliente = aTexto(req.body?.id_cliente);
    const fecha = req.body?.fecha_visita ? aFecha(req.body.fecha_visita) : fechaHoy();
    const resultado = aTexto(req.body?.resultado).toLowerCase();

    if (!idCliente) return res.status(400).json({ ok: false, mensaje: 'El cliente es obligatorio.' });
    if (!fecha) return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    if (fecha > fechaHoy()) return res.status(400).json({ ok: false, mensaje: 'La visita no puede tener fecha futura.' });
    if (resultado && !RESULTADOS_VISITA[resultado]) {
        return res.status(400).json({ ok: false, mensaje: `Resultado inválido. Usa: ${Object.keys(RESULTADOS_VISITA).join(', ')}.` });
    }

    try {
        const resultadoBloque = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.visitas, HOJAS.clientes, HOJAS.comisiones);
            const { encabezados, filas } = hojas[HOJAS.visitas];
            exigirColumnas(HOJAS.visitas, encabezados, COLUMNAS_VISITAS);

            const idVendedor = req.vendedor.id_vendedor;
            const cliente = clientesDelVendedor(hojas[HOJAS.clientes].filas, idVendedor)
                .find((c) => mismoId(c.id_cliente, idCliente));
            if (!cliente) return { status: 404, mensaje: 'Cliente no encontrado.' };
            if (mesCerrado(hojas[HOJAS.comisiones].filas, idVendedor, aPeriodo(fecha))) {
                return { status: 409, mensaje: `El mes ${aPeriodo(fecha)} ya está liquidado: no se pueden agregar visitas.` };
            }

            const visita = {
                id_visita: siguienteId(filas, 'id_visita', 'VIS'),
                id_vendedor: idVendedor,
                id_cliente: aTexto(cliente.id_cliente),
                fecha_visita: fecha,
                resultado,
                observaciones: aTexto(req.body?.observaciones),
                fecha_registro: fechaHoraActual(),
            };
            await agregarFila(HOJAS.visitas, visita, encabezados);
            return { visita: formatearVisita(visita, hojas[HOJAS.clientes].filas) };
        });
        if (resultadoBloque.status) {
            return res.status(resultadoBloque.status).json({ ok: false, mensaje: resultadoBloque.mensaje });
        }

        registrarLog(req.vendedor.id_vendedor, 'registrar_visita', { id_visita: resultadoBloque.visita.id_visita, id_cliente: idCliente });
        return res.status(201).json({ ok: true, mensaje: 'Visita registrada.', visita: resultadoBloque.visita });
    } catch (error) {
        return responderError(res, error, 'Error al registrar la visita');
    }
};

// DELETE /bill/api/vendedores/visitas/:id  (solo las propias y de un mes sin liquidar)
const eliminarVisita = async (req, res) => {
    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.visitas, HOJAS.comisiones);
            const idVendedor = req.vendedor.id_vendedor;
            const fila = hojas[HOJAS.visitas].filas
                .find((v) => mismoId(v.id_visita, req.params.id) && mismoId(v.id_vendedor, idVendedor));
            if (!fila) return { status: 404, mensaje: 'Visita no encontrada.' };
            if (mesCerrado(hojas[HOJAS.comisiones].filas, idVendedor, aPeriodo(fila.fecha_visita))) {
                return { status: 409, mensaje: 'Ese mes ya está liquidado: la visita no se puede eliminar.' };
            }
            await eliminarFila(HOJAS.visitas, fila._fila);
            return { id_visita: aTexto(fila.id_visita), id_cliente: aTexto(fila.id_cliente) };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        registrarLog(req.vendedor.id_vendedor, 'eliminar_visita', resultado);
        return res.json({ ok: true, mensaje: 'Visita eliminada.', ...resultado });
    } catch (error) {
        return responderError(res, error, 'Error al eliminar la visita');
    }
};

// GET /bill/api/vendedores/admin/visitas?periodo=YYYY-MM&id_vendedor=
const listarVisitasAdmin = async (req, res) => {
    const periodo = periodoConsulta(req.query.periodo);
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });
    const idVendedor = aTexto(req.query.id_vendedor);

    try {
        const hojas = await leerHojas(HOJAS.visitas, HOJAS.clientes, HOJAS.usuarios);
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const visitas = hojas[HOJAS.visitas].filas
            .filter((v) => aPeriodo(v.fecha_visita) === periodo)
            .filter((v) => !idVendedor || mismoId(v.id_vendedor, idVendedor))
            .map((v) => formatearVisita(v, hojas[HOJAS.clientes].filas, vendedores))
            .sort(ordenar);

        return res.json({
            ok: true,
            periodo,
            resultados: RESULTADOS_VISITA,
            resumen: resumenDe(visitas),
            visitas,
            vendedores,
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las visitas');
    }
};

module.exports = { listarVisitas, registrarVisita, eliminarVisita, listarVisitasAdmin };
