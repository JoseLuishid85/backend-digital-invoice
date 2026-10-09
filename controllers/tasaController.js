const { TasaDia } = require('../models');
const { aNumeroOpcional, aFecha } = require('../utils/valores');
const { buscarTasaDelDia } = require('../utils/tasaBcv');

const LIMITE_TASAS = 90;

const listarTasas = async (req, res) => {
    try {
        const tasas = await TasaDia.findAll({
            order: [['fecha', 'DESC']],
            limit: LIMITE_TASAS,
        });
        return res.json({ ok: true, tasas });
    } catch (error) {
        console.error('Error al listar las tasas:', error);
        return res.status(500).json({ ok: false, mensaje: 'Error al obtener las tasas del día.' });
    }
};

// Crea o reemplaza la tasa de un día (solo hay un registro por fecha)
const guardarTasa = async (req, res) => {
    const fecha = aFecha(req.params.fecha);
    if (!fecha) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }

    const tasa = aNumeroOpcional(req.body?.tasa);
    if (!tasa) {
        return res.status(400).json({ ok: false, mensaje: 'La tasa debe ser un número mayor que 0.' });
    }

    try {
        const existente = await TasaDia.findOne({ where: { fecha } });
        if (existente) {
            await existente.update({ tasa });
            return res.json({ ok: true, mensaje: 'Tasa del día actualizada.', tasa: existente });
        }

        const nueva = await TasaDia.create({ fecha, tasa });
        return res.status(201).json({ ok: true, mensaje: 'Tasa del día registrada.', tasa: nueva });
    } catch (error) {
        console.error('Error al guardar la tasa:', error);
        return res.status(500).json({ ok: false, mensaje: 'Error al guardar la tasa del día.' });
    }
};

// Tasa sugerida para una fecha: la registrada ese día o, si no hay, la oficial del BCV. No guarda nada.
const obtenerTasaSugerida = async (req, res) => {
    const fecha = aFecha(req.params.fecha);
    if (!fecha) {
        return res.status(400).json({ ok: false, mensaje: 'Fecha inválida. Usa el formato YYYY-MM-DD.' });
    }

    try {
        const { tasa, origen } = await buscarTasaDelDia(fecha);
        return res.json({ ok: true, fecha, tasa, origen });
    } catch (error) {
        console.error('Error al buscar la tasa sugerida:', error);
        return res.status(500).json({ ok: false, mensaje: 'Error al buscar la tasa del día.' });
    }
};

module.exports = { listarTasas, guardarTasa, obtenerTasaSugerida };
