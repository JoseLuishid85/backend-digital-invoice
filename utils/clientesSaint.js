const {
    HOJAS, leerHojas, leerHojasDe, agregarColumnas, agregarFilas, actualizarFilas, siguientesIds, errorConStatus,
} = require('../services/googleSheetsService');
const { aTexto, mismoId } = require('./cartera');

// Copia los clientes de Saint (pestaña SAINT_HOJA_CLIENTES, por defecto "Clientes" = IMPORTRANGE de SACLIE) a la
// pestaña Clientes de la app. Saint manda en sus datos; la app guarda los suyos (id_cliente CLI-001, deudas, etc.).
// - Enlace: Clientes.cod_cliente = CodClie. Los clientes de la app sin cod_cliente no se tocan.
// - Vendedor: CodVend → Usuarios.cod_vendedor. Los clientes de un CodVend sin usuario en la app no se copian.
// - Nuevos: se agregan con fecha_registro = FechaE de Saint (su fecha de alta real, que cuenta para el bono de
//   clientes nuevos) y limite_credito vacío (el de Saint está en Bs).
// - Existentes: se actualizan solo los campos de Saint que cambiaron (nombre, contacto, teléfono, dirección, RIF,
//   email, estado y vendedor). Nunca borra filas.

const COLUMNAS_SAINT = ['cod_cliente', 'rif', 'email'];

const hojaClientes = () => process.env.SAINT_HOJA_CLIENTES || 'Clientes';

const unir = (...partes) => partes.map(aTexto).filter(Boolean).join(', ');
const fechaDe = (valor) => aTexto(valor).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';

// Campos de la app que vienen de una fila de SACLIE (sin id_cliente ni fecha_registro)
const camposDeSaint = (c, idVendedor) => ({
    cod_cliente: aTexto(c.CodClie).toUpperCase(),
    id_vendedor: idVendedor,
    nombre_comercial: aTexto(c.Descrip),
    contacto_nombre: aTexto(c.Represent),
    telefono: aTexto(c.Movil) || aTexto(c.Telef),
    direccion: unir(c.Direc1, c.Direc2),
    rif: aTexto(c.ID3),
    email: aTexto(c.Email).toLowerCase(),
    estado: String(c.Activo) === '1' ? 'activo' : 'inactivo',
});

// opciones.codVendedor: solo los clientes de ese CodVend. opciones.simular: calcula sin escribir.
// Devuelve { nuevos, actualizados, sin_cambios, sin_usuario: [{ cod_vendedor, clientes }], por_vendedor }
const sincronizarClientesSaint = async ({ codVendedor = '', simular = false } = {}) => {
    if (!process.env.SAINT_SHEETS_ID) throw errorConStatus('Falta SAINT_SHEETS_ID en el .env del backend.', 503);

    if (!simular) {
        for (const columna of COLUMNAS_SAINT) await agregarColumnas(HOJAS.clientes, [columna]);
    }
    const hoja = hojaClientes();
    const [saint, app] = await Promise.all([
        leerHojasDe(process.env.SAINT_SHEETS_ID, [hoja]),
        leerHojas(HOJAS.usuarios, HOJAS.clientes),
    ]);
    const usuarios = app[HOJAS.usuarios].filas;
    const { encabezados, filas: clientesApp } = app[HOJAS.clientes];

    const resultado = { nuevos: [], actualizados: [], sin_cambios: 0, sin_usuario: new Map(), por_vendedor: {} };
    const nuevos = [];
    const cambios = [];

    for (const c of saint[hoja].filas) {
        const codCliente = aTexto(c.CodClie);
        const codVend = aTexto(c.CodVend).toUpperCase();
        if (!codCliente) continue;
        if (codVendedor && codVend !== codVendedor.toUpperCase()) continue;

        const usuario = usuarios.find((u) => aTexto(u.cod_vendedor) && mismoId(u.cod_vendedor, codVend));
        if (!usuario) {
            const clave = codVend || '(sin vendedor)';
            resultado.sin_usuario.set(clave, (resultado.sin_usuario.get(clave) ?? 0) + 1);
            continue;
        }
        const idVendedor = aTexto(usuario.id_usuario);
        resultado.por_vendedor[idVendedor] = (resultado.por_vendedor[idVendedor] ?? 0) + 1;

        const datos = camposDeSaint(c, idVendedor);
        const existente = clientesApp.find((a) => mismoId(a.cod_cliente, codCliente));
        if (!existente) {
            nuevos.push({ ...datos, limite_credito: '', fecha_registro: fechaDe(c.FechaE) });
            continue;
        }
        const distintos = Object.fromEntries(Object.entries(datos).filter(([k, v]) => aTexto(existente[k]) !== v));
        if (Object.keys(distintos).length) {
            cambios.push({ fila: existente._fila, cambios: distintos });
            resultado.actualizados.push({ id_cliente: aTexto(existente.id_cliente), nombre: datos.nombre_comercial, campos: Object.keys(distintos) });
        } else {
            resultado.sin_cambios += 1;
        }
    }

    const ids = siguientesIds(clientesApp, 'id_cliente', 'CLI', nuevos.length);
    const filasNuevas = nuevos.map((n, i) => ({ id_cliente: ids[i], ...n }));
    resultado.nuevos = filasNuevas.map((n) => ({ id_cliente: n.id_cliente, cod_cliente: n.cod_cliente, nombre: n.nombre_comercial, id_vendedor: n.id_vendedor }));

    if (!simular) {
        const columnas = [...encabezados, ...COLUMNAS_SAINT.filter((c) => !encabezados.includes(c))];
        await agregarFilas(HOJAS.clientes, filasNuevas, columnas);
        await actualizarFilas(HOJAS.clientes, cambios, columnas);
    }
    resultado.sin_usuario = [...resultado.sin_usuario].map(([cod, clientes]) => ({ cod_vendedor: cod, clientes }));
    return resultado;
};

module.exports = { sincronizarClientesSaint };
