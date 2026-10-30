const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { obtenerMiComision } = require('../controllers/comisionesController');

// Comisión del vendedor logueado (la liquidación de todos está en /admin/comisiones)
const router = Router();

// GET /bill/api/vendedores/comisiones?periodo=YYYY-MM
router.get('/', verificarTokenVendedor, obtenerMiComision);

module.exports = router;
