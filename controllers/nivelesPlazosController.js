const {
    HOJAS, leerHojas, agregarFila, actualizarFila, actualizarFilas, eliminarFila, limpiarFilas, exigirColumnas,
    conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const { mismoId, aTexto, responderError } = require('../utils/cartera');
const { COLUMNAS_PRECIOS } = require('../utils/precios');

// Altas, cambios y bajas de las hojas Niveles y Plazos del motor de precios (solo administrador).
// El código (id_nivel / id_plazo) no cambia al editar: lo guardan Precios, los pedidos, las ventas y los pagos.
// Reglas para que el motor siga funcionando:
// - Los rangos (unidades o días) de los registros activos no se pueden solapar.
// - Siempre queda al menos un nivel y un plazo activo.
// - Un solo plazo se factura: marcar uno desmarca los demás. El plazo que se factura no se puede desactivar ni
//   eliminar (primero se marca otro).
// - Eliminar borra también sus precios, pero no se puede si ya lo usan pedidos, ventas, pagos o comisiones
//   (en ese caso se desactiva).

const ESTADOS = { activo: 'Activo', inactivo: 'Inactivo' };
const PATRON_CODIGO = /^[A-Z0-9_-]{1,20}$/;

const TIPOS = {
    niveles: {
        hoja: HOJAS.niveles,
        id: 'id_nivel',
        unidad: 'unidades',
        desde: 'unidades_desde',
        hasta: 'unidades_hasta',
        singular: 'nivel',
        articulo: 'el nivel',
        // Hojas que guardan el código: Precios se limpia al eliminar; las demás lo impiden
        historial: [HOJAS.pedidosDetalle, HOJAS.ventasDetalle],
    },
    plazos: {
        hoja: HOJAS.plazos,
        id: 'id_plazo',
        unidad: 'días',
        desde: 'dias_desde',
        hasta: 'dias_hasta',
        singular: 'plazo',
        articulo: 'el plazo',
        historial: [HOJAS.pagos, HOJAS.comisionesDetalle],
    },
};

const esActivo = (fila) => ['', 'activo'].includes(aTexto(fila.estado).toLowerCase());
const esSi = (valor) => ['si', 'sí', 'true', '1', 'x'].includes(aTexto(valor).toLowerCase());

// Entero >= 0. Vacío = `vacio`; null si no es válido
const leerEntero = (valor, vacio = null) => {
    const texto = aTexto(valor).replace(',', '.');
    if (texto === '') return vacio;
    const n = Number(texto);
    return Number.isInteger(n) && n >= 0 ? n : null;
};

// Rango de una fila de la hoja: { desde, hasta } (hasta null = sin límite)
const rangoDe = (fila, tipo) => ({
    desde: leerEntero(fila[tipo.desde], 0) ?? 0,
    hasta: leerEntero(fila[tipo.hasta], null),
});

const seSolapan = (a, b) => a.desde <= (b.hasta ?? Infinity) && b.desde <= (a.hasta ?? Infinity);

const textoRango = ({ desde, hasta }, unidad) => (hasta === null ? `${desde} ${unidad} o más` : `${desde} a ${hasta} ${unidad}`);

// Registro listo para responder: números como número, estado en minúscula y cuántas filas lo usan
const formatear = (fila, tipo, usos) => {
    const { desde, hasta } = rangoDe(fila, tipo);
    const registro = {
        [tipo.id]: aTexto(fila[tipo.id]),
        nombre: aTexto(fila.nombre),
        [tipo.desde]: desde,
        [tipo.hasta]: hasta,
        estado: esActivo(fila) ? 'activo' : 'inactivo',
        usos,
    };
    if (tipo === TIPOS.plazos) {
        registro.se_factura = esSi(fila.se_factura);
        registro.orden = leerEntero(fila.orden, null);
    }
    return registro;
};

// Cuenta en qué hojas aparece cada código: { precios, historial }
const contarUsos = (hojas, tipo, codigo) => ({
    precios: hojas[HOJAS.precios].filas.filter((f) => mismoId(f[tipo.id], codigo)).length,
    historial: tipo.historial.reduce((suma, hoja) =>
        suma + hojas[hoja].filas.filter((f) => mismoId(f[tipo.id], codigo)).length, 0),
});

const leerTodo = (tipo) => leerHojas(tipo.hoja, HOJAS.precios, ...tipo.historial);

// Lista ordenada como la usa el motor: plazos por orden y días, niveles por unidades
const listar = (hojas, tipo) => hojas[tipo.hoja].filas
    .filter((f) => aTexto(f[tipo.id]))
    .map((f) => formatear(f, tipo, contarUsos(hojas, tipo, f[tipo.id])))
    .sort((a, b) => (a.orden ?? a[tipo.desde]) - (b.orden ?? b[tipo.desde]) || a[tipo.desde] - b[tipo.desde]);

// Valida el body (en alta o en cambio) contra la fila actual. Devuelve { datos } con los valores a escribir o { error }.
const leerCuerpo = (cuerpo, tipo, actual) => {
    const datos = {};

    if (!actual) {
        const codigo = aTexto(cuerpo[tipo.id]).toUpperCase();
        if (!PATRON_CODIGO.test(codigo)) {
            return { error: 'El código es obligatorio: hasta 20 letras, números, guion o guion bajo (p. ej. L5 o CRED3).' };
        }
        datos[tipo.id] = codigo;
    }

    if (!actual || 'nombre' in cuerpo) {
        datos.nombre = aTexto(cuerpo.nombre);
        if (!datos.nombre) return { error: 'El nombre es obligatorio.' };
    }

    for (const [campo, obligatorio] of [[tipo.desde, true], [tipo.hasta, false]]) {
        if (actual && !(campo in cuerpo)) continue;
        const n = leerEntero(cuerpo[campo], obligatorio ? null : '');
        if (n === null) {
            return { error: `"${campo}" debe ser un número entero mayor o igual a 0${obligatorio ? '' : ' (vacío = sin límite)'}.` };
        }
        datos[campo] = n;
    }

    if (!actual || 'estado' in cuerpo) {
        const estado = actual || 'estado' in cuerpo ? ESTADOS[aTexto(cuerpo.estado).toLowerCase()] : ESTADOS.activo;
        if (!estado) return { error: 'El estado debe ser activo o inactivo.' };
        datos.estado = estado;
    }

    if (tipo === TIPOS.plazos) {
        if (!actual || 'se_factura' in cuerpo) datos.se_factura = esSi(cuerpo.se_factura) ? 'si' : 'no';
        if ('orden' in cuerpo) {
            const orden = leerEntero(cuerpo.orden, '');
            if (orden === null) return { error: 'El orden debe ser un número entero mayor o igual a 0.' };
            datos.orden = orden;
        }
    }

    // El rango resultante: el nuevo valor o el de la fila actual
    const rango = {
        desde: tipo.desde in datos ? datos[tipo.desde] : rangoDe(actual, tipo).desde,
        hasta: tipo.hasta in datos ? (datos[tipo.hasta] === '' ? null : datos[tipo.hasta]) : rangoDe(actual, tipo).hasta,
    };
    if (rango.hasta !== null && rango.hasta < rango.desde) {
        return { error: `El "hasta" no puede ser menor que el "desde" (${rango.desde}).` };
    }
    return { datos, rango };
};

// Revisa que el registro resultante no rompa las reglas del motor frente a los demás. null si está bien.
const reglasDelMotor = (filas, tipo, codigo, rango, activo, seFactura, actual) => {
    const otras = filas.filter((f) => aTexto(f[tipo.id]) && !mismoId(f[tipo.id], codigo));
    const otrasActivas = otras.filter(esActivo);

    if (activo) {
        const choca = otrasActivas.find((f) => seSolapan(rango, rangoDe(f, tipo)));
        if (choca) {
            return `El rango (${textoRango(rango, tipo.unidad)}) se solapa con ${tipo.articulo} ${aTexto(choca[tipo.id])} `
                + `(${textoRango(rangoDe(choca, tipo), tipo.unidad)}).`;
        }
    } else if (!otrasActivas.length) {
        return `Debe quedar al menos un ${tipo.singular} activo.`;
    }

    if (tipo === TIPOS.plazos && actual && esSi(actual.se_factura) && esActivo(actual)) {
        if (!seFactura) return 'Este es el plazo con el que se factura: marca otro plazo como de factura antes de quitárselo.';
        if (!activo) return 'No se puede desactivar el plazo con el que se factura: marca otro plazo como de factura primero.';
    }
    if (tipo === TIPOS.plazos && seFactura && !activo) {
        return 'El plazo con el que se factura debe estar activo.';
    }
    return null;
};

// Cambios para desmarcar se_factura en los demás plazos (cuando este pasa a ser el de factura)
const desmarcarOtrosFactura = (filas, codigo) => filas
    .filter((f) => !mismoId(f.id_plazo, codigo) && esSi(f.se_factura))
    .map((f) => ({ fila: f._fila, cambios: { se_factura: 'no' } }));

const tipoDe = (req) => TIPOS[req.tipoMotor];

// GET /bill/api/vendedores/admin/niveles  y  /admin/plazos
// Todos (también los inactivos), cada uno con usos: { precios, historial }
const listarRegistros = async (req, res) => {
    const tipo = tipoDe(req);
    try {
        const hojas = await leerTodo(tipo);
        return res.json({ ok: true, [req.tipoMotor]: listar(hojas, tipo) });
    } catch (error) {
        return responderError(res, error, `Error al obtener los ${req.tipoMotor}`);
    }
};

// POST /bill/api/vendedores/admin/niveles  JSON: { id_nivel, nombre, unidades_desde, unidades_hasta?, estado? }
// POST /bill/api/vendedores/admin/plazos   JSON: { id_plazo, nombre, dias_desde, dias_hasta?, se_factura?, orden?, estado? }
const crearRegistro = async (req, res) => {
    const tipo = tipoDe(req);
    const lectura = leerCuerpo(req.body || {}, tipo, null);
    if (lectura.error) return res.status(400).json({ ok: false, mensaje: lectura.error });
    const { datos, rango } = lectura;
    const codigo = datos[tipo.id];

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerTodo(tipo);
            const { encabezados, filas } = hojas[tipo.hoja];
            exigirColumnas(tipo.hoja, encabezados, COLUMNAS_PRECIOS[tipo.hoja]);

            if (filas.some((f) => mismoId(f[tipo.id], codigo))) {
                return { status: 409, mensaje: `Ya existe ${tipo.articulo} ${codigo}.` };
            }
            if (filas.some((f) => aTexto(f.nombre).toLowerCase() === datos.nombre.toLowerCase())) {
                return { status: 409, mensaje: `Ya existe ${tipo.articulo} con el nombre "${datos.nombre}".` };
            }
            const activo = datos.estado === ESTADOS.activo;
            const seFactura = datos.se_factura === 'si';
            const regla = reglasDelMotor(filas, tipo, codigo, rango, activo, seFactura, null);
            if (regla) return { status: 400, mensaje: regla };

            const fila = { ...datos };
            if (tipo === TIPOS.plazos && !('orden' in fila)) {
                fila.orden = filas.reduce((max, f) => Math.max(max, leerEntero(f.orden, 0) ?? 0), 0) + 1;
            }
            await agregarFila(tipo.hoja, fila, encabezados);
            if (seFactura) await actualizarFilas(tipo.hoja, desmarcarOtrosFactura(filas, codigo), encabezados);
            return { ok: true };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        const hojas = await leerTodo(tipo);
        const registro = listar(hojas, tipo).find((r) => mismoId(r[tipo.id], codigo));
        registrarLog(req.vendedor.id_vendedor, `crear_${tipo.singular}`, { [tipo.id]: codigo, nombre: datos.nombre });
        return res.status(201).json({ ok: true, mensaje: `${datos.nombre} registrado.`, [tipo.singular]: registro });
    } catch (error) {
        return responderError(res, error, `Error al registrar ${tipo.articulo}`);
    }
};

