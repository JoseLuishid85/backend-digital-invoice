const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { consultarVentas } = require('../controllers/consultasController');

// Consultas del vendedor logueado (las de todos están en /admin/consultas)
const router = Router();

// GET /bill/api/vendedores/consultas/ventas?desde=&hasta=&agrupar=dia|semana|mes
router.get('/ventas', verificarTokenVendedor, consultarVentas);

module.exports = router;
