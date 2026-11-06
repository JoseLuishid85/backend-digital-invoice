const { HOJAS, errorConStatus } = require('../services/googleSheetsService');
const { diasEntre } = require('./valores');
const { aMonto, aMontoOpcional, redondear, mismoId, aTexto, lineasDe, productoDeLinea } = require('./cartera');

// Motor de precios (hojas Niveles, Plazos y Precios):
// - Niveles: el nivel de una línea del pedido según la cantidad de ese producto (L1 0-99, L2 100-299...).
// - Plazos: tramos de días desde la entrega (Contado, Crédito 1, Crédito 2...). El marcado se_factura = si es el
//   precio con el que se factura el pedido (el más alto); los demás son los que se cobran si paga antes.
// - Precios: una fila por producto, nivel, plazo y moneda con su precio_final (USD) y datos informativos
//   (ajuste_pct, ajuste_monto, ganancia_pct). La moneda se conoce al cobrar: USD = paga en divisas,
//   VES = paga en bolívares (el precio sigue en dólares y se paga a la tasa BCV del día del pago).
// Al pedir se toma el precio más alto del plazo que se factura entre las dos monedas; al cobrar, el del plazo
// y la moneda de cada forma de pago.

const MONEDAS = ['USD', 'VES'];

// Columnas de cada hoja del motor (las exige el script de preparación y la escritura de precios)
const COLUMNAS_PRECIOS = {
    [HOJAS.niveles]: ['id_nivel', 'nombre', 'unidades_desde', 'unidades_hasta', 'estado'],
    [HOJAS.plazos]: ['id_plazo', 'nombre', 'dias_desde', 'dias_hasta', 'se_factura', 'orden', 'estado'],
    [HOJAS.precios]: ['id_precio', 'id_producto', 'id_nivel', 'id_plazo', 'moneda', 'ajuste_pct', 'ajuste_monto',
        'precio_final', 'ganancia_pct'],
};

const activo = (fila) => ['', 'activo'].includes(aTexto(fila.estado).toLowerCase());
const esSi = (valor) => ['si', 'sí', 'true', '1', 'x'].includes(aTexto(valor).toLowerCase());
const aMoneda = (valor) => {
    const texto = aTexto(valor).toUpperCase();
    if (texto === '$' || texto === 'USD') return 'USD';
    if (texto === 'BS' || texto === 'VES') return 'VES';
    return null;
};

// Niveles activos ordenados por unidades_desde. hasta null = sin límite
const leerNiveles = (filas) => filas.filter(activo)
    .map((n) => ({
        id_nivel: aTexto(n.id_nivel),
        nombre: aTexto(n.nombre) || aTexto(n.id_nivel),
        unidades_desde: aMonto(n.unidades_desde),
        unidades_hasta: aMontoOpcional(n.unidades_hasta),
    }))
    .filter((n) => n.id_nivel)
    .sort((a, b) => a.unidades_desde - b.unidades_desde);

// Plazos activos en su orden (o por dias_desde). hasta null = sin límite
const leerPlazos = (filas) => filas.filter(activo)
    .map((p) => ({
        id_plazo: aTexto(p.id_plazo),
        nombre: aTexto(p.nombre) || aTexto(p.id_plazo),
        dias_desde: aMonto(p.dias_desde),
        dias_hasta: aMontoOpcional(p.dias_hasta),
        se_factura: esSi(p.se_factura),
        orden: aMontoOpcional(p.orden),
    }))
    .filter((p) => p.id_plazo)
    .sort((a, b) => (a.orden ?? a.dias_desde) - (b.orden ?? b.dias_desde) || a.dias_desde - b.dias_desde)
    .map(({ orden, ...p }) => p);

// Nivel de una línea según su cantidad. Una cantidad en un hueco entre niveles toma el nivel inferior más cercano.
const nivelPorCantidad = (niveles, cantidad) => niveles
    .filter((n) => n.unidades_desde <= cantidad).pop() ?? niveles[0];

