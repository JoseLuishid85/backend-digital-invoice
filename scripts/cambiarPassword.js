// Cambia la contraseña de un vendedor (escribe el hash bcrypt en la columna password_hash).
// Uso: node scripts/cambiarPassword.js email@dominio.com nuevaContraseña
require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { HOJAS, actualizarFilaDonde } = require('../services/googleSheetsService');

const [email, password] = process.argv.slice(2);

const cambiar = async () => {
    if (!email || !password) {
        console.error('Uso: node scripts/cambiarPassword.js email@dominio.com nuevaContraseña');
        process.exit(1);
    }

    const vendedor = await actualizarFilaDonde(
        HOJAS.vendedores,
        (v) => String(v.email).trim().toLowerCase() === email.toLowerCase(),
        { password_hash: await bcrypt.hash(password, 10) },
    );
    if (!vendedor) {
        console.error(`No existe un vendedor con el email ${email}.`);
        process.exit(1);
    }
    console.log(`Contraseña actualizada para ${vendedor.id_vendedor} (${vendedor.email}).`);
};

cambiar().catch((error) => {
    console.error('Error al cambiar la contraseña:', error.message);
    process.exit(1);
});