// PUT /bill/api/vendedores/admin/niveles/:id  y  /admin/plazos/:id  (parcial; el código no cambia)
const actualizarRegistro = async (req, res) => {
    const tipo = tipoDe(req);
    const cuerpo = req.body || {};

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerTodo(tipo);
            const { encabezados, filas } = hojas[tipo.hoja];
            const actual = filas.find((f) => mismoId(f[tipo.id], req.params.id));
            if (!actual) return { status: 404, mensaje: `No existe ${tipo.articulo} ${req.params.id}.` };

            const lectura = leerCuerpo(cuerpo, tipo, actual);
            if (lectura.error) return { status: 400, mensaje: lectura.error };
            const { datos, rango } = lectura;
            if (!Object.keys(datos).length) return { status: 400, mensaje: 'No hay cambios que guardar.' };

            const codigo = aTexto(actual[tipo.id]);
            if (datos.nombre && filas.some((f) => !mismoId(f[tipo.id], codigo)
                && aTexto(f.nombre).toLowerCase() === datos.nombre.toLowerCase())) {
                return { status: 409, mensaje: `Ya existe ${tipo.articulo} con el nombre "${datos.nombre}".` };
            }
            const activo = 'estado' in datos ? datos.estado === ESTADOS.activo : esActivo(actual);
            const seFactura = 'se_factura' in datos ? datos.se_factura === 'si' : esSi(actual.se_factura);
            const regla = reglasDelMotor(filas, tipo, codigo, rango, activo, seFactura, actual);
            if (regla) return { status: 400, mensaje: regla };

            exigirColumnas(tipo.hoja, encabezados, Object.keys(datos));
            await actualizarFila(tipo.hoja, actual._fila, datos, encabezados);
            if (tipo === TIPOS.plazos && seFactura) {
                await actualizarFilas(tipo.hoja, desmarcarOtrosFactura(filas, codigo), encabezados);
            }
            return { codigo, datos };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        const hojas = await leerTodo(tipo);
        const registro = listar(hojas, tipo).find((r) => mismoId(r[tipo.id], resultado.codigo));
        registrarLog(req.vendedor.id_vendedor, `actualizar_${tipo.singular}`, { [tipo.id]: resultado.codigo, cambios: resultado.datos });
        return res.json({ ok: true, mensaje: `${registro.nombre} actualizado.`, [tipo.singular]: registro });
    } catch (error) {
        return responderError(res, error, `Error al actualizar ${tipo.articulo}`);
    }
};