// Plazo con el que se factura: el marcado se_factura o, si ninguno lo está, el último
const plazoFactura = (plazos) => plazos.find((p) => p.se_factura) ?? plazos[plazos.length - 1];

// Plazo que corresponde a los días desde la entrega. Un día en un hueco entre plazos (p. ej. 16 a 20 si
// Crédito 2 empieza el 21) toma el plazo siguiente: pasado el último día de un plazo se pierde su descuento.
const plazoPorDias = (plazos, dias) => {
    const porDesde = [...plazos].sort((a, b) => a.dias_desde - b.dias_desde);
    return porDesde.find((p) => dias >= p.dias_desde && (p.dias_hasta === null || dias <= p.dias_hasta))
        ?? porDesde.find((p) => p.dias_desde > dias)
        ?? plazoFactura(plazos);
};

const clavePrecio = (idProducto, idNivel, idPlazo, moneda) =>
    [idProducto, idNivel, idPlazo, moneda].map((v) => aTexto(v).toUpperCase()).join('|');

// Fila de Precios lista para responder (los números como número; vacío = null)
const formatearPrecio = ({ _fila, ...fila }) => ({
    id_precio: aTexto(fila.id_precio),
    id_producto: aTexto(fila.id_producto),
    id_nivel: aTexto(fila.id_nivel),
    id_plazo: aTexto(fila.id_plazo),
    moneda: aMoneda(fila.moneda),
    ajuste_pct: aMontoOpcional(fila.ajuste_pct),
    ajuste_monto: aMontoOpcional(fila.ajuste_monto),
    precio_final: aMontoOpcional(fila.precio_final),
    ganancia_pct: aMontoOpcional(fila.ganancia_pct),
});

// Configuración del motor a partir de las filas de las tres hojas: { niveles, plazos, factura, precios (Map) }.
// Sin niveles o sin plazos no se puede preciar: 500 con el nombre de la hoja.
const configuracionPrecios = (filasNiveles, filasPlazos, filasPrecios) => {
    const niveles = leerNiveles(filasNiveles);
    const plazos = leerPlazos(filasPlazos);
    if (!niveles.length) throw errorConStatus(`La hoja "${HOJAS.niveles}" no tiene niveles activos.`, 500);
    if (!plazos.length) throw errorConStatus(`La hoja "${HOJAS.plazos}" no tiene plazos activos.`, 500);

    const precios = new Map();
    for (const fila of filasPrecios) {
        const precio = formatearPrecio(fila);
        if (!precio.moneda || precio.precio_final === null) continue;
        precios.set(clavePrecio(precio.id_producto, precio.id_nivel, precio.id_plazo, precio.moneda), precio);
    }
    return { niveles, plazos, factura: plazoFactura(plazos), precios };
};

// Lo mismo leyendo las hojas de un resultado de leerHojas (debe incluir Niveles, Plazos y Precios)
const configuracionDe = (hojas) => configuracionPrecios(
    hojas[HOJAS.niveles].filas, hojas[HOJAS.plazos].filas, hojas[HOJAS.precios].filas);

const HOJAS_PRECIOS = [HOJAS.niveles, HOJAS.plazos, HOJAS.precios];

// Precio final de un producto en un nivel, plazo y moneda; null si no está definido
const precioDe = (config, idProducto, idNivel, idPlazo, moneda) =>
    config.precios.get(clavePrecio(idProducto, idNivel, idPlazo, moneda))?.precio_final ?? null;

// Precio de factura de un producto en un nivel: el más alto de las dos monedas en el plazo que se factura.
// null si no tiene ninguno.
const precioFacturaDe = (config, idProducto, idNivel) => {
    const precios = MONEDAS.map((m) => precioDe(config, idProducto, idNivel, config.factura.id_plazo, m))
        .filter((p) => p !== null);
    return precios.length ? Math.max(...precios) : null;
};

