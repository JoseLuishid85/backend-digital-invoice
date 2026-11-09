// Prepara la hoja de cálculo para la bonificación por cuota de ventas. Se puede correr varias veces: solo agrega
// lo que falta y no borra nada.
// - Productos: columnas cuota_mensual (unidades) y valor_representativo (%).
// - Comisiones: columnas unidades_vendidas y bonificacion (las del sistema anterior quedan como están).
// - Crea la pestaña Bonificaciones_Detalle con sus encabezados.
// Uso: node scripts/prepararBonificaciones.js
require('dotenv').config({ quiet: true });
const { HOJAS, crearPestana, agregarColumnas } = require('../services/googleSheetsService');
const { COLUMNAS_CUOTA } = require('../utils/comisiones');

const DETALLE = ['id_detalle', 'id_comision', 'id_producto', 'producto', 'cuota_mensual', 'unidades', 'cumplimiento',
    'porcentaje_aplicado', 'valor_representativo', 'sueldo_base', 'bonificacion'];

const COLUMNAS_NUEVAS = {
    [HOJAS.productos]: COLUMNAS_CUOTA,
    [HOJAS.comisiones]: ['id_comision', 'id_vendedor', 'periodo', 'sueldo_base', 'unidades_vendidas', 'bonificacion',
        'total_a_pagar', 'estado', 'fecha_cierre', 'cerrado_por', 'fecha_pago'],
    [HOJAS.metas]: ['id_meta', 'id_vendedor', 'periodo', 'sueldo_base', 'observaciones'],
};

const preparar = async () => {
    const creada = await crearPestana(HOJAS.bonificacionesDetalle, DETALLE);
    console.log(creada ? `Pestaña "${HOJAS.bonificacionesDetalle}" creada.` : `Pestaña "${HOJAS.bonificacionesDetalle}" ya existía.`);

    for (const [hoja, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
        try {
            const agregadas = await agregarColumnas(hoja, columnas);
            console.log(agregadas.length ? `"${hoja}": columnas agregadas: ${agregadas.join(', ')}.` : `"${hoja}": ya tenía sus columnas.`);
        } catch (error) {
            console.warn(`"${hoja}": no se pudo revisar (${error.message}). Si falta la pestaña, créala con sus encabezados.`);
        }
    }
    console.log('Listo. Carga la cuota y el valor representativo de cada producto en la app (Bonificaciones > Cuotas por producto).');
};

preparar().catch((error) => {
    console.error('Error al preparar la hoja:', error.message);
    process.exit(1);
});