// DELETE /bill/api/vendedores/admin/niveles/:id  y  /admin/plazos/:id
// Borra la fila y vacía sus precios. 409 si ya lo usan pedidos, ventas, pagos o comisiones (se desactiva).
const eliminarRegistro = async (req, res) => {
    const tipo = tipoDe(req);

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerTodo(tipo);
            const { filas } = hojas[tipo.hoja];
            const actual = filas.find((f) => mismoId(f[tipo.id], req.params.id));
            if (!actual) return { status: 404, mensaje: `No existe ${tipo.articulo} ${req.params.id}.` };

            const codigo = aTexto(actual[tipo.id]);
            const usos = contarUsos(hojas, tipo, codigo);
            if (usos.historial) {
                return {
                    status: 409,
                    mensaje: `No se puede eliminar ${tipo.articulo} ${codigo}: lo usan ${usos.historial} registros de `
                        + `${tipo.historial.join(' y ')}. Desactívalo para que no se use más.`,
                };
            }
            if (esActivo(actual)) {
                if (!filas.some((f) => aTexto(f[tipo.id]) && !mismoId(f[tipo.id], codigo) && esActivo(f))) {
                    return { status: 400, mensaje: `Debe quedar al menos un ${tipo.singular} activo.` };
                }
                if (tipo === TIPOS.plazos && esSi(actual.se_factura)) {
                    return { status: 400, mensaje: 'No se puede eliminar el plazo con el que se factura: marca otro plazo como de factura primero.' };
                }
            }

            // Primero los precios (vaciar no mueve filas); luego la fila
            await limpiarFilas(HOJAS.precios, hojas[HOJAS.precios].filas
                .filter((f) => mismoId(f[tipo.id], codigo)).map((f) => f._fila));
            await eliminarFila(tipo.hoja, actual._fila);
            return { registro: formatear(actual, tipo, usos) };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        const { registro } = resultado;
        registrarLog(req.vendedor.id_vendedor, `eliminar_${tipo.singular}`, {
            [tipo.id]: registro[tipo.id], nombre: registro.nombre, precios: registro.usos.precios,
        });
        return res.json({ ok: true, mensaje: `${registro.nombre} eliminado.`, [tipo.singular]: registro });
    } catch (error) {
        return responderError(res, error, `Error al eliminar ${tipo.articulo}`);
    }
};

// Middleware que indica a los handlers qué hoja manejan: conTipo('niveles') o conTipo('plazos')
const conTipo = (nombre) => (req, res, next) => {
    req.tipoMotor = nombre;
    next();
};

module.exports = { conTipo, listarRegistros, crearRegistro, actualizarRegistro, eliminarRegistro };
