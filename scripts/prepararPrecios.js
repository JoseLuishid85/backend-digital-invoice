// Prepara la hoja de cálculo para el motor de precios. Se puede correr varias veces: solo agrega lo que falta.
// - Crea las pestañas Niveles, Plazos y Precios con sus encabezados; Niveles y Plazos con sus valores iniciales.
// - Agrega las columnas nuevas: comision (Productos), id_nivel (Pedidos_Detalle y Ventas_Detalle),
//   id_plazo (Pagos y Comisiones_Detalle).
// - No borra nada: al final lista las columnas viejas de Productos que ya no se usan, para quitarlas a mano.
// Uso: node scripts/prepararPrecios.js
require('dotenv').config({ quiet: true });
const {
    HOJAS, leerHoja, agregarFilas, crearPestana, agregarColumnas,
} = require('../services/googleSheetsService');
const { COLUMNAS_PRECIOS } = require('../utils/precios');

// Valores iniciales (se cambian luego en la hoja). unidades_hasta / dias_hasta vacío = sin límite.
const NIVELES = [
    { id_nivel: 'L1', nombre: 'Nivel 1', unidades_desde: 0, unidades_hasta: 99, estado: 'Activo' },
    { id_nivel: 'L2', nombre: 'Nivel 2', unidades_desde: 100, unidades_hasta: 299, estado: 'Activo' },
    { id_nivel: 'L3', nombre: 'Nivel 3', unidades_desde: 300, unidades_hasta: 599, estado: 'Activo' },
    { id_nivel: 'L4', nombre: 'Nivel 4', unidades_desde: 600, unidades_hasta: '', estado: 'Activo' },
];
const PLAZOS = [
    { id_plazo: 'CONT', nombre: 'Contado', dias_desde: 0, dias_hasta: 9, se_factura: 'no', orden: 1, estado: 'Activo' },
    { id_plazo: 'CRED1', nombre: 'Crédito 1', dias_desde: 10, dias_hasta: 15, se_factura: 'no', orden: 2, estado: 'Activo' },
    { id_plazo: 'CRED2', nombre: 'Crédito 2', dias_desde: 16, dias_hasta: '', se_factura: 'si', orden: 3, estado: 'Activo' },
];

const COLUMNAS_NUEVAS = {
    [HOJAS.productos]: ['comision'],
    [HOJAS.pedidosDetalle]: ['id_nivel'],
    [HOJAS.ventasDetalle]: ['id_nivel'],
    [HOJAS.pagos]: ['id_plazo'],
    [HOJAS.comisionesDetalle]: ['id_plazo'],
};
const COLUMNAS_VIEJAS = ['precio', 'precio_contado', 'precio_7', 'precio_15', 'precio_30',
    'comision_contado', 'comision_7', 'comision_15', 'comision_30'];

const preparar = async () => {
    for (const [hoja, columnas] of Object.entries(COLUMNAS_PRECIOS)) {
        const creada = await crearPestana(hoja, columnas);
        console.log(creada ? `Pestaña "${hoja}" creada.` : `Pestaña "${hoja}" ya existía.`);
    }
    for (const [hoja, filas] of [[HOJAS.niveles, NIVELES], [HOJAS.plazos, PLAZOS]]) {
        const actual = await leerHoja(hoja);
        if (actual.filas.length) {
            console.log(`"${hoja}" ya tiene datos: no se cargan los valores iniciales.`);
            continue;
        }
        await agregarFilas(hoja, filas, actual.encabezados);
        console.log(`"${hoja}": ${filas.length} filas iniciales cargadas.`);
    }

    for (const [hoja, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
        try {
            const agregadas = await agregarColumnas(hoja, columnas);
            console.log(agregadas.length ? `"${hoja}": columnas agregadas: ${agregadas.join(', ')}.` : `"${hoja}": ya tenía sus columnas.`);
        } catch (error) {
            console.warn(`"${hoja}": no se pudo revisar (${error.message}).`);
        }
    }

    const { encabezados } = await leerHoja(HOJAS.productos);
    const viejas = COLUMNAS_VIEJAS.filter((c) => encabezados.includes(c));
    if (viejas.length) {
        console.log(`\nColumnas de "${HOJAS.productos}" que ya no se usan (puedes borrarlas a mano): ${viejas.join(', ')}.`);
    }
    console.log(`\nListo. Carga los precios de cada producto desde la app (Productos → editar) o en la pestaña "${HOJAS.precios}".`);
};

preparar().catch((error) => {
    console.error('No se pudo preparar la hoja:', error.message);
    process.exit(1);
});
