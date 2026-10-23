const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const {
    listarProductos,
    obtenerProducto,
    crearProducto,
    actualizarProducto,
    eliminarProducto,
} = require('../controllers/productosController');

// Catálogo de productos (hoja Productos), compartido por todos los vendedores
const router = Router();

// GET /bill/api/vendedores/productos?estado=&q=
router.get('/', verificarTokenVendedor, listarProductos);

// GET /bill/api/vendedores/productos/:id
router.get('/:id', verificarTokenVendedor, obtenerProducto);

// POST /bill/api/vendedores/productos  (genera id_producto PROD-001, PROD-002...)
// body JSON: { nombre, precio, precio_7?, precio_15?, precio_30?, descripcion?, stock? }  (precio = contado)
router.post('/', verificarTokenVendedor, crearProducto);

// PUT /bill/api/vendedores/productos/:id
// body JSON: { nombre?, descripcion?, precio?, precio_7?, precio_15?, precio_30?, stock?, estado? }
router.put('/:id', verificarTokenVendedor, actualizarProducto);

// DELETE /bill/api/vendedores/productos/:id  (borra la fila; las ventas guardan el nombre, no el ID)
router.delete('/:id', verificarTokenVendedor, eliminarProducto);

module.exports = router;
