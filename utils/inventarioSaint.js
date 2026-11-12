const { HOJAS, leerHojasDe } = require('../services/googleSheetsService');
const { aTexto } = require('./cartera');

// Inventario real de Saint. Saint factura y descuenta su propio inventario; la app solo lo lee de una pestaña de
// otro documento de Google Sheets (SAINT_SHEETS_ID, pestaña SAINT_HOJA_INVENTARIO, por defecto "inventario") con
// las columnas Código, Producto, Familia, Existencia y Kilos. Cada producto de la app se enlaza por su columna
// `codigo` (p. ej. PT100HTP). Filas sin código (como la de "Total") se ignoran.

const CACHE_MS = 60 * 1000; // el inventario de Saint no cambia a cada segundo: se relee como mucho una vez por minuto
let cache = null; // { leido, porCodigo }

const configurado = () => Boolean(process.env.SAINT_SHEETS_ID);
const hojaInventario = () => process.env.SAINT_HOJA_INVENTARIO || 'inventario';

// Encabezado sin tildes ni mayúsculas: "Código" → "codigo"
const normalizar = (texto) => aTexto(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const claveCodigo = (codigo) => aTexto(codigo).toUpperCase();

// Número que puede venir como número o como texto con separadores ("1,261.00" o "1.261,00")
const aExistencia = (valor) => {
    if (typeof valor === 'number') return valor;
    let texto = aTexto(valor).replace(/\s/g, '');
    if (!texto) return 0;
    const coma = texto.lastIndexOf(',');
    const punto = texto.lastIndexOf('.');
    texto = coma > punto ? texto.replace(/\./g, '').replace(',', '.') : texto.replace(/,/g, '');
    const n = Number(texto);
    return Number.isFinite(n) ? n : 0;
};

// Lee la pestaña de Saint y devuelve Map(codigo → { codigo, producto, familia, existencia, kilos })
const leerInventarioSaint = async ({ forzar = false } = {}) => {
    if (!configurado()) return null;
    if (!forzar && cache && Date.now() - cache.leido < CACHE_MS) return cache.porCodigo;

    const hoja = hojaInventario();
    let filas;
    try {
        filas = (await leerHojasDe(process.env.SAINT_SHEETS_ID, [hoja]))[hoja].filas;
    } catch (error) {
        const detalle = /permission|caller does not have/i.test(error.message)
            ? 'comparte el documento de Saint con la cuenta de servicio como Lector'
            : error.message;
        throw Object.assign(new Error(`No se pudo leer el inventario de Saint (${detalle}).`), { status: 502 });
    }

    const porCodigo = new Map();
    for (const fila of filas) {
        const campo = (nombre) => fila[Object.keys(fila).find((k) => normalizar(k) === nombre)];
        const codigo = aTexto(campo('codigo'));
        if (!codigo) continue;
        porCodigo.set(claveCodigo(codigo), {
            codigo,
            producto: aTexto(campo('producto')),
            familia: aTexto(campo('familia')),
            existencia: aExistencia(campo('existencia')),
            kilos: aExistencia(campo('kilos')),
        });
    }
    cache = { leido: Date.now(), porCodigo };
    return porCodigo;
};

// Reemplaza el stock de los productos con codigo por la existencia de Saint. Cada fila queda con stock_origen:
// 'saint' (encontrado), 'saint_sin_registro' (tiene codigo pero no está en el inventario: stock 0) o 'app' (sin
// codigo, o Saint sin configurar: se usa la columna stock de Productos). Si Saint no responde, se avisa en consola
// y se usa el stock de la app para no dejar sin catálogo a los vendedores.
const aplicarInventarioSaint = async (filas) => {
    let inventario = null;
    try {
        inventario = await leerInventarioSaint();
    } catch (error) {
        console.error(error.message);
    }
    return filas.map((producto) => {
        const codigo = claveCodigo(producto.codigo);
        if (!inventario || !codigo) return { ...producto, stock_origen: 'app' };
        const registro = inventario.get(codigo);
        return registro
            ? { ...producto, stock: registro.existencia, stock_origen: 'saint' }
            : { ...producto, stock: 0, stock_origen: 'saint_sin_registro' };
    });
};

// Lo mismo sobre el resultado de leerHojas: cambia en el lugar las filas de Productos
const conInventarioSaint = async (hojas) => {
    if (hojas[HOJAS.productos]) {
        hojas[HOJAS.productos].filas = await aplicarInventarioSaint(hojas[HOJAS.productos].filas);
    }
    return hojas;
};

// Emitir factura descuenta el stock de la columna Productos.stock solo si DESCONTAR_INVENTARIO=si. Los productos
// enlazados a Saint nunca se descuentan aquí: el descuento real lo hace Saint al facturar.
const descontarInventario = () => ['si', 'sí', 'true', '1'].includes(aTexto(process.env.DESCONTAR_INVENTARIO).toLowerCase());

module.exports = { configurado, leerInventarioSaint, aplicarInventarioSaint, conInventarioSaint, descontarInventario };
