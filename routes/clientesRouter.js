const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { listarClientes, crearCliente, actualizarCliente } = require('../controllers/clientesController');

// Clientes del vendedor logueado (hoja Clientes)
const router = Router();

// GET /bill/api/vendedores/clientes?estado=&q=  (cada cliente trae su saldo_pendiente)
router.get('/', verificarTokenVendedor, listarClientes);

// POST /bill/api/vendedores/clientes  (genera id_cliente CLI-001, CLI-002...)
router.post('/', verificarTokenVendedor, crearCliente);

// PUT /bill/api/vendedores/clientes/:id
// body JSON: { nombre_comercial?, contacto_nombre?, telefono?, direccion?, limite_credito?, estado? }
router.put('/:id', verificarTokenVendedor, actualizarCliente);

module.exports = router;
