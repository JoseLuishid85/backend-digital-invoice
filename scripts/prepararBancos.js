// Prepara la hoja de cálculo para el banco receptor de los pagos. Se puede correr varias veces: solo agrega lo que falta.
// - Bancos: columna receptor. Escribe "si" en los bancos donde la empresa tiene cuenta (los que se ofrecen como
//   banco receptor); si no se marca ninguno, se ofrecen todos.
// - Pagos: columna banco_receptor (banco al que llegó el pago móvil o la transferencia).
// Uso: node scripts/prepararBancos.js
require('dotenv').config({ quiet: true });
const { HOJAS, agregarColumnas } = require('../services/googleSheetsService');

const COLUMNAS_NUEVAS = {
    [HOJAS.bancos]: ['receptor'],
    [HOJAS.pagos]: ['banco_receptor'],
};

const preparar = async () => {
    for (const [hoja, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
        const agregadas = await agregarColumnas(hoja, columnas);
        console.log(agregadas.length
            ? `Pestaña "${hoja}": columnas agregadas ${agregadas.join(', ')}.`
            : `Pestaña "${hoja}": ya tenía las columnas.`);
    }
    console.log('Listo. Marca con "si" en Bancos.receptor los bancos donde la empresa recibe pagos.');
};

preparar().catch((error) => {
    console.error('Error al preparar la hoja:', error.message);
    process.exit(1);
});
