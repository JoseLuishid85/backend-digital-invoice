const { HOJAS, leerHoja, leerHojas, agregarFila, actualizarFila, siguienteId, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const { aMonto, aTexto, mismoId, clientesDelVendedor, saldoCliente, responderError } = require('../utils/cartera');
const { fechaHoy } = require('../utils/valores');

const ESTADOS_CLIENTE = ['activo', 'inactivo'];

// Cliente listo para responder: montos como número, sin el número de fila y con su saldo si se pasan las deudas
const formatearCliente = ({ _fila, ...cliente }, deudas) => ({
    ...cliente,
    limite_credito: aMonto(cliente.limite_credito),
    ...(deudas && { saldo_pendiente: saldoCliente(deudas, cliente.id_cliente) }),
});

// Límite de crédito: vacío = 0 (sin límite). Devuelve null si no es un número >= 0
const leerLimite = (valor) => {
    const texto = aTexto(valor);
    const limite = texto === '' ? 0 : Number(texto.replace(',', '.'));
    return Number.isFinite(limite) && limite >= 0 ? limite : null;
};

// GET /bill/api/vendedores/clientes?estado=&q=  (solo los clientes del vendedor logueado)
const listarClientes = async (req, res) => {
    const estado = aTexto(req.query.estado).toLowerCase();
    const busqueda = aTexto(req.query.q).toLowerCase();

    try {
        const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas);
        const deudas = hojas[HOJAS.deudas].filas;
        const clientes = clientesDelVendedor(hojas[HOJAS.clientes].filas, req.vendedor.id_vendedor)
            .filter((c) => !estado || aTexto(c.estado).toLowerCase() === estado)
            .filter((c) => !busqueda || `${c.nombre_comercial} ${c.contacto_nombre}`.toLowerCase().includes(busqueda))
            .map((c) => formatearCliente(c, deudas))
            .sort((a, b) => aTexto(a.nombre_comercial).localeCompare(aTexto(b.nombre_comercial), 'es'));

        return res.json({ ok: true, clientes });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los clientes');
    }
};

// POST /bill/api/vendedores/clientes
// body JSON: { nombre_comercial, contacto_nombre?, telefono?, direccion?, limite_credito? }
const crearCliente = async (req, res) => {
    const nombreComercial = aTexto(req.body?.nombre_comercial);
    if (!nombreComercial) {
        return res.status(400).json({ ok: false, mensaje: 'El nombre comercial es obligatorio.' });
    }

    const limiteCredito = leerLimite(req.body?.limite_credito);
    if (limiteCredito === null) {
        return res.status(400).json({ ok: false, mensaje: 'El límite de crédito debe ser un número mayor o igual a 0.' });
    }

    try {
        const cliente = await conBloqueo(async () => {
            const { encabezados, filas } = await leerHoja(HOJAS.clientes);

            const duplicado = clientesDelVendedor(filas, req.vendedor.id_vendedor)
                .some((c) => aTexto(c.nombre_comercial).toLowerCase() === nombreComercial.toLowerCase());
            if (duplicado) return null;

            return agregarFila(HOJAS.clientes, {
                id_cliente: siguienteId(filas, 'id_cliente', 'CLI'),
                id_vendedor: req.vendedor.id_vendedor,
                nombre_comercial: nombreComercial,
                contacto_nombre: aTexto(req.body?.contacto_nombre),
                telefono: aTexto(req.body?.telefono),
                direccion: aTexto(req.body?.direccion),
                limite_credito: limiteCredito,
                estado: 'activo',
                fecha_registro: fechaHoy(),
            }, encabezados);
        });

        if (!cliente) {
            return res.status(409).json({ ok: false, mensaje: 'Ya tienes un cliente con ese nombre comercial.' });
        }

        registrarLog(req.vendedor.id_vendedor, 'crear_cliente', { id_cliente: cliente.id_cliente, nombre_comercial: nombreComercial });
        return res.status(201).json({ ok: true, mensaje: 'Cliente registrado.', cliente });
    } catch (error) {
        return responderError(res, error, 'Error al registrar el cliente');
    }
};

// PUT /bill/api/vendedores/clientes/:id
// body JSON: { nombre_comercial?, contacto_nombre?, telefono?, direccion?, limite_credito?, estado? }
// Solo cambia los campos que vienen en el body.
const actualizarCliente = async (req, res) => {
    const idCliente = aTexto(req.params.id);
    const cuerpo = req.body || {};
    const cambios = {};

    for (const campo of ['nombre_comercial', 'contacto_nombre', 'telefono', 'direccion']) {
        if (campo in cuerpo) cambios[campo] = aTexto(cuerpo[campo]);
    }
    if ('nombre_comercial' in cambios && !cambios.nombre_comercial) {
        return res.status(400).json({ ok: false, mensaje: 'El nombre comercial es obligatorio.' });
    }
    if ('limite_credito' in cuerpo) {
        cambios.limite_credito = leerLimite(cuerpo.limite_credito);
        if (cambios.limite_credito === null) {
            return res.status(400).json({ ok: false, mensaje: 'El límite de crédito debe ser un número mayor o igual a 0.' });
        }
    }
    if ('estado' in cuerpo) {
        cambios.estado = aTexto(cuerpo.estado).toLowerCase();
        if (!ESTADOS_CLIENTE.includes(cambios.estado)) {
            return res.status(400).json({ ok: false, mensaje: 'El estado debe ser activo o inactivo.' });
        }
    }
    if (!Object.keys(cambios).length) {
        return res.status(400).json({ ok: false, mensaje: 'No hay cambios que guardar.' });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.clientes, HOJAS.deudas);
            const { encabezados, filas } = hojas[HOJAS.clientes];
            const propios = clientesDelVendedor(filas, req.vendedor.id_vendedor);

            const cliente = propios.find((c) => mismoId(c.id_cliente, idCliente));
            if (!cliente) return { status: 404, mensaje: 'Cliente no encontrado.' };

            const nombre = cambios.nombre_comercial?.toLowerCase();
            if (nombre && propios.some((c) =>
                !mismoId(c.id_cliente, idCliente) && aTexto(c.nombre_comercial).toLowerCase() === nombre)) {
                return { status: 409, mensaje: 'Ya tienes un cliente con ese nombre comercial.' };
            }

            await actualizarFila(HOJAS.clientes, cliente._fila, cambios, encabezados);
            return { cliente: formatearCliente({ ...cliente, ...cambios }, hojas[HOJAS.deudas].filas) };
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        registrarLog(req.vendedor.id_vendedor, 'actualizar_cliente', { id_cliente: resultado.cliente.id_cliente, cambios });
        return res.json({ ok: true, mensaje: 'Cliente actualizado.', cliente: resultado.cliente });
    } catch (error) {
        return responderError(res, error, 'Error al actualizar el cliente');
    }
};

module.exports = { listarClientes, crearCliente, actualizarCliente };
