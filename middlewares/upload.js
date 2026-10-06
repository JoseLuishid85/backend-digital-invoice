const multer = require('multer');

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// Guardamos el archivo en memoria (req.file.buffer) para enviarlo directo a Gemini
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        if (TIPOS_PERMITIDOS.includes(file.mimetype)) {
            cb(null, true);
        } else {
            const error = new Error('Formato no permitido. Usa JPG, PNG, WEBP o HEIC.');
            error.status = 400;
            cb(error);
        }
    },
});

module.exports = upload;
