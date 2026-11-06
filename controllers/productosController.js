const {
    HOJAS, leerHojas, agregarFila, agregarFilas, actualizarFila, actualizarFilas, eliminarFila, limpiarFilas,
    exigirColumnas, siguienteId, siguientesIds, conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const { aMonto, aMontoOpcional, redondear, mismoId, aTexto, responderError } = require('../utils/cartera');
const { COLUMNA_COMISION } = require('../utils/comisiones');
const {
    MONEDAS, COLUMNAS_PRECIOS, HOJAS_PRECIOS, aMoneda, clavePrecio, configuracionDe, configuracionPublica,
    preciosFacturaPorNivel, preciosCobroPorNivel, preciosDelProducto,
} = require('../utils/precios');

// En la hoja el estado se escribe con mayúscula inicial (Activo / Inactivo)
const ESTADOS_PRODUCTO = { activo: 'Activo', inactivo: 'Inactivo' };
const MAXIMO_COMISION = 100;
const CAMPOS_PRECIO = ['ajuste_pct', 'ajuste_monto', 'precio_final', 'ganancia_pct'];

// Producto listo para responder: stock y comisión como número, sin el número de fila.
// Con la configuración del motor agrega precios_factura (precio de factura por nivel: { L1: ..., L2: ... }) y
// precios_cobro (por nivel, plazo y moneda: { L1: { CONT: { USD, VES } } }).
const formatearProducto = ({ _fila, ...producto }, config = null) => ({
    ...producto,
    [COLUMNA_COMISION]: aMontoOpcional(producto[COLUMNA_COMISION]),
    stock: aMonto(producto.stock),
    ...(config ? {
        precios_factura: preciosFacturaPorNivel(config, producto.id_producto),
        precios_cobro: preciosCobroPorNivel(config, producto.id_producto),
    } : {}),
});

// Número con coma o punto decimal. Vacío = `vacio`; null si no es válido (o es negativo sin `negativos`)
const leerNumero = (valor, vacio = null, negativos = false) => {
    const texto = aTexto(valor).replace(',', '.');
    if (texto === '') return vacio;
    const n = Number(texto);
    return Number.isFinite(n) && (negativos || n >= 0) ? n : null;
};

// % de comisión del vendedor (0 a 100; vacío = sin comisión): { valor } o { error }
const leerComision = (valor) => {
    const n = leerNumero(valor, '');
    if (n === null || n > MAXIMO_COMISION) {
        return { error: `La comisión debe ser un porcentaje entre 0 y ${MAXIMO_COMISION}.` };
    }
    return { valor: n === '' ? '' : redondear(n) };
};

// Matriz de precios del producto: [{ id_nivel, id_plazo, moneda, precio_final, ajuste_pct?, ajuste_monto?,
// ganancia_pct? }]. Las casillas sin precio_final se quitan. Devuelve { precios } (sin repetir nivel, plazo y
// moneda) o { error }.
const leerMatriz = (lista, config) => {
    if (!Array.isArray(lista)) return { error: 'precios debe ser una lista.' };
    const precios = new Map();
    for (const [i, casilla] of lista.entries()) {
        const nivel = config.niveles.find((n) => mismoId(n.id_nivel, casilla?.id_nivel));
        const plazo = config.plazos.find((p) => mismoId(p.id_plazo, casilla?.id_plazo));
        const moneda = aMoneda(casilla?.moneda);
        if (!nivel) return { error: `Nivel no válido en el precio ${i + 1}.` };
        if (!plazo) return { error: `Plazo no válido en el precio ${i + 1}.` };
        if (!moneda) return { error: `La moneda del precio ${i + 1} debe ser ${MONEDAS.join(' o ')}.` };

        const donde = `${plazo.nombre}, ${nivel.nombre}, ${moneda === 'USD' ? '$' : 'Bs'}`;
        const precioFinal = leerNumero(casilla?.precio_final, '');
        if (precioFinal === null) return { error: `El precio final (${donde}) debe ser un número mayor o igual a 0.` };
        if (precioFinal === '') continue;

        const fila = { id_nivel: nivel.id_nivel, id_plazo: plazo.id_plazo, moneda, precio_final: redondear(precioFinal) };
        for (const campo of ['ajuste_pct', 'ajuste_monto', 'ganancia_pct']) {
            const n = leerNumero(casilla?.[campo], '', true);
            if (n === null) return { error: `${campo} (${donde}) debe ser un número.` };
            fila[campo] = n === '' ? '' : redondear(n);
        }
        precios.set(clavePrecio('', fila.id_nivel, fila.id_plazo, moneda), fila);
    }
    return { precios: [...precios.values()] };
};

// Reemplaza la matriz de precios de un producto en la hoja Precios (usar dentro de conBloqueo):
// actualiza las casillas que cambian, agrega las nuevas y vacía las que ya no vienen.
const guardarMatriz = async (idProducto, precios, hojaPrecios) => {
    exigirColumnas(HOJAS.precios, hojaPrecios.encabezados, COLUMNAS_PRECIOS[HOJAS.precios]);
    const existentes = new Map();
    const sobrantes = [];
    for (const fila of hojaPrecios.filas.filter((p) => mismoId(p.id_producto, idProducto))) {
        const clave = clavePrecio('', fila.id_nivel, fila.id_plazo, aMoneda(fila.moneda) ?? fila.moneda);
        if (existentes.has(clave)) sobrantes.push(fila._fila);
        else existentes.set(clave, fila);
    }

    const cambios = [];
    const nuevas = [];
    for (const precio of precios) {
        const clave = clavePrecio('', precio.id_nivel, precio.id_plazo, precio.moneda);
        const actual = existentes.get(clave);
        existentes.delete(clave);
        if (!actual) {
            nuevas.push(precio);
            continue;
        }
        const distintos = Object.fromEntries(CAMPOS_PRECIO
            .filter((campo) => String(actual[campo] ?? '') !== String(precio[campo] ?? ''))
            .map((campo) => [campo, precio[campo]]));
        if (aTexto(actual.moneda) !== precio.moneda) distintos.moneda = precio.moneda;
        if (Object.keys(distintos).length) cambios.push({ fila: actual._fila, cambios: distintos });
    }
    sobrantes.push(...[...existentes.values()].map((f) => f._fila));

    const ids = siguientesIds(hojaPrecios.filas, 'id_precio', 'PRE', nuevas.length);
    await agregarFilas(HOJAS.precios, nuevas.map((p, i) => ({ id_precio: ids[i], id_producto: idProducto, ...p })),
        hojaPrecios.encabezados);
    await actualizarFilas(HOJAS.precios, cambios, hojaPrecios.encabezados);
    await limpiarFilas(HOJAS.precios, sobrantes);
};

const mismoNombre = (producto, nombre) => aTexto(producto.nombre).toLowerCase() === nombre.toLowerCase();

// GET /bill/api/vendedores/productos?estado=&q=
// Cada producto trae precios_factura: el precio con que se factura en cada nivel ({ L1: ..., L2: ... })
const listarProductos = async (req, res) => {
    const estado = aTexto(req.query.estado).toLowerCase();
    const busqueda = aTexto(req.query.q).toLowerCase();

    try {
        const hojas = await leerHojas(HOJAS.productos, ...HOJAS_PRECIOS);
        const config = configuracionDe(hojas);
        const productos = hojas[HOJAS.productos].filas
            .filter((p) => !estado || aTexto(p.estado).toLowerCase() === estado)
            .filter((p) => !busqueda || `${p.id_producto} ${p.nombre} ${p.descripcion}`.toLowerCase().includes(busqueda))
            .map((p) => formatearProducto(p, config))
            .sort((a, b) => aTexto(a.nombre).localeCompare(aTexto(b.nombre), 'es'));

        return res.json({ ok: true, productos });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los productos');
    }
};

// GET /bill/api/vendedores/productos/:id
// Con precios (la matriz completa: una fila por nivel, plazo y moneda) y precios_factura
const obtenerProducto = async (req, res) => {
    try {
        const hojas = await leerHojas(HOJAS.productos, ...HOJAS_PRECIOS);
        const producto = hojas[HOJAS.productos].filas.find((p) => mismoId(p.id_producto, req.params.id));
        if (!producto) {
            return res.status(404).json({ ok: false, mensaje: 'Producto no encontrado.' });
        }
        const config = configuracionDe(hojas);
        return res.json({
            ok: true,
            producto: { ...formatearProducto(producto, config), precios: preciosDelProducto(config, producto.id_producto) },
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener el producto');
    }
};

// Respuesta con el producto y su matriz de precios releída de la hoja
const productoCompleto = async (idProducto) => {
    const hojas = await leerHojas(HOJAS.productos, ...HOJAS_PRECIOS);
    const config = configuracionDe(hojas);
    const producto = hojas[HOJAS.productos].filas.find((p) => mismoId(p.id_producto, idProducto));
    return { ...formatearProducto(producto, config), precios: preciosDelProducto(config, idProducto) };
};

// POST /bill/api/vendedores/productos
// body JSON: { nombre, descripcion?, stock?, comision? (%) }. Los precios no van aquí: los ajusta el administrador
// con PUT /:id/precios (si llegan, se ignoran).
const crearProducto = async (req, res) => {
    const cuerpo = req.body || {};
    const nombre = aTexto(cuerpo.nombre);
    const stock = leerNumero(cuerpo.stock, 0);
    const comision = leerComision(cuerpo[COLUMNA_COMISION]);

    if (!nombre) {
        return res.status(400).json({ ok: false, mensaje: 'El nombre del producto es obligatorio.' });
    }
    if (stock === null) {
        return res.status(400).json({ ok: false, mensaje: 'El stock debe ser un número mayor o igual a 0.' });
    }
    if (comision.error) {
        return res.status(400).json({ ok: false, mensaje: comision.error });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const { encabezados, filas } = (await leerHojas(HOJAS.productos))[HOJAS.productos];
            if (filas.some((p) => mismoNombre(p, nombre))) {
                return { status: 409, mensaje: 'Ya existe un producto con ese nombre.' };
            }

            const fila = {
                id_producto: siguienteId(filas, 'id_producto', 'PROD'),
                nombre,
                descripcion: aTexto(cuerpo.descripcion),
                stock,
                estado: ESTADOS_PRODUCTO.activo,
            };
            if (comision.valor !== '') {
                exigirColumnas(HOJAS.productos, encabezados, [COLUMNA_COMISION]);
                fila[COLUMNA_COMISION] = comision.valor;
            }
            await agregarFila(HOJAS.productos, fila, encabezados);
            return { idProducto: fila.id_producto };
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        const producto = await productoCompleto(resultado.idProducto);
        registrarLog(req.vendedor.id_vendedor, 'crear_producto', { id_producto: producto.id_producto, nombre });
        return res.status(201).json({ ok: true, mensaje: 'Producto registrado.', producto });
    } catch (error) {
        return responderError(res, error, 'Error al registrar el producto');
    }
};

// PUT /bill/api/vendedores/productos/:id
// body JSON: { nombre?, descripcion?, stock?, estado?, comision? }
// Solo cambia los campos que vienen en el body. Los precios no se tocan aquí (PUT /:id/precios, solo administrador).
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
    if (COLUMNA_COMISION in cuerpo) {
        const comision = leerComision(cuerpo[COLUMNA_COMISION]);
        if (comision.error) return res.status(400).json({ ok: false, mensaje: comision.error });
        cambios[COLUMNA_COMISION] = comision.valor;
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
            const { encabezados, filas } = (await leerHojas(HOJAS.productos))[HOJAS.productos];
            const producto = filas.find((p) => mismoId(p.id_producto, idProducto));
            if (!producto) return { status: 404, mensaje: 'Producto no encontrado.' };

            if (cambios.nombre && filas.some((p) => !mismoId(p.id_producto, idProducto) && mismoNombre(p, cambios.nombre))) {
                return { status: 409, mensaje: 'Ya existe un producto con ese nombre.' };
            }
            await actualizarFila(HOJAS.productos, producto._fila, cambios, encabezados);
            return { idProducto: producto.id_producto };
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        const producto = await productoCompleto(resultado.idProducto);
        registrarLog(req.vendedor.id_vendedor, 'actualizar_producto', { id_producto: producto.id_producto, cambios });
        return res.json({ ok: true, mensaje: 'Producto actualizado.', producto });
    } catch (error) {
        return responderError(res, error, 'Error al actualizar el producto');
    }
};

// PUT /bill/api/vendedores/productos/:id/precios  (solo administrador)
// body JSON: { precios: [{ id_nivel, id_plazo, moneda, precio_final, ajuste_pct?, ajuste_monto?, ganancia_pct? }] }
// Reemplaza la matriz completa del producto: actualiza las casillas cambiadas, agrega las nuevas y vacía las quitadas.
const actualizarPrecios = async (req, res) => {
    const idProducto = aTexto(req.params.id);
    const cuerpo = req.body || {};
    if (!('precios' in cuerpo)) {
        return res.status(400).json({ ok: false, mensaje: 'Faltan los precios.' });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.productos, ...HOJAS_PRECIOS);
            const producto = hojas[HOJAS.productos].filas.find((p) => mismoId(p.id_producto, idProducto));
            if (!producto) return { status: 404, mensaje: 'Producto no encontrado.' };

            const matriz = leerMatriz(cuerpo.precios, configuracionDe(hojas));
            if (matriz.error) return { status: 400, mensaje: matriz.error };
            await guardarMatriz(producto.id_producto, matriz.precios, hojas[HOJAS.precios]);
            return { idProducto: producto.id_producto };
        });

        if (resultado.status) {
            return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });
        }

        const producto = await productoCompleto(resultado.idProducto);
        registrarLog(req.vendedor.id_vendedor, 'ajustar_precios', {
            id_producto: producto.id_producto, precios: producto.precios.length,
        });
        return res.json({ ok: true, mensaje: 'Precios actualizados.', producto });
    } catch (error) {
        return responderError(res, error, 'Error al actualizar los precios');
    }
};

