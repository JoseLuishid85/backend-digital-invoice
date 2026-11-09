const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { listarVisitas, registrarVisita, eliminarVisita } = require('../controllers/visitasController');

// Visitas del vendedor logueado a sus clientes (hoja Visitas; cuentan para la bonificación por clientes visitados)
const router = Router();

// GET /bill/api/vendedores/visitas?periodo=YYYY-MM&id_cliente=
router.get('/', verificarTokenVendedor, listarVisitas);

// POST /bill/api/vendedores/visitas  (JSON: { id_cliente, fecha_visita?, resultado?, observaciones? })
router.post('/', verificarTokenVendedor, registrarVisita);

// DELETE /bill/api/vendedores/visitas/:id
router.delete('/:id', verificarTokenVendedor, eliminarVisita);

module.exports = router;
