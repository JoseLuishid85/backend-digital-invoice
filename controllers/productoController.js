const { Op, fn, col } = require('sequelize');
const { Factura, DetalleFactura } = require('../models');

const LIMITE_RESULTADOS = 100;

// Escapa los comodines de LIKE para que '%' o '_' se busquen como texto literal
const escaparLike = (texto) => texto.replace(/[\\%_]/g, '\\$&');

const buscarProductos = async (req, res) => {
    const q = String(req.query.q || '').trim();

    if (q.length < 2) {
        return res.status(400).json({ ok: false, mensaje: 'Escribe al menos 2 caracteres para buscar.' });
    }

    const filtro = { descripcion: { [Op.like]: `%${escaparLike(q)}%` } };

    try {
        // Resumen de precios sobre TODAS las coincidencias (no solo las devueltas)
        const [resumen] = await DetalleFactura.findAll({
            where: filtro,
            attributes: [
                [fn('COUNT', col('id')), 'coincidencias'],
                [fn('MIN', col('precio_unitario')), 'precio_minimo'],
                [fn('MAX', col('precio_unitario')), 'precio_maximo'],
                [fn('AVG', col('precio_unitario')), 'precio_promedio'],
            ],
            raw: true,
        });

        const productos = await DetalleFactura.findAll({
            where: filtro,
            include: [{
                model: Factura,
                as: 'factura',
                attributes: ['id', 'nombre_empresa', 'numero_factura', 'fecha'],
            }],
            // Agrupa el mismo producto por nombre y, dentro de él, primero la fecha más reciente
            order: [
                ['descripcion', 'ASC'],
                [{ model: Factura, as: 'factura' }, 'fecha', 'DESC'],
                ['id', 'DESC'],
            ],
            limit: LIMITE_RESULTADOS,
        });

        return res.json({
            ok: true,
            busqueda: q,
            resumen: {
                coincidencias: Number(resumen.coincidencias),
                precio_minimo: resumen.precio_minimo,
                precio_maximo: resumen.precio_maximo,
                precio_promedio: resumen.precio_promedio,
            },
            limite: LIMITE_RESULTADOS,
            productos,
        });
    } catch (error) {
        console.error('Error al buscar productos:', error);
        return res.status(500).json({ ok: false, mensaje: 'Error al buscar productos.' });
    }
};

module.exports = { buscarProductos };
