const { aMonto, aMontoOpcional, redondear, sumar, mismoId, aTexto, formatearDeuda } = require('./cartera');
const { formatearPago } = require('./cobros');
const { fechaHoy, diasEntre } = require('./valores');

// Historial de un cliente (estado de cuenta y qué tan responsable es pagando). Lo usan el vendedor (sus clientes)
// y el administrador (cualquiera).

// Reglas de la calificación (ajustarlas aquí):
// - riesgo:    alguna deuda abierta con más de DIAS_RIESGO días de atraso, o DEUDAS_VENCIDAS_RIESGO vencidas o más
// - regular:   alguna deuda vencida, o menos de A_TIEMPO_BUENA de las deudas pagadas se pagaron a tiempo
// - buena:     nada vencido y entre A_TIEMPO_BUENA y A_TIEMPO_EXCELENTE pagadas a tiempo (o aún ninguna pagada)
// - excelente: nada vencido y al menos A_TIEMPO_EXCELENTE pagadas a tiempo
// - nuevo:     todavía no tiene deudas
const DIAS_RIESGO = 30;
const DEUDAS_VENCIDAS_RIESGO = 2;
const A_TIEMPO_BUENA = 0.7;
const A_TIEMPO_EXCELENTE = 0.9;

const porcentaje = (parte, total) => (total ? Math.round((parte / total) * 100) : null);

function calificar({ deudas, pagadas, aTiempo, vencidas, maxAtraso }) {
    if (!deudas) return { nivel: 'nuevo', texto: 'Sin historial', motivo: 'Todavía no tiene facturas a crédito.' };
    if (maxAtraso > DIAS_RIESGO || vencidas >= DEUDAS_VENCIDAS_RIESGO) {
        return {
            nivel: 'riesgo',
            texto: 'Riesgo alto',
            motivo: maxAtraso > DIAS_RIESGO
                ? `Tiene una factura con ${maxAtraso} días de atraso.`
                : `Tiene ${vencidas} facturas vencidas sin pagar.`,
        };
    }
    const ratio = pagadas ? aTiempo / pagadas : null;
    if (vencidas > 0) return { nivel: 'regular', texto: 'Regular', motivo: 'Tiene una factura vencida sin pagar.' };
    if (ratio !== null && ratio < A_TIEMPO_BUENA) {
        return { nivel: 'regular', texto: 'Regular', motivo: `Pagó a tiempo ${aTiempo} de ${pagadas} facturas.` };
    }
    if (ratio === null) return { nivel: 'buena', texto: 'Buena', motivo: 'Nada vencido; aún no ha terminado de pagar ninguna factura.' };
    if (ratio < A_TIEMPO_EXCELENTE) {
        return { nivel: 'buena', texto: 'Buena', motivo: `Nada vencido; pagó a tiempo ${aTiempo} de ${pagadas} facturas.` };
    }
    return { nivel: 'excelente', texto: 'Excelente', motivo: `Nada vencido; pagó a tiempo ${aTiempo} de ${pagadas} facturas.` };
}

