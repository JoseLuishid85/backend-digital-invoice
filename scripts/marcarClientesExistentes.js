// Marca los clientes que ya existen como "cliente_existente" para que nunca cuenten en la bonificación por clientes
// nuevos (a ellos ya se les han hecho facturas). Agrega la columna a la pestaña Clientes si falta y escribe "si" en
// cada cliente que la tenga vacía. Los que ya digan "no" (los que el vendedor registra desde la app) no se tocan.
// Pensado para correrse una vez al estrenar la regla. Ojo: si se corre más tarde, marca también los clientes que
// hayan llegado vacíos después (p. ej. los copiados de Saint).
// Uso: node scripts/marcarClientesExistentes.js [--simular]
require('dotenv').config({ quiet: true });
const { HOJAS, leerHoja, agregarColumnas, actualizarFilas } = require('../services/googleSheetsService');
const { COLUMNA_CLIENTE_EXISTENTE } = require('../utils/comisiones');
const { aTexto } = require('../utils/cartera');

const simular = process.argv.includes('--simular');

const marcar = async () => {
    if (!simular) {
        const agregadas = await agregarColumnas(HOJAS.clientes, [COLUMNA_CLIENTE_EXISTENTE]);
        if (agregadas.length) console.log(`"${HOJAS.clientes}": columna ${COLUMNA_CLIENTE_EXISTENTE} agregada.`);
    }
    const { encabezados, filas } = await leerHoja(HOJAS.clientes);
    const porMarcar = filas.filter((c) => aTexto(c.id_cliente) && aTexto(c[COLUMNA_CLIENTE_EXISTENTE]) === '');
    const yaMarcados = filas.length - porMarcar.length;

    if (!simular) {
        await actualizarFilas(HOJAS.clientes, porMarcar.map((c) => ({
            fila: c._fila, cambios: { [COLUMNA_CLIENTE_EXISTENTE]: 'si' },
        })), encabezados);
    }
    console.log(`${simular ? '[Simulación] Se marcarían' : 'Marcados'} ${porMarcar.length} clientes como existentes`
        + ` (${yaMarcados} ya tenían valor).`);
};

marcar().catch((error) => {
    console.error('Error al marcar los clientes:', error.message);
    process.exit(1);
});
