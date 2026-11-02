const { aMonto, redondear, sumar, mismoId, aTexto, formatearVenta, cobroDeVenta, masRecientePrimero } = require('./cartera');
const { aFecha, fechaHoy, sumarDias, diasEntre } = require('./valores');

// Consultas de ventas por período (menú Consultas). Las usan el vendedor (sus ventas) y el administrador
// (todas o las de un vendedor): el controlador filtra las filas y aquí solo se agrupan y suman.

const AGRUPACIONES = ['dia', 'semana', 'mes'];

// Límites para que la serie no tenga miles de puntos
const MAX_DIAS_RANGO = 366 * 5;
const MAX_DIAS_POR_DIA = 366;

// Lunes de la semana de una fecha YYYY-MM-DD (semanas de lunes a domingo)
const lunesDe = (fecha) => {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0 = domingo
    return sumarDias(fecha, diaSemana === 0 ? -6 : 1 - diaSemana);
};

const ultimoDiaDelMes = (periodo) => {
    const [anio, mes] = periodo.split('-').map(Number);
    return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
};

// Clave del grupo al que pertenece una fecha: el día, el lunes de su semana o YYYY-MM
const claveDe = (fecha, agrupar) => {
    if (agrupar === 'mes') return fecha.slice(0, 7);
    if (agrupar === 'semana') return lunesDe(fecha);
    return fecha;
};

// Todos los grupos entre desde y hasta (también los vacíos, para que la serie no tenga huecos)
const gruposDelRango = (desde, hasta, agrupar) => {
    const grupos = [];
    let actual = claveDe(desde, agrupar);
    while (true) {
        const inicio = agrupar === 'mes' ? `${actual}-01` : actual;
        if (inicio > hasta) break;
        let fin = actual;
        if (agrupar === 'semana') fin = sumarDias(actual, 6);
        if (agrupar === 'mes') fin = ultimoDiaDelMes(actual);
        // El primer y el último grupo se recortan al rango pedido
        grupos.push({ clave: actual, desde: inicio < desde ? desde : inicio, hasta: fin > hasta ? hasta : fin });
        actual = agrupar === 'mes' ? sumarDias(fin, 1).slice(0, 7) : sumarDias(fin, 1);
    }
    return grupos;
};

// Lee desde, hasta y agrupar de la query. Sin fechas: el mes en curso. Devuelve { error } si algo no vale.
const leerPeriodo = (query) => {
    const hoy = fechaHoy();
    const desde = query.desde ? aFecha(query.desde) : `${hoy.slice(0, 7)}-01`;
    const hasta = query.hasta ? aFecha(query.hasta) : hoy;
    const agrupar = aTexto(query.agrupar).toLowerCase() || 'dia';

    if (!desde || !hasta) return { error: 'Fecha inválida. Usa el formato YYYY-MM-DD.' };
    if (desde > hasta) return { error: 'La fecha inicial no puede ser posterior a la final.' };
    if (!AGRUPACIONES.includes(agrupar)) return { error: `agrupar debe ser ${AGRUPACIONES.join(', ')}.` };

    const dias = diasEntre(desde, hasta) + 1;
    if (dias > MAX_DIAS_RANGO) return { error: 'El rango no puede pasar de 5 años.' };
    if (agrupar === 'dia' && dias > MAX_DIAS_POR_DIA) {
        return { error: 'Para más de un año agrupa por semana o por mes.' };
    }
    return { desde, hasta, agrupar };
};

const enRango = (fecha, desde, hasta) => fecha >= desde && fecha <= hasta;

