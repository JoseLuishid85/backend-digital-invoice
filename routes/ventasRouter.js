const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { subirComprobantes } = require('../middlewares/uploadComprobantes');
const { listarVentas, crearVenta, registrarEntrega } = require('../controllers/ventasController');

// Ventas y entregas del vendedor logueado (hojas Ventas y Ventas_Detalle)
const router = Router();

// GET /bill/api/vendedores/ventas?id_cliente=&tipo_pago=&estado_entrega=&desde=&hasta=
router.get('/', verificarTokenVendedor, listarVentas);

// POST /bill/api/vendedores/ventas  (genera id_venta VEN-001...; si es a crédito crea también la deuda)
// multipart: datos = JSON { id_cliente, tipo_pago, plazo_dias? (7, 15 o 30 si es a crédito),
//              productos: [{ producto, cantidad, id_producto? }] (el precio sale del catálogo según contado o plazo),
//              pagos? (contado: [{ metodo, monto, referencia? }] que sumen el total),
//              fecha_venta?, entregada?, observaciones? }  (numero_factura se asigna solo: 000001, 000002...)
//            + comprobante_<n> opcional (foto o PDF de la forma de pago n). También acepta el JSON como body.
router.post('/', verificarTokenVendedor, subirComprobantes, crearVenta);

// PATCH /bill/api/vendedores/ventas/:id/entrega  (body JSON: { fecha_entrega?, nota_entrega? })
router.patch('/:id/entrega', verificarTokenVendedor, registrarEntrega);

module.exports = router;
