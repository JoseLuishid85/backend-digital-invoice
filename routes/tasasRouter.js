const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { obtenerTasa, guardarTasaManual } = require('../controllers/tasasController');

// Tasa del dólar (Bs por dólar) por día (hoja Tasas_Dolar), compartida por todos los vendedores
const router = Router();

// GET /bill/api/vendedores/tasas/:fecha  (YYYY-MM-DD o "hoy"; si el día no tiene tasa, la busca en el BCV y la guarda)
router.get('/:fecha', verificarTokenVendedor, obtenerTasa);

// PUT /bill/api/vendedores/tasas/:fecha  (body JSON: { tasa })
router.put('/:fecha', verificarTokenVendedor, guardarTasaManual);

module.exports = router;
