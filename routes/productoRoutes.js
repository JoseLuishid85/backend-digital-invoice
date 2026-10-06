const { Router } = require('express');
const { buscarProductos } = require('../controllers/productoController');

const router = Router();

// GET /invoice/api/productos/buscar?q=texto
router.get('/buscar', buscarProductos);

module.exports = router;
