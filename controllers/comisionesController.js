const {
    HOJAS, exigirColumnas, leerHojas, agregarFila, agregarFilas, actualizarFila, actualizarFilas, limpiarFilas,
    siguienteId, siguientesIds, conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    aMonto, aMontoOpcional, redondear, sumar, mismoId, aTexto, listaVendedores, fechaHoraActual, masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const {
    ESTADOS_COMISION, PISO_BONIFICACION, TOPE_BONIFICACION, COLUMNAS_CUOTA, aPeriodo, periodoActual, metaVigente,
    cuotaDe, calcularLiquidacion, liquidacionGuardada, resumenLiquidacion,
} = require('../utils/comisiones');
const { aFecha, fechaHoy } = require('../utils/valores');

// Columnas que escribe el cierre del mes en cada hoja (se comprueban antes de escribir nada).
// Las columnas del sistema anterior (meta_monto, monto_cobrado, comision_*) pueden seguir en la hoja: quedan vacías.
const COLUMNAS = {
    [HOJAS.comisiones]: ['id_comision', 'id_vendedor', 'periodo', 'sueldo_base', 'unidades_vendidas', 'bonificacion',
        'total_a_pagar', 'estado', 'fecha_cierre', 'cerrado_por', 'fecha_pago'],
    [HOJAS.bonificacionesDetalle]: ['id_detalle', 'id_comision', 'id_producto', 'producto', 'cuota_mensual', 'unidades',
        'cumplimiento', 'porcentaje_aplicado', 'valor_representativo', 'sueldo_base', 'bonificacion'],
};
const COLUMNAS_META = ['id_meta', 'id_vendedor', 'periodo', 'sueldo_base', 'observaciones'];

// Hojas que hacen falta para calcular o mostrar una liquidación
const HOJAS_CALCULO = [
    HOJAS.usuarios, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.productos, HOJAS.metas, HOJAS.comisiones,
    HOJAS.bonificacionesDetalle,
];

const filasCalculo = (hojas) => ({
    ventas: hojas[HOJAS.ventas].filas,
    detalles: hojas[HOJAS.ventasDetalle].filas,
    catalogo: hojas[HOJAS.productos].filas,
    metas: hojas[HOJAS.metas].filas,
});

// Reglas que el frontend muestra junto a la liquidación
const REGLAS = { piso: PISO_BONIFICACION, tope: TOPE_BONIFICACION };

// Periodo de la consulta (?periodo=YYYY-MM, por defecto el mes en curso) o null si no es válido
const periodoConsulta = (valor) => (aTexto(valor) ? aPeriodo(valor) : periodoActual());

const filaComision = (hojas, idVendedor, periodo) => hojas[HOJAS.comisiones].filas
    .find((c) => mismoId(c.id_vendedor, idVendedor) && aPeriodo(c.periodo) === periodo);

// Liquidación de un vendedor en el periodo: la guardada si el mes ya se cerró; si no, calculada en el momento
const liquidacionDe = (hojas, idVendedor, periodo) => {
    const guardada = filaComision(hojas, idVendedor, periodo);
    return guardada
        ? liquidacionGuardada(guardada, hojas[HOJAS.bonificacionesDetalle].filas)
        : calcularLiquidacion(idVendedor, periodo, filasCalculo(hojas));
};

// Un vendedor entra en la liquidación del mes si está activo o, inactivo, si tiene algo que liquidar
const participa = (vendedor, liquidacion) => vendedor.activo || liquidacion.id_comision
    || liquidacion.unidades_vendidas > 0;

const totalesDe = (liquidaciones) => ({
    sueldos: sumar(liquidaciones, 'sueldo_base'),
    bonificaciones: sumar(liquidaciones, 'bonificacion'),
    total: sumar(liquidaciones, 'total_a_pagar'),
});

// GET /bill/api/vendedores/comisiones?periodo=YYYY-MM
// Bonificación del vendedor logueado en el mes (avance de cada producto hacia su cuota) y sus meses cerrados
const obtenerMiComision = async (req, res) => {
    const periodo = periodoConsulta(req.query.periodo);
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });

    try {
        const hojas = await leerHojas(...HOJAS_CALCULO);
        const idVendedor = req.vendedor.id_vendedor;
        const historial = hojas[HOJAS.comisiones].filas
            .filter((c) => mismoId(c.id_vendedor, idVendedor))
            .sort(masRecientePrimero('periodo'))
            .map((c) => resumenLiquidacion(liquidacionGuardada(c, [])));

        return res.json({
            ok: true,
            reglas: REGLAS,
            liquidacion: liquidacionDe(hojas, idVendedor, periodo),
            historial,
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener la comisión');
    }
};

// GET /bill/api/vendedores/admin/comisiones?periodo=YYYY-MM
// Liquidación del mes de todos los vendedores (cerrada o calculada en el momento) con los totales a pagar
const listarComisionesAdmin = async (req, res) => {
    const periodo = periodoConsulta(req.query.periodo);
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });

    try {
        const hojas = await leerHojas(...HOJAS_CALCULO);
        const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas);
        const liquidaciones = vendedores
            .map((v) => ({ vendedor: v, liquidacion: liquidacionDe(hojas, v.id_vendedor, periodo) }))
            .filter(({ vendedor, liquidacion }) => participa(vendedor, liquidacion))
            .map(({ vendedor, liquidacion }) => ({ ...liquidacion, vendedor_nombre: vendedor.nombre, activo: vendedor.activo }));

        return res.json({
            ok: true,
            periodo,
            periodo_actual: periodoActual(),
            reglas: REGLAS,
            totales: totalesDe(liquidaciones),
            liquidaciones,
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las comisiones');
    }
};

