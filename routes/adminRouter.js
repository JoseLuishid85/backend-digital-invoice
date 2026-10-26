const { Router } = require('express');
const { verificarTokenVendedor, verificarAdministrador } = require('../middlewares/authVendedoresMiddleware');
const { obtenerResumenAdmin, listarVentasAdmin, listarDeudasAdmin } = require('../controllers/adminController');

// Consultas del administrador sobre todos los vendedores (nivel_acceso Administrador en la hoja Usuarios)
const router = Router();
const soloAdministrador = [verificarTokenVendedor, verificarAdministrador];

// GET /bill/api/vendedores/admin/resumen
router.get('/resumen', soloAdministrador, obtenerResumenAdmin);

// GET /bill/api/vendedores/admin/ventas?id_vendedor=&tipo_pago=&desde=&hasta=
router.get('/ventas', soloAdministrador, listarVentasAdmin);

// GET /bill/api/vendedores/admin/deudas?id_vendedor=&estado=
router.get('/deudas', soloAdministrador, listarDeudasAdmin);

module.exports = router;
