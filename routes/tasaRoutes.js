const { Router } = require('express');
const { listarTasas, guardarTasa, obtenerTasaSugerida } = require('../controllers/tasaController');

const router = Router();

// GET /bill/api/tasas  (últimas tasas registradas)
router.get('/', listarTasas);

// GET /bill/api/tasas/:fecha/sugerida  (registrada ese día o la del BCV; no guarda)
router.get('/:fecha/sugerida', obtenerTasaSugerida);

// PUT /bill/api/tasas/:fecha  (body JSON: { tasa })
router.put('/:fecha', guardarTasa);

module.exports = router;
