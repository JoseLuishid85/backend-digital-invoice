const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { consultarVentas, consultarPedidos } = require('../controllers/consultasController');

// Consultas del vendedor logueado (las de todos están en /admin/consultas)
const router = Router();

// GET /bill/api/vendedores/consultas/ventas?desde=&hasta=&agrupar=dia|semana|mes
router.get('/ventas', verificarTokenVendedor, consultarVentas);

// GET /bill/api/vendedores/consultas/pedidos?estado=pendiente|entregado|anulado&desde=&hasta=
router.get('/pedidos', verificarTokenVendedor, consultarPedidos);

module.exports = router;
