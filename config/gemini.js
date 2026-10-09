const { GoogleGenAI, Type } = require('@google/genai');
require('dotenv').config({ quiet: true });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const GEMINI_MODEL = 'gemini-2.5-flash';

// Esquema estricto que Gemini debe respetar en su respuesta
const facturaSchema = {
    type: Type.OBJECT,
    properties: {
        nombre_empresa: {
            type: Type.STRING,
            description: 'Nombre o razón social de la empresa que emite la factura',
        },
        numero_factura: {
            type: Type.STRING,
            description: 'Número o folio de la factura/ticket',
            nullable: true,
        },
        fecha: {
            type: Type.STRING,
            description: 'Fecha de la factura en formato YYYY-MM-DD',
            nullable: true,
        },
        total: {
            type: Type.NUMBER,
            description: 'Total final a pagar de la factura',
        },
        tasa_dia: {
            type: Type.NUMBER,
            description: 'Tasa de cambio del día en bolívares por dólar (ej. Tasa BCV)',
            nullable: true,
        },
        productos: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    cantidad: { type: Type.NUMBER },
                    descripcion: { type: Type.STRING },
                    precio_unitario: { type: Type.NUMBER },
                    importe: { type: Type.NUMBER },
                    precio_unitario_usd: { type: Type.NUMBER, nullable: true },
                },
                required: ['cantidad', 'descripcion', 'precio_unitario', 'importe', 'precio_unitario_usd'],
                propertyOrdering: ['cantidad', 'descripcion', 'precio_unitario', 'importe', 'precio_unitario_usd'],
            },
        },
    },
    required: ['nombre_empresa', 'numero_factura', 'fecha', 'total', 'tasa_dia', 'productos'],
    propertyOrdering: ['nombre_empresa', 'numero_factura', 'fecha', 'total', 'tasa_dia', 'productos'],
};

const PROMPT = `Eres un asistente experto en extraer datos de facturas y tickets de compra.
Analiza la imagen y extrae:
- nombre_empresa: nombre de la empresa emisora.
- numero_factura: número o folio (null si no aparece).
- fecha: fecha de emisión en formato YYYY-MM-DD (null si no aparece).
- total: total final a pagar como número, sin símbolos de moneda.
- tasa_dia: tasa de cambio del día en bolívares por dólar si aparece en la factura (ej. "Tasa BCV", "Tasa de cambio"); null si no aparece.
- productos: cada línea de producto con cantidad, descripcion, precio_unitario e importe (números sin símbolos, en la moneda principal de la factura), y precio_unitario_usd: precio unitario en dólares solo si la factura lo muestra (ej. columna "REF", "$" o "USD"); null si no aparece.

Reglas para los productos:
- En los tickets fiscales venezolanos (SENIAT) cada producto ocupa una línea con la descripción y el importe a la derecha (ej. "T101-0012/TUER G2 NC 5/8 (G)   Bs 5.636,32"). Cuando la cantidad es mayor que 1, se imprime una línea "cantidad x precio unitario" (ej. "16xBs 352,27") JUSTO ENCIMA de la línea del producto al que pertenece, no debajo.
- Esa línea "NxBs P" nunca es un producto ni una descripción: úsala solo para la cantidad y el precio_unitario del producto de la línea siguiente.
- Si un producto no tiene línea de cantidad encima, su cantidad es 1 y su precio_unitario es igual a su importe.
- Comprueba cada producto: cantidad × precio_unitario debe ser igual al importe. Si no cuadra, revisa a qué producto pertenece la línea de cantidad.
- Incluye todos los productos del ticket. La suma de los importes debe dar el subtotal (antes de impuestos) impreso. No incluyas como productos las líneas de SUBTOTAL, base imponible (BI), IVA, forma de pago ni TOTAL.
- Los números usan punto para miles y coma para decimales (ej. "25.539,35" = 25539.35).

Si la imagen no es una factura o ticket, devuelve nombre_empresa vacío, total 0 y productos vacío.`;

module.exports = { ai, GEMINI_MODEL, facturaSchema, PROMPT };
