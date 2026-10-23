const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { subirComprobantes } = require('../middlewares/uploadComprobantes');
const { listarPagos, registrarPago, obtenerComprobante } = require('../controllers/pagosController');

// Pagos de los clientes del vendedor logueado (hoja Pagos): abonos a deudas y cobros de ventas de contado
const router = Router();

// GET /bill/api/vendedores/pagos?id_deuda=&id_venta=&id_cliente=
router.get('/', verificarTokenVendedor, listarPagos);

// POST /bill/api/vendedores/pagos  (abono a una deuda, con una o varias formas de pago)
// multipart: datos = JSON { id_deuda, fecha_pago?, tasa_bcv?, pagos: [{ metodo, monto, referencia? }] }
//            + comprobante_<n> opcional (foto o PDF de la forma de pago n)
router.post('/', verificarTokenVendedor, subirComprobantes, registrarPago);

// GET /bill/api/vendedores/pagos/:id/comprobante  (foto o PDF del pago)
router.get('/:id/comprobante', verificarTokenVendedor, obtenerComprobante);

module.exports = router;