// POST /bill/api/vendedores/admin/comisiones/:periodo/cerrar  (JSON opcional: { id_vendedor })
// Cierra el mes: guarda la liquidación de cada vendedor que aún no la tiene (o solo la de id_vendedor) y su
// bonificación por producto (Bonificaciones_Detalle). Todos los vendedores que se cierran deben tener sueldo base
// (hoja Metas). Las ventas que se emitan después con fecha de ese mes ya no cuentan (habría que reabrirlo).
const cerrarComisiones = async (req, res) => {
    const periodo = aPeriodo(req.params.periodo);
    const soloVendedor = aTexto(req.body?.id_vendedor);
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });
    if (periodo > periodoActual()) {
        return res.status(400).json({ ok: false, mensaje: 'No se puede cerrar un mes que todavía no empieza.' });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(...HOJAS_CALCULO);
            Object.entries(COLUMNAS).forEach(([hoja, columnas]) => exigirColumnas(hoja, hojas[hoja].encabezados, columnas));

            const vendedores = listaVendedores(hojas[HOJAS.usuarios].filas)
                .filter((v) => !soloVendedor || mismoId(v.id_vendedor, soloVendedor));
            if (soloVendedor && !vendedores.length) return { status: 404, mensaje: 'Vendedor no encontrado.' };

            const porCerrar = vendedores
                .filter((v) => !filaComision(hojas, v.id_vendedor, periodo))
                .map((v) => ({ vendedor: v, liquidacion: calcularLiquidacion(v.id_vendedor, periodo, filasCalculo(hojas)) }))
                .filter(({ vendedor, liquidacion }) => participa(vendedor, liquidacion))
                // Un vendedor sin sueldo y sin ventas se deja abierto (no tiene nada que pagar todavía)
                .filter(({ liquidacion: l }) => l.tiene_meta || l.unidades_vendidas > 0);
            if (!porCerrar.length) return { status: 409, mensaje: `El mes ${periodo} ya está cerrado.` };

            const sinMeta = porCerrar.filter(({ liquidacion }) => !liquidacion.tiene_meta).map(({ vendedor }) => vendedor.nombre);
            if (sinMeta.length) {
                return { status: 409, mensaje: `Falta el sueldo base de: ${sinMeta.join(', ')}. Defínelo antes de cerrar.` };
            }

            const comisiones = hojas[HOJAS.comisiones];
            const ids = siguientesIds(comisiones.filas, 'id_comision', 'COM', porCerrar.length);
            const fechaCierre = fechaHoraActual();
            const filas = porCerrar.map(({ liquidacion: l }, i) => ({
                id_comision: ids[i],
                id_vendedor: l.id_vendedor,
                periodo,
                sueldo_base: l.sueldo_base,
                unidades_vendidas: l.unidades_vendidas,
                bonificacion: l.bonificacion,
                total_a_pagar: l.total_a_pagar,
                estado: ESTADOS_COMISION.cerrada,
                fecha_cierre: fechaCierre,
                cerrado_por: req.vendedor.id_vendedor,
                fecha_pago: '',
            }));
            const detalle = porCerrar.flatMap(({ liquidacion: l }, i) => l.productos.map((p, n) => ({
                id_detalle: `${ids[i]}-${n + 1}`,
                id_comision: ids[i],
                id_producto: p.id_producto,
                producto: p.producto,
                cuota_mensual: p.cuota_mensual ?? '',
                unidades: p.unidades,
                cumplimiento: p.cumplimiento ?? '',
                porcentaje_aplicado: p.porcentaje_aplicado,
                valor_representativo: p.valor_representativo ?? '',
                sueldo_base: l.sueldo_base,
                bonificacion: p.bonificacion,
            })));

            // Si algo falla a mitad, se vacían las filas ya escritas
            const escritas = [];
            try {
                escritas.push([HOJAS.comisiones, await agregarFilas(HOJAS.comisiones, filas, comisiones.encabezados)]);
                escritas.push([HOJAS.bonificacionesDetalle,
                    await agregarFilas(HOJAS.bonificacionesDetalle, detalle, hojas[HOJAS.bonificacionesDetalle].encabezados)]);
            } catch (error) {
                for (const [hoja, agregadas] of escritas) {
                    await limpiarFilas(hoja, agregadas.map((f) => f._fila))
                        .catch((e) => console.error(`No se pudieron deshacer las filas de ${hoja}:`, e.message));
                }
                throw error;
            }

            return {
                liquidaciones: porCerrar.map(({ vendedor, liquidacion }, i) => ({
                    ...liquidacion,
                    id_comision: ids[i],
                    estado: ESTADOS_COMISION.cerrada,
                    fecha_cierre: fechaCierre,
                    cerrado_por: req.vendedor.id_vendedor,
                    vendedor_nombre: vendedor.nombre,
                })),
            };
        });

        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        const { liquidaciones } = resultado;
        registrarLog(req.vendedor.id_vendedor, 'cerrar_comisiones', {
            periodo,
            comisiones: liquidaciones.map((l) => ({ id_comision: l.id_comision, id_vendedor: l.id_vendedor, total_a_pagar: l.total_a_pagar })),
        });
        return res.status(201).json({
            ok: true,
            mensaje: `Mes ${periodo} cerrado (${liquidaciones.length} ${liquidaciones.length === 1 ? 'vendedor' : 'vendedores'}).`,
            liquidaciones,
        });
    } catch (error) {
        return responderError(res, error, 'Error al cerrar las comisiones');
    }
};

