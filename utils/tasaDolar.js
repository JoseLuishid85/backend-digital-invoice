const { HOJAS, leerHoja, agregarFila, actualizarFila, conBloqueo } = require('../services/googleSheetsService');
const { consultarTasaBcvConFecha } = require('./tasaBcv');
const { aMonto, redondear, aTexto, fechaHoraActual } = require('./cartera');
const { fechaHoy } = require('./valores');

// Tasas del dólar de la cartera (hoja Tasas_Dolar: fecha, tasa, fuente, actualizado_en).
// fuente: bcv (consultada en DolarApi) o manual (escrita por un vendedor).

// Bs por dólar con hasta 4 decimales, como la publica el BCV
const redondearTasa = (n) => Math.round(n * 10000) / 10000;

const formatearTasa = ({ _fila, ...fila }) => ({ ...fila, fecha: aTexto(fila.fecha), tasa: aMonto(fila.tasa) });

// Tasa del día YYYY-MM-DD: la guardada en la hoja y, si no hay, la del BCV, que se guarda para no
// volver a consultarla. Devuelve { fecha, tasa, fuente } o null si no hay tasa.
// No llamar dentro de conBloqueo: guarda la tasa con su propio bloqueo.
const tasaDelDia = async (fecha) => {
    const guardada = (await leerHoja(HOJAS.tasas)).filas.find((t) => aTexto(t.fecha) === fecha && aMonto(t.tasa) > 0);
    if (guardada) return formatearTasa(guardada);

    const bcv = await consultarTasaBcvConFecha(fecha);
    if (!bcv) return null;

    const tasa = { fecha, tasa: redondearTasa(bcv.tasa), fuente: 'bcv' };
    // Si hoy todavía no se publicó, la del día anterior sirve para mostrar pero no se guarda:
    // más tarde aparecerá la de hoy. Las fechas pasadas ya no cambian.
    if (fecha < fechaHoy() || bcv.fecha === fecha) {
        await guardarTasa(fecha, tasa.tasa, 'bcv', { reemplazar: false })
            .catch((error) => console.error(`No se pudo guardar la tasa del ${fecha}:`, error.message));
    }
    return tasa;
};

// Crea o reemplaza la tasa de un día. Con reemplazar: false no toca un día que ya tenga tasa.
const guardarTasa = (fecha, tasa, fuente, { reemplazar = true } = {}) => conBloqueo(async () => {
    const { encabezados, filas } = await leerHoja(HOJAS.tasas);
    const existente = filas.find((t) => aTexto(t.fecha) === fecha);
    const datos = { tasa: redondearTasa(tasa), fuente, actualizado_en: fechaHoraActual() };

    if (existente) {
        if (!reemplazar) return formatearTasa(existente);
        await actualizarFila(HOJAS.tasas, existente._fila, datos, encabezados);
        return formatearTasa({ ...existente, ...datos });
    }
    return formatearTasa(await agregarFila(HOJAS.tasas, { fecha, ...datos }, encabezados));
});

// Monto en dólares a bolívares con la tasa (null sin tasa)
const aBolivares = (monto, tasa) => (tasa > 0 ? redondear(monto * tasa) : null);

module.exports = { tasaDelDia, guardarTasa, aBolivares, redondearTasa };
