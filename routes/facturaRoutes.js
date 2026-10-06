const { Router } = require('express');
const upload = require('../middlewares/upload');
const { procesarFactura, obtenerFactura, obtenerImagenFactura } = require('../controllers/facturaController');

const router = Router();

// POST /bill/api/facturas/procesar  (form-data, campo: imagen)
router.post('/procesar', upload.single('imagen'), procesarFactura);

// GET /bill/api/facturas/:id/imagen  (imagen original de la factura)
router.get('/:id/imagen', obtenerImagenFactura);

// GET /bill/api/facturas/:id  (factura con sus detalles)
router.get('/:id', obtenerFactura);

module.exports = router;
