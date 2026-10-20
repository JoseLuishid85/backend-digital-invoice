const { HOJAS, leerHoja, agregarFila, siguienteId, conBloqueo } = require('./googleSheetsService');
const { fechaHoraActual } = require('../utils/cartera');

// Registra una acción en Historial_Logs. Si falla no interrumpe la operación principal.
const registrarLog = (idVendedor, accion, detalles = {}) =>
    conBloqueo(async () => {
        const { encabezados, filas } = await leerHoja(HOJAS.logs);
        await agregarFila(HOJAS.logs, {
            id_log: siguienteId(filas, 'id_log', 'LOG'),
            id_vendedor: idVendedor,
            accion,
            detalles: typeof detalles === 'string' ? detalles : JSON.stringify(detalles),
            fecha: fechaHoraActual(),
        }, encabezados);
    }).catch((error) => {
        console.error(`Error al registrar el log "${accion}":`, error.message);
    });

module.exports = { registrarLog };
