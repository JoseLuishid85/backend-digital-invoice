// Prepara la hoja de cálculo para las bonificaciones. Se puede correr varias veces: solo agrega lo que falta y no
// borra ni cambia valores que ya tengan algo.
// - Productos: columnas cuota_mensual (unidades) y valor_representativo (%).
// - Plazos: columna bonificacion_pct, sembrada con CONT 100, CRED1 90, CRED2 80, CRED3 60 donde esté vacía.
// - Comisiones: columnas de las cuatro bonificaciones (las del sistema anterior quedan como están).
// - Crea las pestañas Bonificaciones_Detalle, Visitas y Reglas_Bonificacion (esta con sus valores iniciales: plazo
//   CRED3, 50 visitas → 200 $, 5 clientes nuevos → 150 $).
// Uso: node scripts/prepararBonificaciones.js
require('dotenv').config({ quiet: true });
const {
    HOJAS, crearPestana, agregarColumnas, leerHoja, agregarFilas, actualizarFilas,
} = require('../services/googleSheetsService');
const {
    COLUMNAS_CUOTA, COLUMNAS_CIERRE, COLUMNAS_REGLAS, COLUMNAS_VISITAS, COLUMNA_PCT_PLAZO, REGLAS_POR_DEFECTO,
    DESCRIPCION_REGLAS, PORCENTAJE_PLAZO_INICIAL,
} = require('../utils/comisiones');
const { aTexto } = require('../utils/cartera');

const DETALLE = ['id_detalle', 'id_comision', 'id_producto', 'producto', 'cuota_mensual', 'unidades', 'cumplimiento',
    'porcentaje_aplicado', 'valor_representativo', 'sueldo_base', 'bonificacion'];

const PESTANAS = {
    [HOJAS.bonificacionesDetalle]: DETALLE,
    [HOJAS.visitas]: COLUMNAS_VISITAS,
    [HOJAS.reglasBonificacion]: COLUMNAS_REGLAS,
};

const COLUMNAS_NUEVAS = {
    [HOJAS.productos]: COLUMNAS_CUOTA,
    [HOJAS.plazos]: [COLUMNA_PCT_PLAZO],
    [HOJAS.comisiones]: COLUMNAS_CIERRE,
    [HOJAS.metas]: ['id_meta', 'id_vendedor', 'periodo', 'sueldo_base', 'observaciones'],
};

// Agrega a Reglas_Bonificacion las claves que falten con su valor inicial
const sembrarReglas = async () => {
    const { encabezados, filas } = await leerHoja(HOJAS.reglasBonificacion);
    const existentes = new Set(filas.map((f) => aTexto(f.clave).toLowerCase()));
    const nuevas = Object.entries(REGLAS_POR_DEFECTO)
        .filter(([clave]) => !existentes.has(clave))
        .map(([clave, valor]) => ({ clave, valor, descripcion: DESCRIPCION_REGLAS[clave] }));
    if (nuevas.length) await agregarFilas(HOJAS.reglasBonificacion, nuevas, encabezados);
    console.log(nuevas.length
        ? `"${HOJAS.reglasBonificacion}": reglas agregadas: ${nuevas.map((n) => `${n.clave}=${n.valor}`).join(', ')}.`
        : `"${HOJAS.reglasBonificacion}": ya tenía sus reglas.`);
};

// Llena bonificacion_pct de los plazos conocidos que la tengan vacía
const sembrarPlazos = async () => {
    const { encabezados, filas } = await leerHoja(HOJAS.plazos);
    const cambios = filas
        .filter((p) => aTexto(p[COLUMNA_PCT_PLAZO]) === '' && PORCENTAJE_PLAZO_INICIAL[aTexto(p.id_plazo).toUpperCase()] !== undefined)
        .map((p) => ({ fila: p._fila, cambios: { [COLUMNA_PCT_PLAZO]: PORCENTAJE_PLAZO_INICIAL[aTexto(p.id_plazo).toUpperCase()] } }));
    await actualizarFilas(HOJAS.plazos, cambios, encabezados);
    console.log(cambios.length
        ? `"${HOJAS.plazos}": % de bonificación cargado en ${cambios.length} plazos.`
        : `"${HOJAS.plazos}": sus % de bonificación ya tenían valor.`);
};

const preparar = async () => {
    for (const [hoja, encabezados] of Object.entries(PESTANAS)) {
        const creada = await crearPestana(hoja, encabezados);
        console.log(creada ? `Pestaña "${hoja}" creada.` : `Pestaña "${hoja}" ya existía.`);
    }

    for (const [hoja, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
        try {
            const agregadas = await agregarColumnas(hoja, columnas);
            console.log(agregadas.length ? `"${hoja}": columnas agregadas: ${agregadas.join(', ')}.` : `"${hoja}": ya tenía sus columnas.`);
        } catch (error) {
            console.warn(`"${hoja}": no se pudo revisar (${error.message}). Si falta la pestaña, créala con sus encabezados.`);
        }
    }

    await sembrarReglas();
    await sembrarPlazos();
    console.log('Listo. Carga las cuotas y revisa las reglas en la app (menú Bonificaciones).');
};

preparar().catch((error) => {
    console.error('Error al preparar la hoja:', error.message);
    process.exit(1);
});
