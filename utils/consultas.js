const {
    aMonto, redondear, sumar, mismoId, aTexto, formatearVenta, cobroDeVenta, masRecientePrimero,
    ESTADOS_PEDIDO, formatearPedido, productoDeLinea,
} = require('./cartera');
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

// Filtros de la consulta de productos en pedidos: estado (por defecto pendiente) y, opcional, desde/hasta por
// fecha_pedido (sin fechas: todos los pedidos de ese estado). { error } si algo no vale.
const leerFiltrosPedidos = (query) => {
    const estado = aTexto(query.estado).toLowerCase() || 'pendiente';
    if (!ESTADOS_PEDIDO.includes(estado)) return { error: `El estado debe ser ${ESTADOS_PEDIDO.join(', ')}.` };
    if (!query.desde && !query.hasta) return { estado, desde: null, hasta: null };

    const desde = aFecha(query.desde);
    const hasta = aFecha(query.hasta);
    if (!desde || !hasta) return { error: 'Indica las dos fechas (desde y hasta) con el formato YYYY-MM-DD.' };
    if (desde > hasta) return { error: 'La fecha inicial no puede ser posterior a la final.' };
    if (diasEntre(desde, hasta) + 1 > MAX_DIAS_RANGO) return { error: 'El rango no puede pasar de 5 años.' };
    return { estado, desde, hasta };
};

// Productos en pedidos, agrupados por producto (por ID del catálogo o, sin ID, por el nombre).
// pedidos: filas de Pedidos ya filtradas por vendedor; todosLosPedidos: los de todos los vendedores (para lo
// comprometido); detalles: Pedidos_Detalle; catalogo: Productos (stock). nombreDeVendedor (opcional, administrador).
// En los pendientes cada producto trae stock, comprometido (unidades en pedidos pendientes de todos los vendedores,
// lo que se descontará al facturar) y falta (lo comprometido que el stock no cubre).
const armarConsultaPedidos = ({ pedidos, todosLosPedidos, detalles, clientes, catalogo }, { estado, desde, hasta }, nombreDeVendedor) => {
    const delFiltro = pedidos
        .map((p) => formatearPedido(p, clientes, detalles))
        .filter((p) => p.estado === estado && (!desde || enRango(aTexto(p.fecha_pedido), desde, hasta)))
        .sort(masRecientePrimero('fecha_pedido', 'id_pedido'));

    const claveDeLinea = (l) => aTexto(l.id_producto).toUpperCase() || aTexto(l.producto).toLowerCase();

    // Unidades comprometidas por producto en todos los pedidos pendientes (de cualquier vendedor y fecha)
    const comprometido = new Map();
    if (estado === 'pendiente') {
        const pendientes = new Set(todosLosPedidos
            .filter((p) => (aTexto(p.estado).toLowerCase() || 'pendiente') === 'pendiente')
            .map((p) => aTexto(p.id_pedido).toUpperCase()));
        detalles
            .filter((d) => pendientes.has(aTexto(d.id_pedido).toUpperCase()))
            .forEach((d) => comprometido.set(claveDeLinea(d), (comprometido.get(claveDeLinea(d)) ?? 0) + aMonto(d.cantidad)));
    }

    const porProducto = new Map();
    delFiltro.forEach((pedido) => pedido.productos.forEach((l) => {
        const clave = claveDeLinea(l);
        const actual = porProducto.get(clave) ?? {
            id_producto: aTexto(l.id_producto),
            producto: aTexto(l.producto),
            cantidad: 0,
            monto: 0,
            pedidos: new Set(),
            clientes: new Set(),
            detalle: [],
        };
        actual.cantidad += l.cantidad;
        actual.monto += l.subtotal;
        actual.pedidos.add(pedido.id_pedido);
        actual.clientes.add(aTexto(pedido.id_cliente).toUpperCase());
        actual.detalle.push({
            id_pedido: pedido.id_pedido,
            fecha_pedido: pedido.fecha_pedido,
            id_cliente: pedido.id_cliente,
            cliente_nombre: pedido.cliente_nombre,
            ...(nombreDeVendedor && { vendedor_nombre: nombreDeVendedor(pedido.id_vendedor) }),
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            subtotal: l.subtotal,
        });
        porProducto.set(clave, actual);
    }));

    const productos = [...porProducto.entries()].map(([clave, p]) => {
        const fila = {
            ...p,
            cantidad: redondear(p.cantidad),
            monto: redondear(p.monto),
            pedidos: p.pedidos.size,
            clientes: p.clientes.size,
        };
        if (estado === 'pendiente') {
            const producto = productoDeLinea(catalogo, p);
            fila.stock = producto ? aMonto(producto.stock) : null; // null: ya no está en el catálogo
            fila.comprometido = redondear(comprometido.get(clave) ?? p.cantidad);
            fila.falta = fila.stock === null ? fila.comprometido : redondear(Math.max(0, fila.comprometido - fila.stock));
        }
        return fila;
    }).sort((a, b) => b.cantidad - a.cantidad || b.monto - a.monto);

    const clientesUnicos = new Set(delFiltro.map((p) => aTexto(p.id_cliente).toUpperCase()));
    return {
        estado,
        desde,
        hasta,
        resumen: {
            pedidos: delFiltro.length,
            monto: sumar(delFiltro, 'monto_total'),
            unidades: redondear(productos.reduce((suma, p) => suma + p.cantidad, 0)),
            productos: productos.length,
            clientes: clientesUnicos.size,
            ...(estado === 'pendiente' && { sin_stock: productos.filter((p) => p.falta > 0).length }),
        },
        productos,
    };
};

// Pagos de un grupo de clientes (la hoja Pagos no guarda el vendedor: sale del cliente)
const pagosDeClientes = (pagos, clientes) => pagos.filter((p) => clientes.some((c) => mismoId(c.id_cliente, p.id_cliente)));

module.exports = { AGRUPACIONES, leerPeriodo, armarConsulta, leerFiltrosPedidos, armarConsultaPedidos, pagosDeClientes };
