// Convierte valores de la IA a número seguro (evita NaN en columnas DECIMAL)
const aNumero = (valor) => {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
};

// Para campos opcionales: número positivo o null
const aNumeroOpcional = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(String(valor).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
};

// Acepta solo fechas YYYY-MM-DD válidas; si no, null
const aFecha = (valor) => {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
    return Number.isNaN(Date.parse(valor)) ? null : valor;
};

// Fecha local de hoy en formato YYYY-MM-DD
const fechaHoy = () => {
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');
    return `${hoy.getFullYear()}-${mes}-${dia}`;
};

module.exports = { aNumero, aNumeroOpcional, aFecha, fechaHoy };