// PATCH /bill/api/vendedores/admin/comisiones/:id/pagada  (JSON opcional: { fecha_pago })
const marcarComisionPagada = async (req, res) => {
    const fechaPago = req.body?.fecha_pago ? aFecha(req.body.fecha_pago) : fechaHoy();
    if (!fechaPago) return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });

    try {
        const resultado = await conBloqueo(async () => {
            const { encabezados, filas } = (await leerHojas(HOJAS.comisiones))[HOJAS.comisiones];
            const fila = filas.find((c) => mismoId(c.id_comision, req.params.id));
            if (!fila) return { status: 404, mensaje: 'Liquidación no encontrada.' };
            if (aTexto(fila.estado).toLowerCase() === ESTADOS_COMISION.pagada) {
                return { status: 409, mensaje: 'Esa liquidación ya está pagada.' };
            }
            const cambios = { estado: ESTADOS_COMISION.pagada, fecha_pago: fechaPago };
            await actualizarFila(HOJAS.comisiones, fila._fila, cambios, encabezados);
            return { liquidacion: resumenLiquidacion(liquidacionGuardada({ ...fila, ...cambios }, [])) };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        registrarLog(req.vendedor.id_vendedor, 'pagar_comision', { id_comision: resultado.liquidacion.id_comision, fecha_pago: fechaPago });
        return res.json({ ok: true, mensaje: 'Liquidación marcada como pagada.', liquidacion: resultado.liquidacion });
    } catch (error) {
        return responderError(res, error, 'Error al marcar la liquidación como pagada');
    }
};

// DELETE /bill/api/vendedores/admin/comisiones/:id
// Reabre el mes de un vendedor (p. ej. si cambian las cuotas): borra su liquidación y su detalle para que se
// vuelva a calcular con las reglas actuales (un mes del sistema anterior se recalcula por cuotas). Las del sistema
// anterior también liberan sus deudas (Deudas.id_comision). Una liquidación ya pagada no se puede reabrir.
const reabrirComision = async (req, res) => {
    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.comisiones, HOJAS.comisionesDetalle, HOJAS.bonificacionesDetalle, HOJAS.deudas);
            const fila = hojas[HOJAS.comisiones].filas.find((c) => mismoId(c.id_comision, req.params.id));
            if (!fila) return { status: 404, mensaje: 'Liquidación no encontrada.' };
            if (aTexto(fila.estado).toLowerCase() === ESTADOS_COMISION.pagada) {
                return { status: 409, mensaje: 'Esa liquidación ya está pagada y no se puede reabrir.' };
            }

            const deudas = hojas[HOJAS.deudas];
            await actualizarFilas(HOJAS.deudas, deudas.filas
                .filter((d) => mismoId(d.id_comision, fila.id_comision))
                .map((d) => ({ fila: d._fila, cambios: { id_comision: '' } })), deudas.encabezados);
            for (const hoja of [HOJAS.comisionesDetalle, HOJAS.bonificacionesDetalle]) {
                await limpiarFilas(hoja, hojas[hoja].filas
                    .filter((d) => mismoId(d.id_comision, fila.id_comision))
                    .map((d) => d._fila));
            }
            await limpiarFilas(HOJAS.comisiones, [fila._fila]);
            return { id_comision: aTexto(fila.id_comision), id_vendedor: aTexto(fila.id_vendedor), periodo: aPeriodo(fila.periodo) };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        registrarLog(req.vendedor.id_vendedor, 'reabrir_comision', resultado);
        return res.json({ ok: true, mensaje: `Mes ${resultado.periodo} reabierto.`, ...resultado });
    } catch (error) {
        return responderError(res, error, 'Error al reabrir la liquidación');
    }
};

