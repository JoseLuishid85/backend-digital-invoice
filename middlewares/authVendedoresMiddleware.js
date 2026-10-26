const jwt = require('jsonwebtoken');
const { HOJAS, leerHoja } = require('../services/googleSheetsService');
const { NIVELES, mismoId, esAdministrador, usuarioActivo, responderError } = require('../utils/cartera');

// Exige "Authorization: Bearer <token>" y deja los datos del usuario en req.vendedor.
// id_vendedor es el id_usuario: es lo que guardan Clientes, Ventas e Historial_Logs en su columna id_vendedor.
const verificarTokenVendedor = (req, res, next) => {
    const [tipo, token] = (req.headers.authorization || '').split(' ');
    if (tipo !== 'Bearer' || !token) {
        return res.status(401).json({ ok: false, mensaje: 'Falta el token de acceso.' });
    }

    try {
        const datos = jwt.verify(token, process.env.JWT_SECRET);
        // Los tokens anteriores a la hoja Usuarios traen id_vendedor y no tienen nivel
        const idUsuario = datos.id_usuario ?? datos.id_vendedor;
        req.vendedor = {
            id_vendedor: idUsuario,
            id_usuario: idUsuario,
            nombre: datos.nombre,
            email: datos.email,
            nivel_acceso: datos.nivel_acceso || NIVELES.vendedor,
        };
        return next();
    } catch (error) {
        const mensaje = error.name === 'TokenExpiredError'
            ? 'La sesión expiró. Inicia sesión de nuevo.'
            : 'Token inválido.';
        return res.status(401).json({ ok: false, mensaje });
    }
};

// Va después de verificarTokenVendedor. Confirma en la hoja Usuarios que sigue siendo administrador y activo:
// el token dura días y el nivel pudo cambiar después de iniciar sesión.
const verificarAdministrador = async (req, res, next) => {
    if (!esAdministrador(req.vendedor?.nivel_acceso)) {
        return res.status(403).json({ ok: false, mensaje: 'Solo un administrador puede ver esta sección.' });
    }

    try {
        const { filas } = await leerHoja(HOJAS.usuarios);
        const usuario = filas.find((u) => mismoId(u.id_usuario, req.vendedor.id_usuario));
        if (!usuario || !usuarioActivo(usuario) || !esAdministrador(usuario.nivel_acceso)) {
            return res.status(403).json({ ok: false, mensaje: 'Solo un administrador puede ver esta sección.' });
        }
        return next();
    } catch (error) {
        return responderError(res, error, 'Error al verificar el nivel de acceso');
    }
};

module.exports = { verificarTokenVendedor, verificarAdministrador };
