const { Sequelize } = require('sequelize');
require('dotenv').config({ quiet: true });

// Instancia única de Sequelize compartida por todos los modelos
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false, // Evita que muestre logs en consola
});

module.exports = sequelize;