// GET /bill/api/vendedores/admin/metas?periodo=YYYY-MM
// Sueldo base vigente de cada vendedor en el mes (propia: true si se definió para ese mes; si no, viene de uno
// anterior). La hoja se sigue llamando Metas; su meta_monto (meta de cobro del sistema anterior) ya no se usa.
const listarMetas = async (req, res) => {
    const periodo = periodoConsulta(req.query.periodo);
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });

    try {
        const hojas = await leerHojas(HOJAS.usuarios, HOJAS.metas);
        const metas = listaVendedores(hojas[HOJAS.usuarios].filas).map((v) => {
            const meta = metaVigente(hojas[HOJAS.metas].filas, v.id_vendedor, periodo);
            return {
                ...v,
                periodo,
                sueldo_base: meta ? aMonto(meta.sueldo_base) : null,
                observaciones: aTexto(meta?.observaciones),
                propia: Boolean(meta) && aPeriodo(meta.periodo) === periodo,
                desde: meta ? aPeriodo(meta.periodo) : '',
            };
        });
        return res.json({ ok: true, periodo, metas });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las metas');
    }
};

// Número >= 0 con coma o punto decimal; null si no es válido
const leerMonto = (valor) => {
    const texto = aTexto(valor).replace(',', '.');
    const n = Number(texto);
    return texto !== '' && Number.isFinite(n) && n >= 0 ? redondear(n) : null;
};

