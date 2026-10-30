const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { listarBancos } = require('../controllers/bancosController');

// Bancos para las formas de pago pago móvil y transferencia (hoja Bancos: id_banco, cod_banco, nombre, estado)
const router = Router();

// GET /bill/api/vendedores/bancos  (solo los activos)
router.get('/', verificarTokenVendedor, listarBancos);

module.exports = router;
