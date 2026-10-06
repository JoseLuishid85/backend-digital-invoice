const { DataTypes } = require('sequelize');

// sequelize.sync() no altera tablas existentes, así que agregamos aquí las columnas nuevas si faltan
const COLUMNAS_NUEVAS = [
    { tabla: 'facturas', columna: 'tasa_dia', definicion: { type: DataTypes.DECIMAL(14, 4), allowNull: true } },
    { tabla: 'facturas', columna: 'moneda', definicion: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'VES' } },
    { tabla: 'facturas', columna: 'imagen', definicion: { type: DataTypes.STRING(255), allowNull: true } },
    { tabla: 'detalle_facturas', columna: 'precio_unitario_usd', definicion: { type: DataTypes.DECIMAL(12, 2), allowNull: true } },
];

async function agregarColumnasFaltantes(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    for (const { tabla, columna, definicion } of COLUMNAS_NUEVAS) {
        const descripcion = await queryInterface.describeTable(tabla);
        if (!descripcion[columna]) {
            await queryInterface.addColumn(tabla, columna, definicion);
            console.log(`Columna ${tabla}.${columna} agregada.`);
        }
    }
}

module.exports = { agregarColumnasFaltantes };
