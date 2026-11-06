const { Router } = require('express');
const { verificarTokenVendedor, verificarAdministrador } = require('../middlewares/authVendedoresMiddleware');
const {
    obtenerResumenAdmin,
    listarVentasAdmin,
    listarDeudasAdmin,
    listarPagosAdmin,
    obtenerComprobanteAdmin,
    verificarPago,
} = require('../controllers/adminController');
const {
    listarComisionesAdmin,
    cerrarComisiones,
    marcarComisionPagada,
    reabrirComision,
    listarMetas,
    guardarMeta,
} = require('../controllers/comisionesController');
const { consultarVentasAdmin } = require('../controllers/consultasController');
const { listarClientesAdmin, obtenerHistorialAdmin } = require('../controllers/clientesController');
const { listarPedidosAdmin, entregarPedido } = require('../controllers/pedidosController');

// Consultas del administrador sobre todos los vendedores (nivel_acceso Administrador en la hoja Usuarios)
const router = Router();
const soloAdministrador = [verificarTokenVendedor, verificarAdministrador];

// GET /bill/api/vendedores/admin/resumen
router.get('/resumen', soloAdministrador, obtenerResumenAdmin);

// GET /bill/api/vendedores/admin/ventas?id_vendedor=&tipo_pago=&desde=&hasta=
router.get('/ventas', soloAdministrador, listarVentasAdmin);

// GET /bill/api/vendedores/admin/clientes?id_vendedor=
router.get('/clientes', soloAdministrador, listarClientesAdmin);

// GET /bill/api/vendedores/admin/clientes/:id/historial
router.get('/clientes/:id/historial', soloAdministrador, obtenerHistorialAdmin);

// GET /bill/api/vendedores/admin/pedidos?estado=pendiente|entregado|anulado&id_vendedor=
router.get('/pedidos', soloAdministrador, listarPedidosAdmin);

// POST /bill/api/vendedores/admin/pedidos/:id/entrega  (emite la factura: crea la venta, su número y su deuda)
// JSON: { fecha_entrega?, nota_entrega?, productos?: [{ id_detalle, cantidad }] (sin productos = todo lo pedido) }
router.post('/pedidos/:id/entrega', soloAdministrador, entregarPedido);

// GET /bill/api/vendedores/admin/deudas?id_vendedor=&estado=
router.get('/deudas', soloAdministrador, listarDeudasAdmin);

// GET /bill/api/vendedores/admin/pagos?estado=pendiente|verificado|rechazado&id_vendedor=
router.get('/pagos', soloAdministrador, listarPagosAdmin);

// GET /bill/api/vendedores/admin/pagos/:id/comprobante  (foto o PDF del pago)
router.get('/pagos/:id/comprobante', soloAdministrador, obtenerComprobanteAdmin);

// PATCH /bill/api/vendedores/admin/pagos/:id/verificacion  (JSON: { estado: 'verificado' })
router.patch('/pagos/:id/verificacion', soloAdministrador, verificarPago);

// GET /bill/api/vendedores/admin/comisiones?periodo=YYYY-MM  (liquidación del mes de todos los vendedores)
router.get('/comisiones', soloAdministrador, listarComisionesAdmin);

// POST /bill/api/vendedores/admin/comisiones/:periodo/cerrar  (JSON opcional: { id_vendedor })
router.post('/comisiones/:periodo/cerrar', soloAdministrador, cerrarComisiones);

// PATCH /bill/api/vendedores/admin/comisiones/:id/pagada  (JSON opcional: { fecha_pago })
router.patch('/comisiones/:id/pagada', soloAdministrador, marcarComisionPagada);

// DELETE /bill/api/vendedores/admin/comisiones/:id  (reabre el mes de ese vendedor)
router.delete('/comisiones/:id', soloAdministrador, reabrirComision);

// GET /bill/api/vendedores/admin/metas?periodo=YYYY-MM
router.get('/metas', soloAdministrador, listarMetas);

// PUT /bill/api/vendedores/admin/metas  (JSON: { id_vendedor, periodo, meta_monto, sueldo_base, observaciones? })
router.put('/metas', soloAdministrador, guardarMeta);

// GET /bill/api/vendedores/admin/consultas/ventas?desde=&hasta=&agrupar=dia|semana|mes&id_vendedor=
router.get('/consultas/ventas', soloAdministrador, consultarVentasAdmin);

module.exports = router;
