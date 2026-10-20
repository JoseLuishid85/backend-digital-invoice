const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { listarPagos, registrarPago } = require('../controllers/pagosController');

// Abonos a las deudas de los clientes del vendedor logueado (hoja Pagos)
const router = Router();

// GET /bill/api/vendedores/pagos?id_deuda=&id_cliente=
router.get('/', verificarTokenVendedor, listarPagos);

// POST /bill/api/vendedores/pagos  (actualiza monto_pagado, monto_pendiente y estado de la deuda)
// body JSON: { id_deuda, monto, metodo_pago, referencia?, fecha_pago?, comprobante_url? }
router.post('/', verificarTokenVendedor, registrarPago);

module.exports = router;
