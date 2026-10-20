// Crea un vendedor en la hoja Vendedores con la contraseña ya cifrada con bcrypt.
// Uso: node scripts/crearVendedor.js "Nombre" email@dominio.com contraseña [telefono]
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { HOJAS, leerHoja, agregarFila, siguienteId } = require('../services/googleSheetsService');
const { fechaHoy } = require('../utils/valores');

const [nombre, email, password, telefono = ''] = process.argv.slice(2);

const crear = async () => {
    if (!nombre || !email || !password) {
        console.error('Uso: node scripts/crearVendedor.js "Nombre" email@dominio.com contraseña [telefono]');
        process.exit(1);
    }

    const { encabezados, filas } = await leerHoja(HOJAS.vendedores);
    if (filas.some((v) => String(v.email).trim().toLowerCase() === email.toLowerCase())) {
        console.error(`Ya existe un vendedor con el email ${email}.`);
        process.exit(1);
    }

    const vendedor = {
        id_vendedor: siguienteId(filas, 'id_vendedor', 'VEND'),
        nombre,
        email: email.toLowerCase(),
        password_hash: await bcrypt.hash(password, 10),
        telefono,
        estado: 'activo',
        fecha_creacion: fechaHoy(),
    };
    await agregarFila(HOJAS.vendedores, vendedor, encabezados);
    console.log(`Vendedor ${vendedor.id_vendedor} creado (${vendedor.email}).`);
};

crear().catch((error) => {
    console.error('Error al crear el vendedor:', error.message);
    process.exit(1);
});
