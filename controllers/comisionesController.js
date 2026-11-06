const {
    HOJAS, exigirColumnas, leerHojas, agregarFila, agregarFilas, actualizarFila, actualizarFilas, limpiarFilas,
    siguienteId, siguientesIds, conBloqueo,
} = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const {
    aMonto, redondear, sumar, mismoId, aTexto, listaVendedores, fechaHoraActual, masRecientePrimero,
    responderError,
} = require('../utils/cartera');
const {
    ESTADOS_COMISION, SOLO_PAGOS_VERIFICADOS, aPeriodo, periodoActual, metaVigente, calcularLiquidacion,
    liquidacionGuardada, resumenLiquidacion,
} = require('../utils/comisiones');
const { HOJAS_PRECIOS, configuracionDe } = require('../utils/precios');
const { aFecha, fechaHoy } = require('../utils/valores');

// Columnas que escribe el cierre del mes en cada hoja (se comprueban antes de escribir nada)
const COLUMNAS = {
    [HOJAS.comisiones]: ['id_comision', 'id_vendedor', 'periodo', 'sueldo_base', 'meta_monto', 'monto_cobrado',
        'meta_cumplida', 'comision_calculada', 'comision_pagada', 'total_a_pagar', 'estado', 'fecha_cierre',
        'cerrado_por', 'fecha_pago'],
    [HOJAS.comisionesDetalle]: ['id_detalle', 'id_comision', 'id_deuda', 'id_venta', 'numero_factura', 'id_pago',
        'id_producto', 'producto', 'id_plazo', 'base', 'porcentaje', 'monto_comision'],
    [HOJAS.deudas]: ['fecha_cancelacion', 'id_comision'],
};
const COLUMNAS_META = ['id_meta', 'id_vendedor', 'periodo', 'meta_monto', 'sueldo_base', 'observaciones'];

// Hojas que hacen falta para calcular o mostrar una liquidación
const HOJAS_CALCULO = [
    HOJAS.usuarios, HOJAS.clientes, HOJAS.deudas, HOJAS.pagos, HOJAS.ventas, HOJAS.ventasDetalle, HOJAS.productos,
    HOJAS.metas, HOJAS.comisiones, HOJAS.comisionesDetalle, ...HOJAS_PRECIOS,
];

const filasCalculo = (hojas) => ({
    clientes: hojas[HOJAS.clientes].filas,
    deudas: hojas[HOJAS.deudas].filas,
    pagos: hojas[HOJAS.pagos].filas,
    ventas: hojas[HOJAS.ventas].filas,
    detalles: hojas[HOJAS.ventasDetalle].filas,
    catalogo: hojas[HOJAS.productos].filas,
    metas: hojas[HOJAS.metas].filas,
    config: configuracionDe(hojas),
});

// Periodo de la consulta (?periodo=YYYY-MM, por defecto el mes en curso) o null si no es válido
const periodoConsulta = (valor) => (aTexto(valor) ? aPeriodo(valor) : periodoActual());

const filaComision = (hojas, idVendedor, periodo) => hojas[HOJAS.comisiones].filas
    .find((c) => mismoId(c.id_vendedor, idVendedor) && aPeriodo(c.periodo) === periodo);

// Liquidación de un vendedor en el periodo: la guardada si el mes ya se cerró; si no, calculada en el momento
const liquidacionDe = (hojas, idVendedor, periodo) => {
    const guardada = filaComision(hojas, idVendedor, periodo);
    return guardada
        ? liquidacionGuardada(guardada, hojas[HOJAS.comisionesDetalle].filas, hojas[HOJAS.deudas].filas, hojas[HOJAS.clientes].filas)
        : calcularLiquidacion(idVendedor, periodo, filasCalculo(hojas));
};

// Un vendedor entra en la liquidación del mes si está activo o, inactivo, si tiene algo que liquidar
const participa = (vendedor, liquidacion) => vendedor.activo || liquidacion.id_comision
    || liquidacion.facturas.length > 0 || liquidacion.monto_cobrado > 0;

const totalesDe = (liquidaciones) => ({
    sueldos: sumar(liquidaciones, 'sueldo_base'),
    comisiones: sumar(liquidaciones, 'comision_pagada'),
    total: sumar(liquidaciones, 'total_a_pagar'),
});

