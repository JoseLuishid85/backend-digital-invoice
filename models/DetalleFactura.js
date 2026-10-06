const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DetalleFactura = sequelize.define('DetalleFactura', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    factura_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    cantidad: {
        type: DataTypes.DECIMAL(10, 2), // Permite cantidades fraccionadas (ej. 1.5 kg)
        allowNull: false,
        defaultValue: 1,
    },
    descripcion: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    precio_unitario: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
    },
    importe: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
    },
    precio_unitario_usd: {
        type: DataTypes.DECIMAL(12, 2), // Precio unitario en dólares
        allowNull: true,
    },
}, {
    tableName: 'detalle_facturas',
    timestamps: true,
    underscored: true,
});

module.exports = DetalleFactura;
