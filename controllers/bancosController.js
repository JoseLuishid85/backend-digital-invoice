const { HOJAS, leerHoja } = require('../services/googleSheetsService');
const { aTexto, responderError } = require('../utils/cartera');

// GET /bill/api/vendedores/bancos
// Bancos activos de la hoja Bancos (estado Activo o vacío), ordenados por código, para pago móvil y transferencia
const listarBancos = async (req, res) => {
    try {
        const bancos = (await leerHoja(HOJAS.bancos)).filas
            .filter((b) => ['', 'activo'].includes(aTexto(b.estado).toLowerCase()))
            .map((b) => ({ id_banco: aTexto(b.id_banco), cod_banco: aTexto(b.cod_banco), nombre: aTexto(b.nombre) }))
            .filter((b) => b.id_banco)
            .sort((a, b) => a.cod_banco.localeCompare(b.cod_banco) || a.nombre.localeCompare(b.nombre, 'es'));

        return res.json({ ok: true, bancos });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los bancos');
    }
};

module.exports = { listarBancos };
