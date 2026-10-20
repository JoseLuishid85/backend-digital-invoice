const { HOJAS, leerHoja, agregarFila, actualizarFila, eliminarFila, siguienteId, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const { aMonto, redondear, mismoId, aTexto, responderError } = require('../utils/cartera');

// En la hoja el estado se escribe con mayúscula inicial (Activo / Inactivo)
const ESTADOS_PRODUCTO = { activo: 'Activo', inactivo: 'Inactivo' };

// Producto listo para responder: precio y stock como número, sin el número de fila
const formatearProducto = ({ _fila, ...producto }) => ({
    ...producto,
    precio: aMonto(producto.precio),
    stock: aMonto(producto.stock),
});

// Número >= 0 con coma o punto decimal. Vacío = `vacio`; null si no es válido
const leerNumero = (valor, vacio = null) => {
    const texto = aTexto(valor).replace(',', '.');
    if (texto === '') return vacio;
    const n = Number(texto);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const mismoNombre = (producto, nombre) => aTexto(producto.nombre).toLowerCase() === nombre.toLowerCase();

// GET /bill/api/vendedores/productos?estado=&q=
const listarProductos = async (req, res) => {
    const estado = aTexto(req.query.estado).toLowerCase();
    const busqueda = aTexto(req.query.q).toLowerCase();

    try {
        const { filas } = await leerHoja(HOJAS.productos);
        const productos = filas
            .filter((p) => !estado || aTexto(p.estado).toLowerCase() === estado)
            .filter((p) => !busqueda || `${p.id_producto} ${p.nombre} ${p.descripcion}`.toLowerCase().includes(busqueda))
            .map(formatearProducto)
            .sort((a, b) => aTexto(a.nombre).localeCompare(aTexto(b.nombre), 'es'));

        return res.json({ ok: true, productos });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los productos');
    }
};

// GET /bill/api/vendedores/productos/:id
const obtenerProducto = async (req, res) => {
    try {
        const { filas } = await leerHoja(HOJAS.productos);
        const producto = filas.find((p) => mismoId(p.id_producto, req.params.id));
        if (!producto) {
            return res.status(404).json({ ok: false, mensaje: 'Producto no encontrado.' });
        }
        return res.json({ ok: true, producto: formatearProducto(producto) });
    } catch (error) {
        return responderError(res, error, 'Error al obtener el producto');
    }
};

// POST /bill/api/vendedores/productos
// body JSON: { nombre, precio, descripcion?, stock? }
const crearProducto = async (req, res) => {
    const nombre = aTexto(req.body?.nombre);
    const precio = leerNumero(req.body?.precio);
    const stock = leerNumero(req.body?.stock, 0);

    if (!nombre) {
        return res.status(400).json({ ok: false, mensaje: 'El nombre del producto es obligatorio.' });
    }
    if (precio === null) {
        return res.status(400).json({ ok: false, mensaje: 'El precio debe ser un número mayor o igual a 0.' });
    }
    if (stock === null) {
        return res.status(400).json({ ok: false, mensaje: 'El stock debe ser un número mayor o igual a 0.' });
    }

    try {
        const producto = await conBloqueo(async () => {
            const { encabezados, filas } = await leerHoja(HOJAS.productos);
            if (filas.some((p) => mismoNombre(p, nombre))) return null;

            return agregarFila(HOJAS.productos, {
                id_producto: siguienteId(filas, 'id_producto', 'PROD'),
                nombre,
                descripcion: aTexto(req.body?.descripcion),
                precio: redondear(precio),
                stock,
                estado: ESTADOS_PRODUCTO.activo,
            }, encabezados);
        });

        if (!producto) {
            return res.status(409).json({ ok: false, mensaje: 'Ya existe un producto con ese nombre.' });
        }

        registrarLog(req.vendedor.id_vendedor, 'crear_producto', { id_producto: producto.id_producto, nombre });
        return res.status(201).json({ ok: true, mensaje: 'Producto registrado.', producto: formatearProducto(producto) });
    } catch (error) {
        return responderError(res, error, 'Error al registrar el producto');
    }
};

// PUT /bill/api/vendedores/productos/:id
// body JSON: { nombre?, descripcion?, precio?, stock?, estado? }
// Solo cambia los campos que vienen en el body.
const actualizarProducto = async (req, res) => {
    const idProducto = aTexto(req.params.id);
    const cuerpo = req.body || {};
    const cambios = {};

    for (const campo of ['nombre', 'descripcion']) {
        if (campo in cuerpo) cambios[campo] = aTexto(cuerpo[campo]);
    }
    if ('nombre' in cambios && !cambios.nombre) {
        return res.status(400).json({ ok: false, mensaje: 'El nombre del producto es obligatorio.' });
    }
    if ('precio' in cuerpo) {
        cambios.precio = leerNumero(cuerpo.precio);
        if (cambios.precio === null) {
            return res.status(400).json({ ok: false, mensaje: 'El precio debe ser un número mayor o igual a 0.' });
        }
        cambios.precio = redondear(cambios.precio);
    }
    if ('stock' in cuerpo) {
        cambios.stock = leerNumero(cuerpo.stock, 0);
        if (cambios.stock === null) {
            return res.status(400).json({ ok: false, mensaje: 'El stock debe ser un número mayor o igual a 0.' });
        }
    }
    if ('estado' in cuerpo) {
        cambios.estado = ESTADOS_PRODUCTO[aTexto(cuerpo.estado).toLowerCase()];
        if (!cambios.estado) {
            return res.status(400).json({ ok: false, mensaje: 'El estado debe ser activo o inactivo.' });
        }
    }
    if (!Object.keys(cambios).length) {
        return res.status(400).json({ ok: false, mensaje: 'No hay cambios que guardar.' });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const { encabezados, filas } = await leerHoja(HOJAS.productos);
            const producto = filas.find((p) => mismoId(p.id_producto, idProducto));
            if (!producto) return { status: 404, mensaje: 'Producto no encontrado.' };

            if (cambios.nombre && filas.some((p) => !mismoId(p.id_producto, idProducto) && mismoNombre(p, cambios.nombre))) {
                return { status: 409, mensaje: 'Ya existe un producto con ese nombre.' };
            }

            await actualizarFila(HOJAS.productos, producto._fila, cambios, encabezados);
            return { producto: formatearProducto({ ...producto, ...cambios }) };
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        registrarLog(req.vendedor.id_vendedor, 'actualizar_producto', { id_producto: resultado.producto.id_producto, cambios });
        return res.json({ ok: true, mensaje: 'Producto actualizado.', producto: resultado.producto });
    } catch (error) {
        return responderError(res, error, 'Error al actualizar el producto');
    }
};

// DELETE /bill/api/vendedores/productos/:id
// Borra la fila. Las ventas guardan el nombre del producto, así que su historial no cambia.
const eliminarProducto = async (req, res) => {
    const idProducto = aTexto(req.params.id);

    try {
        const producto = await conBloqueo(async () => {
            const { filas } = await leerHoja(HOJAS.productos);
            const encontrado = filas.find((p) => mismoId(p.id_producto, idProducto));
            if (encontrado) await eliminarFila(HOJAS.productos, encontrado._fila);
            return encontrado;
        });

        if (!producto) {
            return res.status(404).json({ ok: false, mensaje: 'Producto no encontrado.' });
        }

        registrarLog(req.vendedor.id_vendedor, 'eliminar_producto', { id_producto: producto.id_producto, nombre: producto.nombre });
        return res.json({ ok: true, mensaje: 'Producto eliminado.', producto: formatearProducto(producto) });
    } catch (error) {
        return responderError(res, error, 'Error al eliminar el producto');
    }
};

module.exports = { listarProductos, obtenerProducto, crearProducto, actualizarProducto, eliminarProducto };
