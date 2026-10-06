const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Registro histórico del precio del dólar: un solo registro por día
const TasaDia = sequelize.define('TasaDia', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    fecha: {
        type: DataTypes.DATEONLY, // Formato YYYY-MM-DD
        allowNull: false,
        unique: true,
    },
    tasa: {
        type: DataTypes.DECIMAL(14, 4), // Bs por dólar
        allowNull: false,
    },
}, {
    tableName: 'tasas_dia',
    timestamps: true,
    underscored: true,
});

module.exports = TasaDia;
