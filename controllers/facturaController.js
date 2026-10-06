const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { sequelize, Factura, DetalleFactura, TasaDia } = require('../models');
const { aNumero, aNumeroOpcional, aFecha, fechaHoy } = require('../utils/valores');
const { ai, GEMINI_MODEL, facturaSchema, PROMPT } = require('../config/gemini');

const MONEDAS = ['VES', 'USD'];

const redondear = (n) => Math.round(n * 100) / 100;

// Carpeta donde se guardan las imágenes de las facturas
const CARPETA_IMAGENES = path.join(__dirname, '..', 'uploads', 'facturas');

const EXTENSIONES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
};

const guardarImagen = async (archivo) => {
    await fs.mkdir(CARPETA_IMAGENES, { recursive: true });
    const nombre = `${crypto.randomUUID()}${EXTENSIONES[archivo.mimetype] || ''}`;
    await fs.writeFile(path.join(CARPETA_IMAGENES, nombre), archivo.buffer);
    return nombre;
};

const procesarFactura = async (req, res) => {
    // a. Validar que llegó la imagen en el campo 'imagen'
    if (!req.file) {
        return res.status(400).json({ ok: false, mensaje: "Debes enviar una imagen en el campo 'imagen'." });
    }

    // Moneda en la que vienen los precios de la factura (por defecto bolívares)
    const moneda = req.body?.moneda || 'VES';
    if (!MONEDAS.includes(moneda)) {
        return res.status(400).json({ ok: false, mensaje: 'Moneda inválida. Usa VES (bolívares) o USD (dólares).' });
    }

    // b. Convertir el buffer a Base64
    const imagenBase64 = req.file.buffer.toString('base64');

    // c. Enviar prompt + imagen a Gemini
    let datos;
    try {
        const respuesta = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: [
                { inlineData: { mimeType: req.file.mimetype, data: imagenBase64 } },
                { text: PROMPT },
            ],
            config: {
                responseMimeType: 'application/json',
                responseSchema: facturaSchema,
            },
        });

        // d. Parsear el JSON resultante
        datos = JSON.parse(respuesta.text);
    } catch (error) {
        console.error('Error al procesar con Gemini:', error);
        return res.status(502).json({ ok: false, mensaje: 'No se pudo extraer la información de la imagen.' });
    }

    if (!datos.nombre_empresa) {
        return res.status(422).json({ ok: false, mensaje: 'La imagen no parece ser una factura o ticket válido.' });
    }

    const fechaFactura = aFecha(datos.fecha);

    // e. Guardar la imagen en disco
    let nombreImagen;
    try {
        nombreImagen = await guardarImagen(req.file);
    } catch (error) {
        console.error('Error al guardar la imagen:', error);
        return res.status(500).json({ ok: false, mensaje: 'Error al guardar la imagen de la factura.' });
    }

    // f. Guardar factura + detalles en una sola transacción
    try {
        const factura = await sequelize.transaction(async (t) => {
            // Tasa: la escrita por el usuario, luego la impresa en la factura y por último la registrada ese día
            const fechaTasa = fechaFactura || fechaHoy();
            let tasaDia = aNumeroOpcional(req.body?.tasa_dia) ?? aNumeroOpcional(datos.tasa_dia);
            if (tasaDia) {
                // Si ese día aún no tiene tasa registrada, la registramos (un solo registro por día)
                await TasaDia.findOrCreate({
                    where: { fecha: fechaTasa },
                    defaults: { tasa: tasaDia },
                    transaction: t,
                });
            } else {
                const registro = await TasaDia.findOne({ where: { fecha: fechaTasa }, transaction: t });
                tasaDia = registro ? Number(registro.tasa) : null;
            }

            const nuevaFactura = await Factura.create({
                nombre_empresa: datos.nombre_empresa,
                numero_factura: datos.numero_factura || null,
                fecha: fechaFactura,
                total: aNumero(datos.total),
                moneda,
                tasa_dia: tasaDia,
                imagen: nombreImagen,
            }, { transaction: t });

            const detalles = (datos.productos || []).map((p) => {
                const precioUnitario = aNumero(p.precio_unitario);
                let precioUsd;
                if (moneda === 'USD') {
                    precioUsd = precioUnitario;
                } else if (tasaDia && precioUnitario) {
                    // Factura en bolívares: precio_dolar = precio_unitario_bs / tasa_dia
                    precioUsd = redondear(precioUnitario / tasaDia);
                } else {
                    // Sin tasa: solo el precio en $ que traiga impreso la factura, si lo hay
                    precioUsd = aNumeroOpcional(p.precio_unitario_usd);
                }

                return {
                    factura_id: nuevaFactura.id,
                    cantidad: aNumero(p.cantidad) || 1,
                    descripcion: p.descripcion || 'Sin descripción',
                    precio_unitario: precioUnitario,
                    importe: aNumero(p.importe),
                    precio_unitario_usd: precioUsd,
                };
            });

            if (detalles.length > 0) {
                await DetalleFactura.bulkCreate(detalles, { transaction: t });
            }

            return nuevaFactura;
        });

        // g. Responder con la factura guardada y sus detalles
        const facturaGuardada = await Factura.findByPk(factura.id, {
            include: [{ model: DetalleFactura, as: 'detalles' }],
        });

        return res.status(201).json({
            ok: true,
            mensaje: 'Factura procesada y guardada correctamente.',
            id: factura.id,
            factura: facturaGuardada,
        });
    } catch (error) {
        console.error('Error al guardar la factura:', error);
        // Si la factura no se guardó, la imagen queda huérfana: la borramos
        await fs.unlink(path.join(CARPETA_IMAGENES, nombreImagen)).catch(() => {});
        return res.status(500).json({ ok: false, mensaje: 'Error al guardar la factura en la base de datos.' });
    }
};

const obtenerFactura = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ ok: false, mensaje: 'ID de factura inválido.' });
    }

    try {
        const factura = await Factura.findByPk(id, {
            include: [{ model: DetalleFactura, as: 'detalles' }],
            order: [[{ model: DetalleFactura, as: 'detalles' }, 'id', 'ASC']],
        });

        if (!factura) {
            return res.status(404).json({ ok: false, mensaje: 'Factura no encontrada.' });
        }

        return res.json({ ok: true, factura });
    } catch (error) {
        console.error('Error al obtener la factura:', error);
        return res.status(500).json({ ok: false, mensaje: 'Error al obtener la factura.' });
    }
};

const obtenerImagenFactura = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ ok: false, mensaje: 'ID de factura inválido.' });
    }

    try {
        const factura = await Factura.findByPk(id, { attributes: ['id', 'imagen'] });
        if (!factura) {
            return res.status(404).json({ ok: false, mensaje: 'Factura no encontrada.' });
        }
        if (!factura.imagen) {
            return res.status(404).json({ ok: false, mensaje: 'Esta factura no tiene imagen guardada.' });
        }

        const ruta = path.join(CARPETA_IMAGENES, path.basename(factura.imagen));
        return res.sendFile(ruta, (error) => {
            if (error && !res.headersSent) {
                res.status(404).json({ ok: false, mensaje: 'No se encontró el archivo de la imagen.' });
            }
        });
    } catch (error) {
        console.error('Error al obtener la imagen de la factura:', error);
        return res.status(500).json({ ok: false, mensaje: 'Error al obtener la imagen de la factura.' });
    }
};

module.exports = { procesarFactura, obtenerFactura, obtenerImagenFactura };