// filas: { deudas, pagos, ventas } sin filtrar (de las hojas). cliente: la fila del cliente.
const historialDeCliente = (cliente, { deudas, pagos, ventas }) => {
    const hoy = fechaHoy();
    const idCliente = cliente.id_cliente;
    const susPagos = pagos.filter((p) => mismoId(p.id_cliente, idCliente)).map((p) => formatearPago(p, [cliente]));
    const susVentas = ventas.filter((v) => mismoId(v.id_cliente, idCliente));

    const susDeudas = deudas
        .filter((d) => mismoId(d.id_cliente, idCliente))
        .map((fila) => {
            const deuda = formatearDeuda(fila, [cliente]);
            const pagosDeuda = susPagos.filter((p) => mismoId(p.id_deuda, deuda.id_deuda));
            const ultimoPago = pagosDeuda.map((p) => aTexto(p.fecha_pago)).sort().pop() ?? '';
            const pagada = deuda.monto_pendiente <= 0;
            // Fecha en que se terminó de pagar: la guardada por POST /pagos o, en las viejas, el último pago
            const cancelada = pagada ? (aTexto(deuda.fecha_cancelacion) || ultimoPago) : '';
            const emision = aTexto(deuda.fecha_emision);
            const vencimiento = aTexto(deuda.fecha_vencimiento);
            return {
                ...deuda,
                pagada,
                fecha_cancelacion: cancelada,
                cobrado: sumar(pagosDeuda, 'monto'),
                descuento: sumar(pagosDeuda, 'descuento'),
                pagos: pagosDeuda.length,
                ultimo_pago: ultimoPago,
                dias_para_pagar: pagada && cancelada && emision ? diasEntre(emision, cancelada) : null,
                // null si no se puede saber (sin vencimiento o sin fecha de pago)
                a_tiempo: pagada && cancelada && vencimiento ? cancelada <= vencimiento : null,
                dias_atraso: deuda.vencida ? diasEntre(vencimiento, hoy) : 0,
            };
        })
        .sort((a, b) => aTexto(b.fecha_emision).localeCompare(aTexto(a.fecha_emision)) || aTexto(b.id_deuda).localeCompare(aTexto(a.id_deuda)));

    const pagadas = susDeudas.filter((d) => d.pagada);
    const conFechaATiempo = pagadas.filter((d) => d.a_tiempo !== null);
    const aTiempo = conFechaATiempo.filter((d) => d.a_tiempo).length;
    const vencidas = susDeudas.filter((d) => d.vencida);
    const conDias = pagadas.filter((d) => d.dias_para_pagar !== null);

    // Estado de cuenta: cargos (facturas a crédito y ventas de contado sin deuda) y abonos, con el saldo acumulado.
    // Cada abono baja el saldo por lo que liquidó de la factura (monto_factura); la diferencia es el descuento.
    const cargos = [
        ...susDeudas.map((d) => ({
            tipo: 'cargo',
            fecha: aTexto(d.fecha_emision),
            id: d.id_deuda,
            concepto: d.numero_factura ? `Factura ${d.numero_factura}` : `Deuda ${d.id_deuda}`,
            cargo: d.monto_total,
        })),
        ...susVentas.filter((v) => !aTexto(v.id_deuda)).map((v) => ({
            tipo: 'cargo',
            fecha: aTexto(v.fecha_venta),
            id: aTexto(v.id_venta),
            concepto: `Venta de contado ${aTexto(v.numero_factura) || aTexto(v.id_venta)}`,
            cargo: aMonto(v.monto_total),
        })),
    ];
    const documentos = new Map(susDeudas.map((d) => [d.id_deuda, d.numero_factura]));
    const abonos = susPagos.map((p) => ({
        tipo: 'abono',
        fecha: aTexto(p.fecha_pago),
        id: p.id_pago,
        concepto: `${p.metodo_pago}${p.referencia ? ` · Ref. ${p.referencia}` : ''}`,
        documento: p.id_deuda ? (documentos.get(p.id_deuda) ? `Factura ${documentos.get(p.id_deuda)}` : p.id_deuda) : `Venta ${p.id_venta}`,
        abono: p.monto,
        descuento: p.descuento ?? 0,
        liquidado: aMontoOpcional(p.monto_factura) ?? p.monto,
        estado_verificacion: p.estado_verificacion,
    }));
    let saldo = 0;
    const movimientos = [...cargos, ...abonos]
        // Por fecha; el mismo día, primero el cargo
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === b.tipo ? a.id.localeCompare(b.id) : a.tipo === 'cargo' ? -1 : 1))
        .map((m) => {
            saldo = redondear(saldo + (m.cargo ?? 0) - (m.liquidado ?? 0));
            return { ...m, saldo: Math.max(0, saldo) };
        })
        .reverse();

    const cifras = {
        deudas: susDeudas.length,
        pagadas: pagadas.length,
        aTiempo,
        vencidas: vencidas.length,
        maxAtraso: Math.max(0, ...vencidas.map((d) => d.dias_atraso)),
    };
    const fechasPago = susPagos.map((p) => aTexto(p.fecha_pago)).filter(Boolean).sort();

    return {
        resumen: {
            facturado: sumar(susDeudas, 'monto_total'),
            cobrado: sumar(susPagos, 'monto'),
            descuento: sumar(susPagos, 'descuento'),
            saldo: sumar(susDeudas, 'monto_pendiente'),
            vencido: sumar(vencidas, 'monto_pendiente'),
            deudas: susDeudas.length,
            deudas_abiertas: susDeudas.length - pagadas.length,
            deudas_pagadas: pagadas.length,
            deudas_vencidas: vencidas.length,
            pagadas_a_tiempo: aTiempo,
            pagadas_tarde: conFechaATiempo.length - aTiempo,
            porcentaje_a_tiempo: porcentaje(aTiempo, conFechaATiempo.length),
            dias_promedio_pago: conDias.length
                ? Math.round(conDias.reduce((suma, d) => suma + d.dias_para_pagar, 0) / conDias.length)
                : null,
            max_dias_atraso: cifras.maxAtraso,
            pagos: susPagos.length,
            pagos_por_verificar: susPagos.filter((p) => p.estado_verificacion === 'pendiente').length,
            pagos_rechazados: susPagos.filter((p) => p.estado_verificacion === 'rechazado').length,
            primer_pago: fechasPago[0] ?? '',
            ultimo_pago: fechasPago.at(-1) ?? '',
            cliente_desde: aTexto(cliente.fecha_registro) || aTexto(cliente.fecha_creacion),
        },
        calificacion: calificar(cifras),
        deudas: susDeudas,
        movimientos,
    };
};

module.exports = { historialDeCliente };
