const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { listarVentas, crearVenta, registrarEntrega } = require('../controllers/ventasController');

// Ventas y entregas del vendedor logueado (hojas Ventas y Ventas_Detalle)
const router = Router();

// GET /bill/api/vendedores/ventas?id_cliente=&tipo_pago=&estado_entrega=&desde=&hasta=
router.get('/', verificarTokenVendedor, listarVentas);

// POST /bill/api/vendedores/ventas  (genera id_venta VEN-001...; si es a crédito crea también la deuda)
// body JSON: { id_cliente, tipo_pago, productos: [{ producto, cantidad, precio_unitario, id_producto? }],
//              numero_factura?, fecha_venta?, fecha_vencimiento?, entregada?, observaciones? }
router.post('/', verificarTokenVendedor, crearVenta);

// PATCH /bill/api/vendedores/ventas/:id/entrega  (body JSON: { fecha_entrega?, nota_entrega? })
router.patch('/:id/entrega', verificarTokenVendedor, registrarEntrega);

module.exports = router;
