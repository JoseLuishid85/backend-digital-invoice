const { aMonto, aMontoOpcional, redondear, mismoId, aTexto } = require('./cartera');
const { tasaDelDia, redondearTasa } = require('./tasaDolar');
const { aNumeroOpcional } = require('./valores');

// Formas de pago. moneda: en qué se recibe el monto (USD = dólares, VES = bolívares). conBanco: hay que
// indicar el banco (de la hoja Bancos). En la hoja Pagos se escribe la etiqueta. Duplicadas en frontend-vendedor/src/utils/pagos.js.
const METODOS_PAGO = [
    { valor: 'EFECTIVO_USD', etiqueta: 'Efectivo $', moneda: 'USD' },
    { valor: 'ZELLE', etiqueta: 'Zelle', moneda: 'USD' },
    { valor: 'EFECTIVO_BS', etiqueta: 'Efectivo Bs', moneda: 'VES' },
    { valor: 'PAGO_MOVIL', etiqueta: 'Pago móvil', moneda: 'VES', conBanco: true },
    { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia', moneda: 'VES', conBanco: true },
    { valor: 'PUNTO', etiqueta: 'Punto de venta', moneda: 'VES' },
];

// Diferencia máxima aceptada (en $) por el redondeo al convertir bolívares
const TOLERANCIA_USD = 0.01;
const MAXIMO_LINEAS = 10;

const buscarMetodo = (valor) => METODOS_PAGO.find((m) => m.valor === aTexto(valor));

// Datos de la petición: multipart con el campo "datos" (JSON) o un body JSON. null si el JSON no es válido.
const leerDatos = (req) => {
    if (typeof req.body?.datos !== 'string') return req.body || {};
    try {
        return JSON.parse(req.body.datos);
    } catch {
        return null;
    }
};

// ¿Alguna forma de pago es en bolívares? (entonces hace falta la tasa)
const hayBolivares = (lista) => Array.isArray(lista) && lista.some((l) => buscarMetodo(l?.metodo)?.moneda === 'VES');

// ¿Alguna forma de pago necesita banco? (entonces hay que leer la hoja Bancos)
const hayBancos = (lista) => Array.isArray(lista) && lista.some((l) => buscarMetodo(l?.metodo)?.conBanco);

// Banco activo de la hoja Bancos por id_banco (estado vacío cuenta como activo)
const bancoActivo = (bancos, idBanco) => bancos.find((b) =>
    mismoId(b.id_banco, idBanco) && ['', 'activo'].includes(aTexto(b.estado).toLowerCase()));

// Texto que se guarda en las columnas banco y banco_receptor de Pagos: "0102 - Banco de Venezuela"
const nombreBanco = (banco) => [aTexto(banco.cod_banco), aTexto(banco.nombre)].filter(Boolean).join(' - ');

const activo = (banco) => ['', 'activo'].includes(aTexto(banco.estado).toLowerCase());
const marcadoReceptor = (banco) => ['si', 'sí', 'x', '1', 'true'].includes(aTexto(banco.receptor).toLowerCase());

// Bancos que pueden recibir el pago (donde la empresa tiene cuenta): los activos con receptor = si en la hoja
// Bancos; si no hay ninguno marcado (o falta la columna), todos los activos
const bancosReceptores = (bancos) => {
    const activos = bancos.filter((b) => aTexto(b.id_banco) && activo(b));
    const marcados = activos.filter(marcadoReceptor);
    return marcados.length ? marcados : activos;
};

// Valida las formas de pago: [{ metodo, monto, referencia?, banco?, banco_receptor? }] (monto en la moneda del
// método; banco = id_banco desde el que paga el cliente y banco_receptor = id_banco al que llegó el pago, ambos
// obligatorios en pago móvil y transferencia). Devuelve { lineas, totalUsd } (total sin redondear) o { error }.
const leerLineasPago = (lista, tasa, bancos = []) => {
    if (!Array.isArray(lista) || !lista.length) return { error: 'Agrega al menos una forma de pago.' };
    if (lista.length > MAXIMO_LINEAS) return { error: `Se admiten como máximo ${MAXIMO_LINEAS} formas de pago.` };

    const lineas = [];
    for (const [i, linea] of lista.entries()) {
        const metodo = buscarMetodo(linea?.metodo);
        const monto = aNumeroOpcional(linea?.monto);
        if (!metodo) return { error: `Forma de pago no válida en la línea ${i + 1}.` };
        if (!monto) return { error: `El monto de ${metodo.etiqueta} debe ser mayor que 0.` };
        const enBolivares = metodo.moneda === 'VES';
        if (enBolivares && !(tasa > 0)) return { error: 'Falta la tasa del dólar para los pagos en bolívares.' };
        let banco = '';
        let bancoReceptor = '';
        if (metodo.conBanco) {
            const elegido = bancoActivo(bancos, linea?.banco);
            if (!elegido) return { error: `Elige el banco de ${metodo.etiqueta} (línea ${i + 1}).` };
            banco = nombreBanco(elegido);
            const receptor = bancosReceptores(bancos).find((b) => mismoId(b.id_banco, linea?.banco_receptor));
            if (!receptor) return { error: `Elige el banco receptor de ${metodo.etiqueta} (línea ${i + 1}).` };
            bancoReceptor = nombreBanco(receptor);
        }

        lineas.push({
            linea: i,
            metodo,
            referencia: aTexto(linea?.referencia),
            banco,
            banco_receptor: bancoReceptor,
            monto_bs: enBolivares ? redondear(monto) : null,
            usd: enBolivares ? monto / tasa : monto,
        });
    }
    return { lineas, totalUsd: lineas.reduce((suma, l) => suma + l.usd, 0) };
};

// Reparte el total en dólares entre las líneas con 2 decimales; la última absorbe el redondeo
const repartirUsd = (lineas, total) => {
    let restante = redondear(total);
    return lineas.map((l, i) => {
        const monto = i === lineas.length - 1 ? restante : redondear(l.usd);
        restante = redondear(restante - monto);
        return { ...l, monto };
    });
};

// Filas de la hoja Pagos para las líneas de un cobro (comunes: id_deuda, id_venta, id_cliente, fecha_pago...)
const filasPago = (lineas, { ids, comprobantes, tasa, ...comunes }) => lineas.map((l, i) => ({
    id_pago: ids[i],
    ...comunes,
    monto: l.monto,
    moneda: l.metodo.moneda,
    monto_bs: l.monto_bs ?? '',
    tasa_bcv: l.monto_bs !== null ? tasa : '',
    metodo_pago: l.metodo.etiqueta,
    banco: l.banco ?? '',
    banco_receptor: l.banco_receptor ?? '',
    referencia: l.referencia,
    comprobante_url: comprobantes[l.linea] ?? '',
    estado_verificacion: 'pendiente',
}));

// Pago listo para responder: montos como número y nombre del cliente.
// monto siempre es en dólares (lo que se descuenta); monto_bs y tasa_bcv, si se pagó en bolívares.
// comprobante indica si tiene archivo (se descarga por /pagos/:id/comprobante, no se expone el nombre).
const formatearPago = ({ _fila, comprobante_url: comprobanteUrl, ...pago }, clientes = []) => ({
    ...pago,
    moneda: aTexto(pago.moneda).toUpperCase() || 'USD',
    monto: aMonto(pago.monto),
    monto_bs: aMontoOpcional(pago.monto_bs),
    tasa_bcv: aMontoOpcional(pago.tasa_bcv),
    id_plazo: aTexto(pago.id_plazo) || null, // plazo de la hoja Plazos con que se cobró
    plazo_dias: aMontoOpcional(pago.plazo_dias), // pagos anteriores al motor de precios (0, 7, 15 o 30)
    monto_factura: aMontoOpcional(pago.monto_factura),
    descuento: aMontoOpcional(pago.descuento),
    estado_verificacion: aTexto(pago.estado_verificacion).toLowerCase() || 'pendiente',
    comprobante: Boolean(aTexto(comprobanteUrl)),
    cliente_nombre: clientes.find((c) => mismoId(c.id_cliente, pago.id_cliente))?.nombre_comercial ?? '',
});

// Tasa para convertir las formas de pago en bolívares: la enviada o la del día. { tasa } o { error }
// No llamar dentro de conBloqueo (tasaDelDia guarda con su propio bloqueo)
const resolverTasa = async (datos, fecha) => {
    if (!hayBolivares(datos.pagos)) return { tasa: null };
    const enviada = datos.tasa_bcv;
    if (enviada !== undefined && enviada !== null && enviada !== '') {
        const tasa = aNumeroOpcional(enviada);
        return tasa ? { tasa: redondearTasa(tasa) } : { error: 'La tasa debe ser un número mayor que 0.' };
    }
    const delDia = await tasaDelDia(fecha);
    return delDia ? { tasa: delDia.tasa } : { error: 'No se pudo obtener la tasa del dólar. Escríbela a mano.' };
};

module.exports = {
    METODOS_PAGO,
    TOLERANCIA_USD,
    leerDatos,
    hayBancos,
    bancosReceptores,
    nombreBanco,
    leerLineasPago,
    repartirUsd,
    filasPago,
    formatearPago,
    resolverTasa,
};

