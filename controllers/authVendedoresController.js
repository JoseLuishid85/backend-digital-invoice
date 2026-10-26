const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { HOJAS, leerHoja, appendRow, siguienteId, conBloqueo } = require('../services/googleSheetsService');
const { registrarLog } = require('../services/historialService');
const { aTexto, NIVELES, usuarioActivo, responderError } = require('../utils/cartera');
const { fechaHoy } = require('../utils/valores');

const DURACION_TOKEN = process.env.JWT_EXPIRES_IN || '7d';
const SALT_ROUNDS = 10;
const LARGO_MINIMO_PASSWORD = 6;
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hash de relleno: si el email no existe se compara igual, para no revelar por el tiempo de respuesta qué emails existen
const HASH_FICTICIO = bcrypt.hashSync('relleno-sin-uso', 10);

// Datos públicos del usuario (sin password_hash ni número de fila). Sin nivel_acceso es vendedor.
const vendedorPublico = ({ _fila, password_hash, ...usuario }) => ({
    ...usuario,
    nivel_acceso: aTexto(usuario.nivel_acceso) || NIVELES.vendedor,
});

// JWT de sesión con los datos básicos del usuario y su nivel de acceso
const firmarToken = (usuario) => jwt.sign(
    {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
        nivel_acceso: aTexto(usuario.nivel_acceso) || NIVELES.vendedor,
    },
    process.env.JWT_SECRET,
    { expiresIn: DURACION_TOKEN },
);

const sinJwtSecret = (res) => {
    console.error('Falta JWT_SECRET en .env');
    return res.status(500).json({ ok: false, mensaje: 'El inicio de sesión no está configurado.' });
};

// POST /bill/api/vendedores/login  (body JSON: { email, password })
const login = async (req, res) => {
    const email = aTexto(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.status(400).json({ ok: false, mensaje: 'Email y contraseña son obligatorios.' });
    }
    if (!process.env.JWT_SECRET) return sinJwtSecret(res);

    try {
        const { filas } = await leerHoja(HOJAS.usuarios);
        const vendedor = filas.find((v) => aTexto(v.email).toLowerCase() === email);

        const valida = await bcrypt.compare(password, aTexto(vendedor?.password_hash) || HASH_FICTICIO);
        if (!vendedor || !valida) {
            return res.status(401).json({ ok: false, mensaje: 'Email o contraseña incorrectos.' });
        }
        if (!usuarioActivo(vendedor)) {
            return res.status(403).json({ ok: false, mensaje: 'El usuario está inactivo.' });
        }

        const token = firmarToken(vendedor);

        registrarLog(vendedor.id_usuario, 'login', { email: vendedor.email });

        return res.json({ ok: true, token, expira_en: DURACION_TOKEN, vendedor: vendedorPublico(vendedor) });
    } catch (error) {
        console.error('Error en el login:', error);
        return res.status(error.status || 500).json({
            ok: false,
            mensaje: error.status ? error.message : 'Error al iniciar sesión.',
        });
    }
};

// GET /bill/api/vendedores/perfil  (datos del usuario del token)
const perfil = (req, res) => res.json({ ok: true, vendedor: req.vendedor });

// POST /bill/api/vendedores  (público; body JSON: { nombre, email, password, telefono? })
// Guarda el vendedor en la hoja Usuarios (nivel Vendedor; los administradores se crean con el script)
// con la contraseña cifrada con bcrypt y devuelve su token para que entre directamente, igual que el login.
const registrarVendedor = async (req, res) => {
    const nombre = aTexto(req.body?.nombre);
    const email = aTexto(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!nombre || !email || !password) {
        return res.status(400).json({ ok: false, mensaje: 'Nombre, email y contraseña son obligatorios.' });
    }
    if (!FORMATO_EMAIL.test(email)) {
        return res.status(400).json({ ok: false, mensaje: 'El email no es válido.' });
    }
    if (password.length < LARGO_MINIMO_PASSWORD) {
        return res.status(400).json({
            ok: false,
            mensaje: `La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`,
        });
    }
    if (!process.env.JWT_SECRET) return sinJwtSecret(res);

    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // En cola para que dos registros simultáneos no generen el mismo ID ni dupliquen el email
        const vendedor = await conBloqueo(async () => {
            const { filas } = await leerHoja(HOJAS.usuarios);
            if (filas.some((v) => aTexto(v.email).toLowerCase() === email)) return null;

            return appendRow(HOJAS.usuarios, {
                id_usuario: siguienteId(filas, 'id_usuario', 'VEND'),
                nombre,
                email,
                password_hash: passwordHash,
                nivel_acceso: NIVELES.vendedor,
                telefono: aTexto(req.body?.telefono),
                estado: 'ACTIVO',
                fecha_creacion: fechaHoy(),
            });
        });

        if (!vendedor) {
            return res.status(409).json({ ok: false, mensaje: 'Ya existe un usuario con ese email.' });
        }

        registrarLog(vendedor.id_usuario, 'registrar_vendedor', { email });
        return res.status(201).json({
            ok: true,
            mensaje: 'Vendedor registrado exitosamente',
            token: firmarToken(vendedor),
            expira_en: DURACION_TOKEN,
            vendedor: vendedorPublico(vendedor),
        });
    } catch (error) {
        return responderError(res, error, 'Error al registrar el vendedor');
    }
};

module.exports = { login, perfil, registrarVendedor };
