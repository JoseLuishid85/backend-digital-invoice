const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Factura = sequelize.define('Factura', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    nombre_empresa: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    numero_factura: {
        type: DataTypes.STRING(100),
        allowNull: true, // Algunos tickets no traen número
    },
    fecha: {
        type: DataTypes.DATEONLY, // Formato YYYY-MM-DD
        allowNull: true,
    },
    total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
    },
    moneda: {
        type: DataTypes.STRING(3), // Moneda de los precios de la factura: VES (Bs) o USD ($)
        allowNull: false,
        defaultValue: 'VES',
    },
    tasa_dia: {
        type: DataTypes.DECIMAL(14, 4), // Tasa del día en Bs por dólar
        allowNull: true,
    },
    imagen: {
        type: DataTypes.STRING(255), // Nombre del archivo guardado en uploads/facturas
        allowNull: true,
    },
}, {
    tableName: 'facturas',
    timestamps: true,
    underscored: true, // created_at / updated_at
});

module.exports = Factura;
