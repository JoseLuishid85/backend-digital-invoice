const { google } = require('googleapis');

// Pestañas del documento de cartera (vendedores, clientes, deudas y pagos)
const HOJAS = {
    vendedores: 'Vendedores',
    clientes: 'Clientes',
    deudas: 'Deudas',
    pagos: 'Pagos',
    ventas: 'Ventas',
    ventasDetalle: 'Ventas_Detalle',
    productos: 'Productos',
    tasas: 'Tasas_Dolar',
    logs: 'Historial_Logs',
};

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let clienteSheets = null;

// Error con status HTTP para que el manejador global responda { ok: false, mensaje }
const errorConStatus = (mensaje, status) => Object.assign(new Error(mensaje), { status });

// Autenticación con cuenta de servicio (la hoja debe estar compartida con su email como Editor).
// Se crea al primer uso para que el resto del backend arranque aunque Sheets no esté configurado.
const obtenerCliente = () => {
    if (clienteSheets) return clienteSheets;

    const { GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
    if (!GOOGLE_SHEETS_ID) {
        throw errorConStatus('Google Sheets no está configurado (falta GOOGLE_SHEETS_ID).', 503);
    }
    if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
        throw errorConStatus(
            'Google Sheets no está configurado (faltan GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_PRIVATE_KEY).',
            503,
        );
    }

    const auth = new google.auth.JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        // En .env la clave viene en una sola línea con "\n" literales
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: SCOPES,
    });

    clienteSheets = google.sheets({ version: 'v4', auth });
    return clienteSheets;
};

const rangoHoja = (hoja, rango = '') => `'${hoja}'${rango ? `!${rango}` : ''}`;

// Índice de columna (0 = A) a letra(s) de columna
const letraColumna = (indice) => {
    let letra = '';
    for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        letra = String.fromCharCode(65 + ((n - 1) % 26)) + letra;
    }
    return letra;
};

// Convierte las filas crudas en objetos por encabezado. _fila es el número de fila en la hoja.
const mapearFilas = (valores = []) => {
    const [encabezados = [], ...resto] = valores;
    const claves = encabezados.map((e) => String(e).trim());

    const filas = [];
    resto.forEach((fila, i) => {
        if (!fila.some((celda) => celda !== '' && celda !== null)) return; // fila vacía
        const objeto = { _fila: i + 2 };
        claves.forEach((clave, j) => {
            if (clave) objeto[clave] = fila[j] ?? '';
        });
        filas.push(objeto);
    });

    return { encabezados: claves, filas };
};

const OPCIONES_LECTURA = {
    valueRenderOption: 'UNFORMATTED_VALUE', // números como números
    dateTimeRenderOption: 'FORMATTED_STRING', // fechas como texto
};

// Lee varias pestañas en una sola llamada. Devuelve { [hoja]: { encabezados, filas } }
const leerHojas = async (...hojas) => {
    const sheets = obtenerCliente();
    let data;
    try {
        ({ data } = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            ranges: hojas.map((hoja) => rangoHoja(hoja)),
            ...OPCIONES_LECTURA,
        }));
    } catch (error) {
        // Sheets responde "Unable to parse range: 'Ventas'" cuando la pestaña no existe
        const rango = String(error.message).match(/Unable to parse range: '?([^'!]+)/);
        if (rango) {
            throw errorConStatus(`Falta la pestaña "${rango[1]}" en la hoja de cálculo. Créala con sus encabezados.`, 500);
        }
        throw error;
    }

    const resultado = {};
    hojas.forEach((hoja, i) => {
        resultado[hoja] = mapearFilas(data.valueRanges?.[i]?.values);
    });
    return resultado;
};

const leerHoja = async (hoja) => (await leerHojas(hoja))[hoja];

// Agrega una fila al final de la hoja respetando el orden de sus encabezados
const agregarFila = async (hoja, objeto, encabezados) => {
    const sheets = obtenerCliente();
    const columnas = encabezados || (await leerHoja(hoja)).encabezados;
    if (!columnas.length) {
        throw errorConStatus(`La hoja "${hoja}" no tiene encabezados.`, 500);
    }

    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        range: rangoHoja(hoja, 'A1'),
        valueInputOption: 'RAW', // evita que Sheets convierta IDs o teléfonos (p. ej. "0414...")
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [columnas.map((col) => objeto[col] ?? '')] },
    });

    return objeto;
};

// Número de la primera fila escrita según el rango que devuelve append ('Ventas'!A5:L6 → 5)
const filaInicial = (rango = '') => Number(String(rango).match(/!\D+(\d+)/)?.[1]) || null;

// Agrega varias filas en una sola llamada. Devuelve los objetos con su _fila (para poder deshacer).
const agregarFilas = async (hoja, objetos, encabezados) => {
    if (!objetos.length) return [];
    const sheets = obtenerCliente();
    const columnas = encabezados || (await leerHoja(hoja)).encabezados;
    if (!columnas.length) {
        throw errorConStatus(`La hoja "${hoja}" no tiene encabezados.`, 500);
    }

    const { data } = await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        range: rangoHoja(hoja, 'A1'),
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: objetos.map((objeto) => columnas.map((col) => objeto[col] ?? '')) },
    });

    const primera = filaInicial(data.updates?.updatedRange);
    return objetos.map((objeto, i) => ({ ...objeto, _fila: primera ? primera + i : null }));
};

