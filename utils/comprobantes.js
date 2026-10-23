const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

// Comprobantes de pago en backend/uploads/comprobantes/<uuid>.<ext>; la hoja Pagos guarda solo el nombre
const CARPETA_COMPROBANTES = path.join(__dirname, '..', 'uploads', 'comprobantes');

const EXTENSIONES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'application/pdf': '.pdf',
};

// Archivos subidos por línea de pago según el campo comprobante_<n>: { 0: archivo, 2: archivo }
const comprobantesPorLinea = (archivos = []) => Object.fromEntries(
    archivos.map((archivo) => [Number(archivo.fieldname.replace('comprobante_', '')), archivo]),
);

// Borra comprobantes huérfanos (cuando el pago no llegó a guardarse)
const borrarComprobantes = (nombres) => Promise.all(nombres.filter(Boolean).map((nombre) =>
    fs.unlink(path.join(CARPETA_COMPROBANTES, path.basename(nombre)))
        .catch((e) => console.error(`No se pudo borrar el comprobante ${nombre}:`, e.message))));

// Guarda los archivos y devuelve { [linea]: nombre }. Si uno falla, borra los ya escritos.
const guardarComprobantes = async (porLinea) => {
    await fs.mkdir(CARPETA_COMPROBANTES, { recursive: true });
    const nombres = {};
    try {
        for (const [linea, archivo] of Object.entries(porLinea)) {
            const nombre = `${crypto.randomUUID()}${EXTENSIONES[archivo.mimetype] || ''}`;
            await fs.writeFile(path.join(CARPETA_COMPROBANTES, nombre), archivo.buffer);
            nombres[linea] = nombre;
        }
    } catch (error) {
        await borrarComprobantes(Object.values(nombres));
        throw error;
    }
    return nombres;
};

const rutaComprobante = (nombre) => path.join(CARPETA_COMPROBANTES, path.basename(nombre));

module.exports = { comprobantesPorLinea, guardarComprobantes, borrarComprobantes, rutaComprobante };
