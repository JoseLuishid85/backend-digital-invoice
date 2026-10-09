const { Router } = require('express');
const upload = require('../middlewares/upload');
const { procesarFactura, guardarFactura, obtenerFactura, obtenerImagenFactura } = require('../controllers/facturaController');

const router = Router();

// POST /bill/api/facturas/procesar  (form-data, campo: imagen) → solo extrae los datos, no guarda
router.post('/procesar', upload.single('imagen'), procesarFactura);

// POST /bill/api/facturas  (form-data, campos: imagen + datos en JSON) → guarda la factura revisada
router.post('/', upload.single('imagen'), guardarFactura);

// GET /bill/api/facturas/:id/imagen  (imagen original de la factura)
router.get('/:id/imagen', obtenerImagenFactura);

// GET /bill/api/facturas/:id  (factura con sus detalles)
router.get('/:id', obtenerFactura);

module.exports = router;