// GET /bill/api/vendedores/comisiones?periodo=YYYY-MM
// Comisión del vendedor logueado en el mes (avance hacia la meta y facturas que comisionan) y sus meses cerrados
const obtenerMiComision = async (req, res) => {
    const periodo = periodoConsulta(req.query.periodo);
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });

    try {
        const hojas = await leerHojas(...HOJAS_CALCULO);
        const idVendedor = req.vendedor.id_vendedor;
        const historial = hojas[HOJAS.comisiones].filas
            .filter((c) => mismoId(c.id_vendedor, idVendedor))
            .sort(masRecientePrimero('periodo'))
            .map((c) => resumenLiquidacion(liquidacionGuardada(c, [], [], [])));

        return res.json({
            ok: true,
            solo_pagos_verificados: SOLO_PAGOS_VERIFICADOS,
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
            solo_pagos_verificados: SOLO_PAGOS_VERIFICADOS,
            totales: totalesDe(liquidaciones),
            liquidaciones,
        });
    } catch (error) {
        return responderError(res, error, 'Error al obtener las comisiones');
    }
};

// POST /bill/api/vendedores/admin/comisiones/:periodo/cerrar  (JSON opcional: { id_vendedor })
// Cierra el mes: guarda la liquidación de cada vendedor que aún no la tiene (o solo la de id_vendedor), el
// detalle por pago y producto, y marca las deudas liquidadas con su id_comision para no comisionarlas dos veces.
// Todos los vendedores que se cierran deben tener meta (hoja Metas).
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
                // Un vendedor sin meta y sin nada que liquidar se deja abierto (no tiene sueldo que pagar todavía)
                .filter(({ liquidacion: l }) => l.tiene_meta || l.facturas.length > 0 || l.monto_cobrado > 0);
            if (!porCerrar.length) return { status: 409, mensaje: `El mes ${periodo} ya está cerrado.` };

            const sinMeta = porCerrar.filter(({ liquidacion }) => !liquidacion.tiene_meta).map(({ vendedor }) => vendedor.nombre);
            if (sinMeta.length) {
                return { status: 409, mensaje: `Falta la meta del mes de: ${sinMeta.join(', ')}. Defínela antes de cerrar.` };
            }

            const comisiones = hojas[HOJAS.comisiones];
            const ids = siguientesIds(comisiones.filas, 'id_comision', 'COM', porCerrar.length);
            const fechaCierre = fechaHoraActual();
            const filas = porCerrar.map(({ liquidacion: l }, i) => ({
                id_comision: ids[i],
                id_vendedor: l.id_vendedor,
                periodo,
                sueldo_base: l.sueldo_base,
                meta_monto: l.meta_monto,
                monto_cobrado: l.monto_cobrado,
                meta_cumplida: l.meta_cumplida ? 'si' : 'no',
                comision_calculada: l.comision_calculada,
                comision_pagada: l.comision_pagada,
                total_a_pagar: l.total_a_pagar,
                estado: ESTADOS_COMISION.cerrada,
                fecha_cierre: fechaCierre,
                cerrado_por: req.vendedor.id_vendedor,
                fecha_pago: '',
            }));
            const detalle = porCerrar.flatMap(({ liquidacion: l }, i) => l.facturas
                .flatMap((f) => f.lineas.map((linea) => ({ ...linea, id_deuda: f.id_deuda, id_venta: f.id_venta, numero_factura: f.numero_factura })))
                .map((linea, n) => ({ id_detalle: `${ids[i]}-${n + 1}`, id_comision: ids[i], ...linea })));
            // Las deudas liquidadas guardan su comisión (y la fecha en que se cancelaron, si no la tenían)
            const deudas = hojas[HOJAS.deudas];
            const cambiosDeudas = porCerrar.flatMap(({ liquidacion: l }, i) => l.facturas.map((f) => {
                const deuda = deudas.filas.find((d) => mismoId(d.id_deuda, f.id_deuda));
                return {
                    fila: deuda._fila,
                    cambios: { id_comision: ids[i], ...(aTexto(deuda.fecha_cancelacion) ? {} : { fecha_cancelacion: f.fecha_cancelacion }) },
                };
            }));

            // Si algo falla a mitad, se vacían las filas ya escritas
            const escritas = [];
            try {
                escritas.push([HOJAS.comisiones, await agregarFilas(HOJAS.comisiones, filas, comisiones.encabezados)]);
                escritas.push([HOJAS.comisionesDetalle,
                    await agregarFilas(HOJAS.comisionesDetalle, detalle, hojas[HOJAS.comisionesDetalle].encabezados)]);
                await actualizarFilas(HOJAS.deudas, cambiosDeudas, deudas.encabezados);
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
            return { liquidacion: resumenLiquidacion(liquidacionGuardada({ ...fila, ...cambios }, [], [], [])) };
        });
        if (resultado.status) return res.status(resultado.status).json({ ok: false, mensaje: resultado.mensaje });

        registrarLog(req.vendedor.id_vendedor, 'pagar_comision', { id_comision: resultado.liquidacion.id_comision, fecha_pago: fechaPago });
        return res.json({ ok: true, mensaje: 'Liquidación marcada como pagada.', liquidacion: resultado.liquidacion });
    } catch (error) {
        return responderError(res, error, 'Error al marcar la liquidación como pagada');
    }
};