// Arma la consulta con las filas ya filtradas por vendedor:
// { ventas, pagos, detalles, clientes, deudas } son filas de las hojas; ventas y pagos aún sin filtrar por fecha.
// nombreDeVendedor (opcional) agrega vendedor_nombre a cada venta y el desglose por_vendedor.
const armarConsulta = ({ ventas, pagos, detalles, clientes, deudas }, { desde, hasta, agrupar }, nombreDeVendedor) => {
    const ventasPeriodo = ventas
        .filter((v) => enRango(aTexto(v.fecha_venta), desde, hasta))
        .sort(masRecientePrimero('fecha_venta', 'id_venta'))
        .map((v) => ({
            ...formatearVenta(v, clientes, detalles),
            ...(nombreDeVendedor && { vendedor_nombre: nombreDeVendedor(v.id_vendedor) }),
            cobro: cobroDeVenta(v, deudas, pagos),
        }));
    // Cobrado en el período: los pagos recibidos esas fechas, sean de ventas del período o de antes
    const pagosPeriodo = pagos.filter((p) => enRango(aTexto(p.fecha_pago), desde, hasta));

    const monto = sumar(ventasPeriodo, 'monto_total');
    const lineas = ventasPeriodo.flatMap((v) => v.productos.map((p) => ({ ...p, id_venta: v.id_venta })));

    // Serie por día, semana o mes
    const serie = gruposDelRango(desde, hasta, agrupar).map((g) => ({ ...g, ventas: 0, monto: 0, cobrado: 0 }));
    const indice = new Map(serie.map((g, i) => [g.clave, i]));
    ventasPeriodo.forEach((v) => {
        const grupo = serie[indice.get(claveDe(aTexto(v.fecha_venta), agrupar))];
        if (!grupo) return;
        grupo.ventas += 1;
        grupo.monto += v.monto_total;
    });
    pagosPeriodo.forEach((p) => {
        const grupo = serie[indice.get(claveDe(aTexto(p.fecha_pago), agrupar))];
        if (grupo) grupo.cobrado += aMonto(p.monto);
    });
    serie.forEach((g) => {
        g.monto = redondear(g.monto);
        g.cobrado = redondear(g.cobrado);
    });

    // Productos vendidos: por ID del catálogo o, en las líneas viejas sin ID, por el nombre
    const porProducto = new Map();
    lineas.forEach((l) => {
        const clave = aTexto(l.id_producto) || aTexto(l.producto).toLowerCase();
        const actual = porProducto.get(clave)
            ?? { id_producto: aTexto(l.id_producto), producto: aTexto(l.producto), cantidad: 0, monto: 0, ventas: new Set() };
        actual.cantidad += l.cantidad;
        actual.monto += l.subtotal;
        actual.ventas.add(l.id_venta);
        porProducto.set(clave, actual);
    });
    const productos = [...porProducto.values()]
        .map((p) => ({ ...p, cantidad: redondear(p.cantidad), monto: redondear(p.monto), ventas: p.ventas.size }))
        .sort((a, b) => b.monto - a.monto || b.cantidad - a.cantidad);

    // Clientes que más compraron
    const porCliente = new Map();
    ventasPeriodo.forEach((v) => {
        const actual = porCliente.get(v.id_cliente)
            ?? { id_cliente: v.id_cliente, nombre: v.cliente_nombre || v.id_cliente, ventas: 0, monto: 0 };
        actual.ventas += 1;
        actual.monto += v.monto_total;
        porCliente.set(v.id_cliente, actual);
    });
    const porClienteLista = [...porCliente.values()]
        .map((c) => ({ ...c, monto: redondear(c.monto) }))
        .sort((a, b) => b.monto - a.monto);

    const resultado = {
        desde,
        hasta,
        agrupar,
        resumen: {
            ventas: ventasPeriodo.length,
            monto,
            promedio: ventasPeriodo.length ? redondear(monto / ventasPeriodo.length) : 0,
            unidades: redondear(lineas.reduce((suma, l) => suma + l.cantidad, 0)),
            productos: productos.length,
            clientes: porCliente.size,
            cobrado: sumar(pagosPeriodo, 'monto'),
            descuento: sumar(pagosPeriodo, 'descuento'),
            // Lo que aún se debe de las ventas del período
            pendiente: redondear(ventasPeriodo.reduce((suma, v) => suma + v.cobro.pendiente, 0)),
        },
        serie,
        productos,
        clientes: porClienteLista,
        ventas: ventasPeriodo,
    };

    if (nombreDeVendedor) {
        const porVendedor = new Map();
        ventasPeriodo.forEach((v) => {
            const actual = porVendedor.get(v.id_vendedor)
                ?? { id_vendedor: v.id_vendedor, nombre: v.vendedor_nombre || v.id_vendedor, ventas: 0, monto: 0 };
            actual.ventas += 1;
            actual.monto += v.monto_total;
            porVendedor.set(v.id_vendedor, actual);
        });
        resultado.por_vendedor = [...porVendedor.values()]
            .map((v) => ({ ...v, monto: redondear(v.monto) }))
            .sort((a, b) => b.monto - a.monto);
    }

    return resultado;
};

// Pagos de un grupo de clientes (la hoja Pagos no guarda el vendedor: sale del cliente)
const pagosDeClientes = (pagos, clientes) => pagos.filter((p) => clientes.some((c) => mismoId(c.id_cliente, p.id_cliente)));

module.exports = { AGRUPACIONES, leerPeriodo, armarConsulta, pagosDeClientes };