// DELETE /bill/api/vendedores/productos/:id
// Borra la fila y vacía sus precios. Las ventas guardan el nombre y el precio, así que su historial no cambia.
const eliminarProducto = async (req, res) => {
    const idProducto = aTexto(req.params.id);

    try {
        const producto = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.productos, HOJAS.precios);
            const encontrado = hojas[HOJAS.productos].filas.find((p) => mismoId(p.id_producto, idProducto));
            if (!encontrado) return null;
            // Primero los precios (vaciar no mueve filas); luego la fila del producto
            await limpiarFilas(HOJAS.precios, hojas[HOJAS.precios].filas
                .filter((p) => mismoId(p.id_producto, idProducto)).map((p) => p._fila));
            await eliminarFila(HOJAS.productos, encontrado._fila);
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

// GET /bill/api/vendedores/productos/configuracion
// Niveles, plazos y monedas del motor de precios (para armar la matriz y calcular el nivel en el pedido)
const obtenerConfiguracion = async (req, res) => {
    try {
        const hojas = await leerHojas(...HOJAS_PRECIOS);
        return res.json({ ok: true, configuracion: configuracionPublica(configuracionDe(hojas)) });
    } catch (error) {
        return responderError(res, error, 'Error al obtener la configuración de precios');
    }
};

module.exports = {
    listarProductos, obtenerProducto, crearProducto, actualizarProducto, actualizarPrecios, eliminarProducto,
    obtenerConfiguracion,
};
