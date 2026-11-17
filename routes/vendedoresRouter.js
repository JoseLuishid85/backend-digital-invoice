const { Router } = require('express');
const { verificarTokenVendedor } = require('../middlewares/authVendedoresMiddleware');
const { login, perfil, registrarVendedor, cambiarPassword } = require('../controllers/authVendedoresController');

// Cuenta y sesión de vendedores (datos en Google Sheets, no en MySQL)
const router = Router();

// POST /bill/api/vendedores/login  (body JSON: { email, password }; devuelve el JWT)
router.post('/login', login);

// POST /bill/api/vendedores  (público: "Crear cuenta"; body JSON: { nombre, email, password, telefono? }; devuelve el JWT)
router.post('/', registrarVendedor);

// GET /bill/api/vendedores/perfil  (datos del vendedor del token)
router.get('/perfil', verificarTokenVendedor, perfil);

// PUT /bill/api/vendedores/password  (body JSON: { actual, nueva }; cambia la contraseña del usuario del token)
router.put('/password', verificarTokenVendedor, cambiarPassword);

module.exports = router;
