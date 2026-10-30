const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const {
    listarPedidos,
    obtenerPedido,
    crearPedido,
    actualizarPedido,
    anularPedido,
    entregarPedido,
} = require('../controllers/pedidosController');

// Pedidos del vendedor logueado (hojas Pedidos y Pedidos_Detalle). Al entregarse pasan a venta.
const router = Router();

// GET /bill/api/vendedores/pedidos?estado=pendiente|entregado|anulado&id_cliente=&desde=&hasta=
router.get('/', verificarTokenVendedor, listarPedidos);

// GET /bill/api/vendedores/pedidos/:id
router.get('/:id', verificarTokenVendedor, obtenerPedido);

// POST /bill/api/vendedores/pedidos  (genera id_pedido PED-001...; sin forma de pago)
// JSON: { id_cliente, productos: [{ producto, cantidad, id_producto? }] (precio de factura del catálogo),
//         fecha_pedido?, observaciones? }
router.post('/', verificarTokenVendedor, crearPedido);

// PUT /bill/api/vendedores/pedidos/:id  (mismo cuerpo que crear; solo pedidos pendientes)
router.put('/:id', verificarTokenVendedor, actualizarPedido);

// PATCH /bill/api/vendedores/pedidos/:id/anular  (JSON: { motivo? }; solo pedidos pendientes)
router.patch('/:id/anular', verificarTokenVendedor, anularPedido);

// POST /bill/api/vendedores/pedidos/:id/entrega  (crea la venta, su número de factura y su deuda)
// JSON: { fecha_entrega?, nota_entrega?, productos?: [{ id_detalle, cantidad }] (sin productos = todo lo pedido) }
router.post('/:id/entrega', verificarTokenVendedor, entregarPedido);

module.exports = router;
