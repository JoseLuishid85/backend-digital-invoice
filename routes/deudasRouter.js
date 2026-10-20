const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { listarDeudas, crearDeuda } = require('../controllers/deudasController');

// Cuentas por cobrar de los clientes del vendedor logueado (hoja Deudas)
const router = Router();

// GET /bill/api/vendedores/deudas?id_cliente=&estado=
router.get('/', verificarTokenVendedor, listarDeudas);

// POST /bill/api/vendedores/deudas
// body JSON: { id_cliente, monto_total, numero_factura?, fecha_emision?, fecha_vencimiento?, observaciones? }
router.post('/', verificarTokenVendedor, crearDeuda);

module.exports = router;
