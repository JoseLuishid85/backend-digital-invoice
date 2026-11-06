const { Router } = require('express');
const { verificarTokenVendedor, verificarAdministrador } = require('../middlewares/authVendedoresMiddleware');
const {
    listarProductos,
    obtenerProducto,
    crearProducto,
    actualizarProducto,
    actualizarPrecios,
    eliminarProducto,
    obtenerConfiguracion,
} = require('../controllers/productosController');

// Catálogo de productos (hoja Productos) y sus precios (hojas Niveles, Plazos y Precios), compartido por todos
// los vendedores
const router = Router();

// GET /bill/api/vendedores/productos?estado=&q=  (cada producto con precios_factura por nivel)
router.get('/', verificarTokenVendedor, listarProductos);

// GET /bill/api/vendedores/productos/configuracion  (niveles, plazos y monedas del motor de precios)
// Va antes de /:id para que "configuracion" no se tome como un ID
router.get('/configuracion', verificarTokenVendedor, obtenerConfiguracion);

// GET /bill/api/vendedores/productos/:id  (con su matriz de precios)
router.get('/:id', verificarTokenVendedor, obtenerProducto);

// POST /bill/api/vendedores/productos  (genera id_producto PROD-001, PROD-002...)
// body JSON: { nombre, descripcion?, stock?, comision? }  (sin precios: ver PUT /:id/precios)
router.post('/', verificarTokenVendedor, crearProducto);

// PUT /bill/api/vendedores/productos/:id
// body JSON: { nombre?, descripcion?, stock?, estado?, comision? }
router.put('/:id', verificarTokenVendedor, actualizarProducto);

// PUT /bill/api/vendedores/productos/:id/precios  (solo el administrador cambia precios)
// body JSON: { precios: [{ id_nivel, id_plazo, moneda, precio_final, ajuste_pct?, ajuste_monto?, ganancia_pct? }] }
// Reemplaza la matriz completa del producto
router.put('/:id/precios', verificarTokenVendedor, verificarAdministrador, actualizarPrecios);

// DELETE /bill/api/vendedores/productos/:id  (borra la fila y sus precios; las ventas guardan nombre y precio)
router.delete('/:id', verificarTokenVendedor, eliminarProducto);

module.exports = router;
