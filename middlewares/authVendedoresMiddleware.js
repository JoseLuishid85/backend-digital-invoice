const jwt = require('jsonwebtoken');

// Exige "Authorization: Bearer <token>" y deja los datos del vendedor en req.vendedor
const verificarTokenVendedor = (req, res, next) => {
    const [tipo, token] = (req.headers.authorization || '').split(' ');
    if (tipo !== 'Bearer' || !token) {
        return res.status(401).json({ ok: false, mensaje: 'Falta el token de acceso.' });
    }

    try {
        const { id_vendedor, nombre, email } = jwt.verify(token, process.env.JWT_SECRET);
        req.vendedor = { id_vendedor, nombre, email };
        return next();
    } catch (error) {
        const mensaje = error.name === 'TokenExpiredError'
            ? 'La sesión expiró. Inicia sesión de nuevo.'
            : 'Token inválido.';
        return res.status(401).json({ ok: false, mensaje });
    }
};

module.exports = { verificarTokenVendedor };
