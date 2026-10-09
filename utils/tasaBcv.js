// Consulta la tasa oficial (BCV) en DolarApi: https://ve.dolarapi.com
const URL_HISTORICO = 'https://ve.dolarapi.com/v1/historicos/dolares/oficial';

// Fines de semana y feriados no tienen tasa publicada (la API responde 404),
// así que retrocedemos hasta encontrar el último día hábil
const DIAS_HACIA_ATRAS = 7;
const TIEMPO_MAXIMO_MS = 5000;

const restarDia = (fecha) => {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const d = new Date(Date.UTC(anio, mes - 1, dia - 1));
    return d.toISOString().slice(0, 10);
};

// Devuelve la tasa (Bs por dólar) vigente en la fecha YYYY-MM-DD, o null si no se pudo obtener
const consultarTasaBcv = async (fecha) => {
    let dia = fecha;
    for (let intento = 0; intento <= DIAS_HACIA_ATRAS; intento++) {
        try {
            const respuesta = await fetch(`${URL_HISTORICO}/${dia.replaceAll('-', '/')}`, {
                signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
            });
            if (respuesta.ok) {
                const datos = await respuesta.json();
                const tasa = Number(datos?.promedio);
                if (Number.isFinite(tasa) && tasa > 0) return tasa;
            } else if (respuesta.status !== 404) {
                console.error(`DolarApi respondió ${respuesta.status} para ${dia}.`);
                return null;
            }
        } catch (error) {
            console.error('Error al consultar la tasa en DolarApi:', error.message);
            return null;
        }
        dia = restarDia(dia);
    }
    return null;
};

// Tasa para una fecha cuando el usuario no la escribe: la registrada ese día y, si no hay, la del BCV
const buscarTasaDelDia = async (fecha) => {
    // Se importa aquí para no crear dependencia circular con los modelos al cargar el módulo
    const { TasaDia } = require('../models');
    const registro = await TasaDia.findOne({ where: { fecha } });
    if (registro) return { tasa: Number(registro.tasa), origen: 'registro' };

    const tasaBcv = await consultarTasaBcv(fecha);
    if (tasaBcv) return { tasa: tasaBcv, origen: 'bcv' };

    return { tasa: null, origen: null };
};

module.exports = { consultarTasaBcv, buscarTasaDelDia };