// DELETE /bill/api/vendedores/admin/comisiones/:id
// Reabre el mes de un vendedor (p. ej. si cambian las reglas): borra su liquidación y su detalle y libera sus
// deudas para que se vuelvan a calcular. Una liquidación ya pagada no se puede reabrir.
const reabrirComision = async (req, res) => {
    try {
        const resultado = await conBloqueo(async () => {
            const hojas = await leerHojas(HOJAS.comisiones, HOJAS.comisionesDetalle, HOJAS.deudas);
            const fila = hojas[HOJAS.comisiones].filas.find((c) => mismoId(c.id_comision, req.params.id));
            if (!fila) return { status: 404, mensaje: 'Liquidación no encontrada.' };
            if (aTexto(fila.estado).toLowerCase() === ESTADOS_COMISION.pagada) {
                return { status: 409, mensaje: 'Esa liquidación ya está pagada y no se puede reabrir.' };
            }

            const deudas = hojas[HOJAS.deudas];
            await actualizarFilas(HOJAS.deudas, deudas.filas
                .filter((d) => mismoId(d.id_comision, fila.id_comision))
                .map((d) => ({ fila: d._fila, cambios: { id_comision: '' } })), deudas.encabezados);
            await limpiarFilas(HOJAS.comisionesDetalle, hojas[HOJAS.comisionesDetalle].filas
                .filter((d) => mismoId(d.id_comision, fila.id_comision))
                .map((d) => d._fila));
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
// Meta vigente de cada vendedor en el mes (propia: true si se definió para ese mes; si no, viene de uno anterior)
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
                meta_monto: meta ? aMonto(meta.meta_monto) : null,
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
// body JSON: { id_vendedor, periodo, meta_monto, sueldo_base, observaciones? }
// Crea o reemplaza la meta del vendedor en ese mes (sigue vigente en los meses siguientes hasta que se cambie).
// Un mes ya cerrado no cambia: su liquidación guardó la meta que tenía.
const guardarMeta = async (req, res) => {
    const idVendedor = aTexto(req.body?.id_vendedor);
    const periodo = aPeriodo(req.body?.periodo);
    const metaMonto = leerMonto(req.body?.meta_monto);
    const sueldoBase = leerMonto(req.body?.sueldo_base);

    if (!idVendedor) return res.status(400).json({ ok: false, mensaje: 'El vendedor es obligatorio.' });
    if (!periodo) return res.status(400).json({ ok: false, mensaje: 'Periodo inválido. Usa el formato YYYY-MM.' });
    if (metaMonto === null) return res.status(400).json({ ok: false, mensaje: 'La meta debe ser un número mayor o igual a 0.' });
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
                return { status: 409, mensaje: `El mes ${periodo} de este vendedor ya está cerrado. Reábrelo para cambiar su meta.` };
            }

            const datos = { meta_monto: metaMonto, sueldo_base: sueldoBase, observaciones: aTexto(req.body?.observaciones) };
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
        return res.status(resultado.nueva ? 201 : 200).json({ ok: true, mensaje: 'Meta guardada.', meta: resultado.meta });
    } catch (error) {
        return responderError(res, error, 'Error al guardar la meta');
    }
};

module.exports = {
    obtenerMiComision,
    listarComisionesAdmin,
    cerrarComisiones,
    marcarComisionPagada,
    reabrirComision,
    listarMetas,
    guardarMeta,
};
