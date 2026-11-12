const { HOJAS, leerHoja } = require('../services/googleSheetsService');
const { aTexto, responderError } = require('../utils/cartera');
const { bancosReceptores } = require('../utils/cobros');

const ordenarBancos = (a, b) => a.cod_banco.localeCompare(b.cod_banco) || a.nombre.localeCompare(b.nombre, 'es');
const formatearBanco = (b) => ({ id_banco: aTexto(b.id_banco), cod_banco: aTexto(b.cod_banco), nombre: aTexto(b.nombre) });

// GET /bill/api/vendedores/bancos
// Bancos activos de la hoja Bancos (estado Activo o vacío), ordenados por código, para pago móvil y transferencia.
// bancos: desde los que puede pagar el cliente; receptores: a los que puede llegar el pago (los marcados con
// receptor = si; si no hay ninguno marcado, todos)
const listarBancos = async (req, res) => {
    try {
        const filas = (await leerHoja(HOJAS.bancos)).filas;
        const bancos = filas
            .filter((b) => ['', 'activo'].includes(aTexto(b.estado).toLowerCase()))
            .map(formatearBanco)
            .filter((b) => b.id_banco)
            .sort(ordenarBancos);
        const receptores = bancosReceptores(filas).map(formatearBanco).sort(ordenarBancos);

        return res.json({ ok: true, bancos, receptores });
    } catch (error) {
        return responderError(res, error, 'Error al obtener los bancos');
    }
};

module.exports = { listarBancos };
