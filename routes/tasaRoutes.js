const { Router } = require('express');
const { listarTasas, guardarTasa } = require('../controllers/tasaController');

const router = Router();

// GET /bill/api/tasas  (últimas tasas registradas)
router.get('/', listarTasas);

// PUT /bill/api/tasas/:fecha  (body JSON: { tasa })
router.put('/:fecha', guardarTasa);

module.exports = router;
