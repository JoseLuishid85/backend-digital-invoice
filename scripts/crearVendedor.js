// Crea un usuario en la hoja Usuarios con la contraseña ya cifrada con bcrypt.
// Uso: node scripts/crearVendedor.js "Nombre" email@dominio.com contraseña [telefono] [Vendedor|Administrador] [CodVend]
// CodVend es el código del vendedor en Saint (p. ej. V080460062); necesita la columna cod_vendedor
// (node scripts/prepararSaint.js).
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { HOJAS, leerHoja, agregarFila, siguienteId } = require('../services/googleSheetsService');
const { NIVELES, esAdministrador } = require('../utils/cartera');
const { fechaHoy } = require('../utils/valores');

const [nombre, email, password, telefono = '', nivel = NIVELES.vendedor, codVendedor = ''] = process.argv.slice(2);

const crear = async () => {
    if (!nombre || !email || !password) {
        console.error('Uso: node scripts/crearVendedor.js "Nombre" email@dominio.com contraseña [telefono] [Vendedor|Administrador] [CodVend]');
        process.exit(1);
    }
    if (!Object.values(NIVELES).some((n) => n.toLowerCase() === nivel.toLowerCase())) {
        console.error(`Nivel de acceso inválido: ${nivel}. Usa ${Object.values(NIVELES).join(' o ')}.`);
        process.exit(1);
    }

    const { encabezados, filas } = await leerHoja(HOJAS.usuarios);
    if (filas.some((v) => String(v.email).trim().toLowerCase() === email.toLowerCase())) {
        console.error(`Ya existe un usuario con el email ${email}.`);
        process.exit(1);
    }
    if (codVendedor && !encabezados.includes('cod_vendedor')) {
        console.error('La hoja Usuarios no tiene la columna cod_vendedor. Corre node scripts/prepararSaint.js.');
        process.exit(1);
    }
    if (codVendedor && filas.some((v) => String(v.cod_vendedor ?? '').trim().toUpperCase() === codVendedor.toUpperCase())) {
        console.error(`El código de Saint ${codVendedor} ya está asignado a otro usuario.`);
        process.exit(1);
    }

    const administrador = esAdministrador(nivel);
    const usuario = {
        id_usuario: siguienteId(filas, 'id_usuario', administrador ? 'ADMI' : 'VEND'),
        nombre,
        email: email.toLowerCase(),
        password_hash: await bcrypt.hash(password, 10),
        nivel_acceso: administrador ? NIVELES.administrador : NIVELES.vendedor,
        telefono,
        estado: 'ACTIVO',
        fecha_creacion: fechaHoy(),
        cod_vendedor: codVendedor.toUpperCase(),
    };
    await agregarFila(HOJAS.usuarios, usuario, encabezados);
    console.log(`Usuario ${usuario.id_usuario} (${usuario.nivel_acceso}) creado (${usuario.email}).`);
};

crear().catch((error) => {
    console.error('Error al crear el usuario:', error.message);
    process.exit(1);
});