// Precio de factura por nivel de un producto: { L1: 35.94, L2: ..., ... } (null donde falta)
const preciosFacturaPorNivel = (config, idProducto) => Object.fromEntries(
    config.niveles.map((n) => [n.id_nivel, precioFacturaDe(config, idProducto, n.id_nivel)]));

// Filas de Precios de un producto ordenadas por moneda, plazo y nivel
const preciosDelProducto = (config, idProducto) => {
    const ordenPlazo = (id) => config.plazos.findIndex((p) => mismoId(p.id_plazo, id));
    const ordenNivel = (id) => config.niveles.findIndex((n) => mismoId(n.id_nivel, id));
    return [...config.precios.values()]
        .filter((p) => mismoId(p.id_producto, idProducto))
        .sort((a, b) => MONEDAS.indexOf(a.moneda) - MONEDAS.indexOf(b.moneda)
            || ordenPlazo(a.id_plazo) - ordenPlazo(b.id_plazo)
            || ordenNivel(a.id_nivel) - ordenNivel(b.id_nivel));
};

// Configuración para el frontend (sin el mapa de precios)
const configuracionPublica = (config) => ({
    monedas: MONEDAS,
    niveles: config.niveles,
    plazos: config.plazos,
    id_plazo_factura: config.factura.id_plazo,
});

// ---------- Cobro por plazos ----------

// Nivel de una línea de venta: el que guardó el pedido o, en las anteriores al motor, el de su cantidad
const nivelDeLinea = (config, linea) => {
    const guardado = config.niveles.find((n) => mismoId(n.id_nivel, linea.id_nivel));
    return guardado ?? nivelPorCantidad(config.niveles, linea.cantidad);
};

// Totales de la venta de una deuda: lo facturado y lo que costaría en cada plazo y moneda.
// { factura, plazos: { [id_plazo]: { USD, VES } }, lineas: [{ ...linea, id_nivel, precios: { [id_plazo]: { USD, VES } } }] }
// Sin precio para un plazo o moneda (o producto que ya no existe) se usa el precio facturado: sin descuento.
// null si la deuda no viene de una venta con productos (deuda manual): no tiene plazos.
const totalesCobro = (deuda, ventas, detalles, catalogo, config) => {
    const venta = ventas.find((v) => mismoId(v.id_deuda, deuda.id_deuda));
    if (!venta) return null;
    const lineas = lineasDe(detalles, 'id_venta', venta.id_venta);
    if (!lineas.length) return null;

    const conPrecios = lineas.map((linea) => {
        const producto = productoDeLinea(catalogo, linea);
        const nivel = nivelDeLinea(config, linea);
        const precios = Object.fromEntries(config.plazos.map((plazo) => [plazo.id_plazo, Object.fromEntries(
            MONEDAS.map((moneda) => {
                const precio = producto && precioDe(config, producto.id_producto, nivel.id_nivel, plazo.id_plazo, moneda);
                // Nunca más caro que lo facturado
                return [moneda, redondear(precio !== null && precio !== undefined
                    ? Math.min(precio, linea.precio_unitario) : linea.precio_unitario)];
            }))]));
        return { ...linea, id_nivel: nivel.id_nivel, precios };
    });

    const plazos = Object.fromEntries(config.plazos.map((plazo) => [plazo.id_plazo, Object.fromEntries(
        MONEDAS.map((moneda) => [moneda, redondear(conPrecios.reduce(
            (suma, linea) => suma + linea.cantidad * linea.precios[plazo.id_plazo][moneda], 0))]))]));

    return {
        factura: redondear(lineas.reduce((suma, linea) => suma + linea.subtotal, 0)),
        plazos,
        lineas: conPrecios,
    };
};

// Cuánto se cobra de verdad en un plazo y moneda frente a lo facturado (1 sin plazos; menor que 1 = descuento).
// La deuda guarda sus montos a precio de factura: el saldo en un plazo es monto_pendiente × factor y cada
// forma de pago salda monto / factor de la factura. Así cada abono paga su parte al precio de su día y moneda.
const factorCobro = (totales, idPlazo, moneda) => {
    const total = totales?.plazos[idPlazo]?.[moneda];
    const factor = totales && totales.factura > 0 && total !== undefined ? total / totales.factura : 1;
    return factor > 0 ? factor : 1; // un catálogo sin precios no puede dejar la deuda en 0
};

