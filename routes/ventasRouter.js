const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { listarVentas, registrarEntrega } = require('../controllers/ventasController');

// Ventas y entregas del vendedor logueado (hojas Ventas y Ventas_Detalle)
const router = Router();

// GET /bill/api/vendedores/ventas?id_cliente=&tipo_pago=&estado_entrega=&desde=&hasta=
router.get('/', verificarTokenVendedor, listarVentas);

// Las ventas se crean al entregar un pedido: POST /bill/api/vendedores/pedidos/:id/entrega

// PATCH /bill/api/vendedores/ventas/:id/entrega  (body JSON: { fecha_entrega?, nota_entrega? })
// Solo para las ventas anteriores a los pedidos que quedaron por entregar
router.patch('/:id/entrega', verificarTokenVendedor, registrarEntrega);

module.exports = router;