// Vacía filas completas (se usa para deshacer escrituras parciales; las filas vacías se ignoran al leer)
const limpiarFilas = async (hoja, numerosFila) => {
    const filas = numerosFila.filter(Boolean);
    if (!filas.length) return;
    await obtenerCliente().spreadsheets.values.batchClear({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        requestBody: { ranges: filas.map((n) => rangoHoja(hoja, `${n}:${n}`)) },
    });
};

// ID numérico (gid) de cada pestaña, necesario para borrar filas. No cambia mientras el servidor corre.
const idsPestanas = {};
const idPestana = async (hoja) => {
    if (idsPestanas[hoja] !== undefined) return idsPestanas[hoja];
    const { data } = await obtenerCliente().spreadsheets.get({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        fields: 'sheets.properties(sheetId,title)',
    });
    data.sheets.forEach(({ properties }) => {
        idsPestanas[properties.title] = properties.sheetId;
    });
    if (idsPestanas[hoja] === undefined) {
        throw errorConStatus(`Falta la pestaña "${hoja}" en la hoja de cálculo. Créala con sus encabezados.`, 500);
    }
    return idsPestanas[hoja];
};

// Borra una fila completa (las de abajo suben una posición: usar dentro de conBloqueo)
const eliminarFila = async (hoja, numeroFila) => {
    const sheetId = await idPestana(hoja);
    await obtenerCliente().spreadsheets.batchUpdate({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        requestBody: {
            requests: [{
                deleteDimension: {
                    range: { sheetId, dimension: 'ROWS', startIndex: numeroFila - 1, endIndex: numeroFila },
                },
            }],
        },
    });
};

// Actualiza solo las celdas indicadas en `cambios` de una fila (no toca fórmulas ni formatos del resto)
const actualizarFila = async (hoja, numeroFila, cambios, encabezados) => {
    const sheets = obtenerCliente();
    const columnas = encabezados || (await leerHoja(hoja)).encabezados;

    const data = Object.entries(cambios).map(([clave, valor]) => {
        const indice = columnas.indexOf(clave);
        if (indice === -1) {
            throw errorConStatus(`La hoja "${hoja}" no tiene la columna "${clave}".`, 500);
        }
        return { range: rangoHoja(hoja, `${letraColumna(indice)}${numeroFila}`), values: [[valor]] };
    });

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        requestBody: { valueInputOption: 'RAW', data },
    });
};

// Actualiza la primera fila que cumpla el criterio. Devuelve la fila actualizada o null.
const actualizarFilaDonde = async (hoja, criterio, cambios) => {
    const { encabezados, filas } = await leerHoja(hoja);
    const fila = filas.find(criterio);
    if (!fila) return null;

    await actualizarFila(hoja, fila._fila, cambios, encabezados);
    return { ...fila, ...cambios };
};

// Atajos con nombres genéricos para los controladores

// Filas de una pestaña como arreglo de objetos según los encabezados (cada uno con _fila)
const readSheet = async (sheetName) => (await leerHoja(sheetName)).filas;

// Inserta una fila al final. Acepta un arreglo (valores en el orden de las columnas) o un objeto por encabezado.
const appendRow = async (sheetName, rowData) => {
    if (!Array.isArray(rowData)) return agregarFila(sheetName, rowData);

    await obtenerCliente().spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        range: rangoHoja(sheetName, 'A1'),
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowData] },
    });
    return rowData;
};

// Actualiza las celdas indicadas de una fila por su número (el _fila que devuelve readSheet)
const updateRow = (sheetName, rowNumber, changes) => actualizarFila(sheetName, rowNumber, changes);

// Actualiza la primera fila que cumpla el criterio; devuelve la fila actualizada o null
const updateRowWhere = (sheetName, criteria, changes) => actualizarFilaDonde(sheetName, criteria, changes);

// Siguiente ID con prefijo y 3 dígitos mínimo: CLI-001, CLI-002...
const siguienteId = (filas, campo, prefijo) => {
    const patron = new RegExp(`^${prefijo}-(\\d+)$`);
    const maximo = filas.reduce((max, fila) => {
        const coincidencia = String(fila[campo] ?? '').match(patron);
        return coincidencia ? Math.max(max, Number(coincidencia[1])) : max;
    }, 0);
    return `${prefijo}-${String(maximo + 1).padStart(3, '0')}`;
};

// Varios IDs seguidos (para escribir varias filas de una vez): PAG-004, PAG-005...
const siguientesIds = (filas, campo, prefijo, cantidad) => {
    const primero = Number(siguienteId(filas, campo, prefijo).split('-').pop());
    return Array.from({ length: cantidad }, (_, i) => `${prefijo}-${String(primero + i).padStart(3, '0')}`);
};

// Sheets no tiene transacciones: las escrituras de este proceso se encolan una tras otra
// para que dos peticiones simultáneas no generen el mismo ID ni pisen montos de una deuda.
let cola = Promise.resolve();
const conBloqueo = (tarea) => {
    const resultado = cola.then(tarea, tarea);
    cola = resultado.catch(() => {});
    return resultado;
};

module.exports = {
    HOJAS,
    errorConStatus,
    leerHojas,
    leerHoja,
    agregarFila,
    agregarFilas,
    limpiarFilas,
    eliminarFila,
    actualizarFila,
    actualizarFilaDonde,
    siguienteId,
    siguientesIds,
    conBloqueo,
    readSheet,
    appendRow,
    updateRow,
    updateRowWhere,
};
