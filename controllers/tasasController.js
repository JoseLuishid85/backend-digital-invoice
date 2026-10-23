const { registrarLog } = require('../services/historialService');
const { tasaDelDia, guardarTasa } = require('../utils/tasaDolar');
const { responderError } = require('../utils/cartera');
const { aNumeroOpcional, aFecha, fechaHoy } = require('../utils/valores');

// GET /bill/api/vendedores/tasas/:fecha  (YYYY-MM-DD o "hoy")
// La tasa guardada ese día o, si no hay, la del BCV (que queda guardada). 404 si no se pudo obtener.
const obtenerTasa = async (req, res) => {
    const fecha = req.params.fecha === 'hoy' ? fechaHoy() : aFecha(req.params.fecha);
    if (!fecha) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }

    try {
        const tasa = await tasaDelDia(fecha);
        if (!tasa) {
            return res.status(404).json({ ok: false, mensaje: 'No se pudo obtener la tasa del dólar para esa fecha.' });
        }
        return res.json({ ok: true, tasa });
    } catch (error) {
        return responderError(res, error, 'Error al obtener la tasa del dólar');
    }
};

// PUT /bill/api/vendedores/tasas/:fecha  (body JSON: { tasa })
// Crea o corrige a mano la tasa de un día
const guardarTasaManual = async (req, res) => {
    const fecha = aFecha(req.params.fecha);
    const valor = aNumeroOpcional(req.body?.tasa);
    if (!fecha) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }
    if (!valor) {
        return res.status(400).json({ ok: false, mensaje: 'La tasa debe ser un número mayor que 0.' });
    }

    try {
        const tasa = await guardarTasa(fecha, valor, 'manual');
        registrarLog(req.vendedor.id_vendedor, 'guardar_tasa', { fecha, tasa: tasa.tasa });
        return res.json({ ok: true, mensaje: 'Tasa guardada.', tasa });
    } catch (error) {
        return responderError(res, error, 'Error al guardar la tasa del dólar');
    }
};

module.exports = { obtenerTasa, guardarTasaManual };