// Días desde la emisión (la entrega) hasta el pago
const diasDesdeEmision = (deuda, fechaPago) => {
    const emision = aTexto(deuda.fecha_emision);
    return emision ? Math.max(diasEntre(emision, fechaPago), 0) : 0;
};

// Opciones de cobro de una deuda en una fecha de pago: días desde la entrega, el plazo que corresponde y, si la
// deuda tiene plazos, en cada uno y cada moneda el total, el saldo, el descuento sobre el saldo facturado y el
// factor. plazos es null sin plazos (deuda manual).
const opcionesCobro = (deuda, totales, fechaPago, config) => {
    const dias = diasDesdeEmision(deuda, fechaPago);
    const pendiente = aMonto(deuda.monto_pendiente);
    return {
        dias,
        plazo_sugerido: totales ? plazoPorDias(config.plazos, dias).id_plazo : null,
        plazos: totales && config.plazos.map((plazo) => ({
            ...plazo,
            monedas: Object.fromEntries(MONEDAS.map((moneda) => {
                const factor = factorCobro(totales, plazo.id_plazo, moneda);
                const aCobrar = redondear(pendiente * factor);
                return [moneda, {
                    total: totales.plazos[plazo.id_plazo][moneda],
                    pendiente: aCobrar,
                    descuento: redondear(pendiente - aCobrar),
                    factor,
                }];
            })),
        })),
    };
};

// Detalle de la factura de una deuda para el cobro: número, fecha y productos (con su nivel y sus precios por
// plazo y moneda si los tiene). null si la deuda no viene de una venta (deuda manual).
const detalleFactura = (deuda, ventas, detalles, totales) => {
    const venta = ventas.find((v) => mismoId(v.id_deuda, deuda.id_deuda));
    if (!venta) return null;
    const lineas = totales?.lineas ?? lineasDe(detalles, 'id_venta', venta.id_venta).map((l) => ({ ...l, precios: null }));
    return {
        id_venta: venta.id_venta,
        numero_factura: aTexto(venta.numero_factura),
        fecha_venta: aTexto(venta.fecha_venta),
        productos: lineas.map(({ id_detalle, producto, id_nivel, cantidad, precio_unitario, subtotal, precios }) =>
            ({ id_detalle, producto, id_nivel: aTexto(id_nivel), cantidad, precio_unitario, subtotal, precios })),
    };
};

// Plazo de un pago: su id_plazo o, en pagos anteriores al motor (plazo_dias 0/7/15/30) o sin plazo, el que
// corresponde por esos días o por los días desde la entrega. Devuelve el id_plazo.
const plazoDelPago = (pago, deuda, config) => {
    const guardado = config.plazos.find((p) => mismoId(p.id_plazo, pago.id_plazo));
    if (guardado) return guardado.id_plazo;
    const diasAntiguos = aMontoOpcional(pago.plazo_dias);
    const fecha = aTexto(pago.fecha_pago);
    const dias = diasAntiguos ?? (fecha ? diasDesdeEmision(deuda, fecha) : 0);
    return plazoPorDias(config.plazos, dias).id_plazo;
};

module.exports = {
    MONEDAS,
    COLUMNAS_PRECIOS,
    HOJAS_PRECIOS,
    aMoneda,
    leerNiveles,
    leerPlazos,
    nivelPorCantidad,
    plazoPorDias,
    clavePrecio,
    formatearPrecio,
    configuracionPrecios,
    configuracionDe,
    configuracionPublica,
    precioDe,
    precioFacturaDe,
    preciosFacturaPorNivel,
    preciosDelProducto,
    totalesCobro,
    factorCobro,
    opcionesCobro,
    detalleFactura,
    plazoDelPago,
};
