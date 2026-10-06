const sequelize = require('../config/database');
const Factura = require('./Factura');
const DetalleFactura = require('./DetalleFactura');
const TasaDia = require('./TasaDia');

// Relación 1 a Muchos: una factura tiene muchos detalles
Factura.hasMany(DetalleFactura, {
    foreignKey: 'factura_id',
    as: 'detalles',
    onDelete: 'CASCADE',
});
DetalleFactura.belongsTo(Factura, {
    foreignKey: 'factura_id',
    as: 'factura',
});

module.exports = { sequelize, Factura, DetalleFactura, TasaDia };
