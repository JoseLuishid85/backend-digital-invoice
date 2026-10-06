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
Si la imagen no es una factura o ticket, devuelve nombre_empresa vacío, total 0 y productos vacío.`;

module.exports = { ai, GEMINI_MODEL, facturaSchema, PROMPT };
