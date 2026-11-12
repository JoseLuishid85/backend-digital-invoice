// Prepara el enlace con Saint. Se puede correr varias veces: solo agrega lo que falta y nunca escribe en Saint.
// - Usuarios: columna cod_vendedor (CodVend de Saint, p. ej. V080460062). El login, el correo y la contraseña
//   siguen en Usuarios; el código solo dice quién es ese usuario en Saint.
// - Productos: columna codigo (Código de Saint, p. ej. PT100HTP). Con él, el stock sale del inventario de Saint.
// Después muestra los vendedores y el inventario de Saint y qué usuario o producto tiene enlazado cada código.
// Uso: node scripts/prepararSaint.js
require('dotenv').config({ quiet: true });
const { HOJAS, agregarColumnas, leerHojas, leerHojasDe } = require('../services/googleSheetsService');
const { leerInventarioSaint } = require('../utils/inventarioSaint');

const COLUMNAS_NUEVAS = {
    [HOJAS.usuarios]: ['cod_vendedor'],
    [HOJAS.productos]: ['codigo'],
};

const texto = (v) => String(v ?? '').trim();
const igual = (a, b) => texto(a).toUpperCase() === texto(b).toUpperCase();

const preparar = async () => {
    for (const [hoja, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
        const agregadas = await agregarColumnas(hoja, columnas);
        console.log(agregadas.length
            ? `Pestaña "${hoja}": columnas agregadas ${agregadas.join(', ')}.`
            : `Pestaña "${hoja}": ya tenía las columnas.`);
    }

    if (!process.env.SAINT_SHEETS_ID) {
        console.log('\nFalta SAINT_SHEETS_ID en backend/.env: sin él el stock sigue saliendo de Productos.');
        return;
    }

    const hojas = await leerHojas(HOJAS.usuarios, HOJAS.productos);
    const usuarios = hojas[HOJAS.usuarios].filas;
    const productos = hojas[HOJAS.productos].filas;

    const hojaVendedores = process.env.SAINT_HOJA_VENDEDORES || 'Vendedor';
    try {
        const vendedores = (await leerHojasDe(process.env.SAINT_SHEETS_ID, [hojaVendedores]))[hojaVendedores].filas;
        console.log(`\nVendedores de Saint (pestaña "${hojaVendedores}") → usuario de la app:`);
        for (const v of vendedores) {
            const usuario = usuarios.find((u) => igual(u.cod_vendedor, v.CodVend));
            console.log(`  ${texto(v.CodVend).padEnd(12)} ${texto(v.Descrip).padEnd(40)} ${usuario ? `${usuario.id_usuario} ${usuario.email}` : '-'}`);
        }
    } catch (error) {
        console.log(`\nNo se pudo leer la pestaña "${hojaVendedores}" de Saint: ${error.message}`);
    }

    const inventario = await leerInventarioSaint({ forzar: true });
    console.log('\nInventario de Saint → producto de la app:');
    for (const registro of inventario.values()) {
        const producto = productos.find((p) => igual(p.codigo, registro.codigo));
        console.log(`  ${registro.codigo.padEnd(12)} ${registro.producto.padEnd(45)} ${String(registro.existencia).padStart(8)}  ${producto ? `${producto.id_producto} ${producto.nombre}` : '-'}`);
    }
    const sinEnlace = productos.filter((p) => !texto(p.codigo));
    if (sinEnlace.length) {
        console.log(`\nProductos sin código de Saint (usan la columna stock): ${sinEnlace.map((p) => p.id_producto).join(', ')}`);
    }
    console.log('\nEscribe el CodVend en Usuarios.cod_vendedor y el Código en Productos.codigo (o desde Productos en la app).');
};

preparar().catch((error) => {
    console.error('Error al preparar el enlace con Saint:', error.message);
    process.exit(1);
});
