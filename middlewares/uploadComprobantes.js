const multer = require('multer');

// Comprobantes de pago: fotos o PDF, uno por forma de pago (campos comprobante_0, comprobante_1...)
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const MAXIMO_ARCHIVOS = 10;

const errorSubida = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });

const subida = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: MAXIMO_ARCHIVOS }, // 10 MB por archivo
    fileFilter: (req, file, cb) => {
        if (!/^comprobante_\d+$/.test(file.fieldname)) {
            return cb(errorSubida(`Campo de archivo no válido: ${file.fieldname}.`));
        }
        if (!TIPOS_PERMITIDOS.includes(file.mimetype)) {
            return cb(errorSubida('Comprobante no permitido. Usa una foto (JPG, PNG, WEBP o HEIC) o un PDF.'));
        }
        return cb(null, true);
    },
});

// Acepta multipart (campo "datos" con JSON + archivos) o un body JSON sin archivos
const subirComprobantes = subida.any();

module.exports = { subirComprobantes };
