const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { obtenerResumen } = require('../controllers/resumenController');

// Cifras de inicio del vendedor logueado
const router = Router();

// GET /bill/api/vendedores/resumen
router.get('/', verificarTokenVendedor, obtenerResumen);

module.exports = router;