// PUT /bill/api/vendedores/admin/metas
// body JSON: { id_vendedor, periodo, sueldo_base, observaciones? }
// Crea o reemplaza el sueldo base del vendedor en ese mes (sigue vigente en los meses siguientes hasta que se
// cambie). Un mes ya cerrado no cambia: su liquidación guardó el sueldo que tenía.
const guardarMeta = async (req, res) => {
    const idVendedor = aTexto(req.body?.id_vendedor);
    const periodo = aPeriodo(req.body?.periodo);
    const sueldoBase = leerMonto(req.body?.sueldo_base);

    if (!idVendedor) return res.status(400).json({ ok: false, mensaje: 'El vendedor es obligatorio.' });
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });
    if (sueldoBase === null) return res.status(400).json({ ok: false, mensaje: 'El sueldo debe ser un número mayor o igual a 0.' });

    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.usuarios, HOJAS.metas, HOJAS.comisiones);
            const { encabezados, filas } = hojas[HOJAS.metas];
            exigirColumnas(HOJAS.metas, encabezados, COLUMNAS_META);

            if (!listaVendedores(hojas[HOJAS.usuarios].filas).some((v) => mismoId(v.id_vendedor, idVendedor))) {
                return { status: 404, mensaje: 'Vendedor no encontrado.' };
            }
            if (filaComision(hojas, idVendedor, periodo)) {
                return { status: 409, mensaje: `El mes ${periodo} de este vendedor ya está cerrado. Reábrelo para cambiar su sueldo.` };
            }

            const datos = { sueldo_base: sueldoBase, observaciones: aTexto(req.body?.observaciones) };
            const existente = filas.find((m) => mismoId(m.id_vendedor, idVendedor) && aPeriodo(m.periodo) === periodo);
            if (existente) {
                await actualizarFila(HOJAS.metas, existente._fila, datos, encabezados);
                return { meta: { id_meta: aTexto(existente.id_meta), id_vendedor: idVendedor, periodo, ...datos } };
            }
            const meta = { id_meta: siguienteId(filas, 'id_meta', 'META'), id_vendedor: idVendedor, periodo, ...datos };
            await agregarFila(HOJAS.metas, meta, encabezados);
            return { meta, nueva: true };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        registrarLog(req.vendedor.id_vendedor, 'guardar_meta', resultado.meta);
        return res.status(resultado.nueva ? 201 : 200).json({ ok: true, mensaje: 'Sueldo base guardado.', meta: resultado.meta });
    } catch (error) {
        return responderError(res, error, 'Error al guardar el sueldo base');
    }
};

// Producto con su cuota para la página de cuotas
const formatearCuota = (p) => ({
    id_producto: aTexto(p.id_producto),
    nombre: aTexto(p.nombre),
    estado: aTexto(p.estado).toLowerCase() === 'inactivo' ? 'inactivo' : 'activo',
    ...cuotaDe(p),
});

const respuestaCuotas = (filas) => {
    const productos = filas.filter((p) => aTexto(p.id_producto)).map(formatearCuota)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return {
        productos,
        // Suma de los valores representativos de los productos activos con cuota (lo normal es 100 %)
        suma_valores: redondear(productos.filter((p) => p.estado === 'activo' && p.cuota_mensual > 0)
            .reduce((suma, p) => suma + (p.valor_representativo ?? 0), 0)),
        reglas: REGLAS,
    };
};

