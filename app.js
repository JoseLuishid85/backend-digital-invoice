require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { sequelize } = require('./models');
const { agregarColumnasFaltantes } = require('./config/columnas');
const facturaRoutes = require('./routes/facturaRoutes');
const productoRoutes = require('./routes/productoRoutes');
const tasaRoutes = require('./routes/tasaRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globales
app.use(cors());
app.use(express.json()); 

// Rutas
app.use('/digital/api/facturas', facturaRoutes);
app.use('/digital/api/productos', productoRoutes);
app.use('/digital/api/tasas', tasaRoutes);

// Ruta no encontrada
app.use((req, res) => {
    res.status(404).json({ ok: false, mensaje: 'Ruta no encontrada.' });
});

// Manejo centralizado de errores (incluye errores de Multer)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const mensaje = err.code === 'LIMIT_FILE_SIZE'
            ? 'La imagen supera el tamaño máximo de 10 MB.'
            : `Error al subir el archivo: ${err.message}`;
        return res.status(400).json({ ok: false, mensaje });
    }
    console.error(err);
    res.status(err.status || 500).json({ ok: false, mensaje: err.message || 'Error interno del servidor.' });
});

// Conectar a la BD, sincronizar modelos y levantar el servidor
async function iniciar() {
    try {
        await sequelize.authenticate();
        console.log('Conexión a la base de datos exitosa.');

        await sequelize.sync(); // Crea las tablas si no existen
        await agregarColumnasFaltantes(sequelize); // Columnas nuevas en tablas ya existentes
        console.log('Modelos sincronizados.');

        app.listen(PORT, () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Error al iniciar el servidor:', error);
        process.exit(1);
    }
}

iniciar();
