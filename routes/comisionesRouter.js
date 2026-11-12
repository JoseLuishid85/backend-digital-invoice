const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');

// Bonificaciones del vendedor logueado: por decisión de la empresa el vendedor no ve sus comisiones ni
// bonificaciones; la liquidación solo la ve el administrador (/admin/comisiones). obtenerMiComision
// (comisionesController.js) queda sin ruta por si se vuelve a habilitar.
const router = Router();

// GET /bill/api/vendedores/comisiones?periodo=YYYY-MM
router.get('/', verificarTokenVendedor, (req, res) => res.status(403).json({
    ok: false,
    mensaje: 'Las bonificaciones solo las puede consultar la administración.',
}));

module.exports = router;