// GET /bill/api/vendedores/admin/cuotas
// Cuota mensual (unidades) y valor representativo (%) de cada producto, iguales para todos los vendedores
const listarCuotas = async (req, res) => {
    try {
        const { filas } = (await leerHojas(HOJAS.productos))[HOJAS.productos];
        return res.json({ ok: true, ...respuestaCuotas(filas) });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las cuotas');
    }
};

// Número >= 0 (con coma o punto) o '' si viene vacío; null si no es válido
const leerOpcional = (valor) => {
    const texto = aTexto(valor).replace(',', '.');
    if (texto === '') return '';
    const n = Number(texto);
    return Number.isFinite(n) && n >= 0 ? redondear(n) : null;
};

// PUT /bill/api/vendedores/admin/cuotas
// body JSON: { cuotas: [{ id_producto, cuota_mensual, valor_representativo }] }  (vacío = sin cuota)
// Solo cambia los productos que vienen. Los meses cerrados no cambian: guardaron la cuota que tenían.
const guardarCuotas = async (req, res) => {
    const lista = req.body?.cuotas;
    if (!Array.isArray(lista) || !lista.length) {
        return res.status(400).json({ ok: false, mensaje: 'Faltan las cuotas.' });
    }
    const cuotas = [];
    for (const [i, c] of lista.entries()) {
        const cuota = leerOpcional(c?.cuota_mensual);
        const valor = leerOpcional(c?.valor_representativo);
        if (!aTexto(c?.id_producto)) return res.status(400).json({ ok: false, mensaje: `Falta el producto en la fila ${i + 1}.` });
        if (cuota === null) {
            return res.status(400).json({ ok: false, mensaje: `La cuota de ${c.id_producto} debe ser un número mayor o igual a 0.` });
        }
        if (valor === null || valor > 100) {
            return res.status(400).json({ ok: false, mensaje: `El valor representativo de ${c.id_producto} debe ser un porcentaje entre 0 y 100.` });
        }
        cuotas.push({ id_producto: aTexto(c.id_producto), cuota_mensual: cuota, valor_representativo: valor });
    }

    try {
        const resultado = await conBloqueo(async () => {
            const { encabezados, filas } = (await leerHojas(HOJAS.productos))[HOJAS.productos];
            exigirColumnas(HOJAS.productos, encabezados, COLUMNAS_CUOTA);
            const cambios = [];
            for (const c of cuotas) {
                const fila = filas.find((p) => mismoId(p.id_producto, c.id_producto));
                if (!fila) return { status: 404, mensaje: `Producto ${c.id_producto} no encontrado.` };
                const distintos = Object.fromEntries(COLUMNAS_CUOTA
                    .filter((campo) => String(aMontoOpcional(fila[campo]) ?? '') !== String(c[campo]))
                    .map((campo) => [campo, c[campo]]));
                if (Object.keys(distintos).length) {
                    cambios.push({ fila: fila._fila, cambios: distintos });
                    Object.assign(fila, distintos);
                }
            }
            await actualizarFilas(HOJAS.productos, cambios, encabezados);
            return { filas, cambiados: cambios.length };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        registrarLog(req.vendedor.id_vendedor, 'guardar_cuotas', { cuotas: cuotas.length, cambiados: resultado.cambiados });
        return res.json({
            ok: true,
            mensaje: resultado.cambiados ? `Cuotas guardadas (${resultado.cambiados} productos).` : 'No había cambios.',
            ...respuestaCuotas(resultado.filas),
        });
    } catch (error) {
        return responderError(res, error, 'Error al guardar las cuotas');
    }
};

module.exports = {
    listarCuotas,
    guardarCuotas,
    obtenerMiComision,
    listarComisionesAdmin,
    cerrarComisiones,
    marcarComisionPagada,
    reabrirComision,
    listarMetas,
    guardarMeta,
};
