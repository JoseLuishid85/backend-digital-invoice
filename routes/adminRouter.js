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
    listarCuotas,
    guardarCuotas,
    obtenerReglas,
    guardarReglas,
} = require('../controllers/comisionesController');
const { consultarVentasAdmin, consultarPedidosAdmin } = require('../controllers/consultasController');
const { listarVisitasAdmin } = require('../controllers/visitasController');
const { listarClientesAdmin, obtenerHistorialAdmin } = require('../controllers/clientesController');
const { listarPedidosAdmin, entregarPedido } = require('../controllers/pedidosController');
const {
    conTipo, listarRegistros, crearRegistro, actualizarRegistro, eliminarRegistro,
} = require('../controllers/nivelesPlazosController');

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

// PUT /bill/api/vendedores/admin/metas  (sueldo base del mes; JSON: { id_vendedor, periodo, sueldo_base, observaciones? })
router.put('/metas', soloAdministrador, guardarMeta);

// GET /bill/api/vendedores/admin/bonificaciones/reglas  (plazo activo y su %, metas de visitas y de clientes nuevos)
router.get('/bonificaciones/reglas', soloAdministrador, obtenerReglas);

// PUT /bill/api/vendedores/admin/bonificaciones/reglas
// (JSON: { id_plazo, porcentajes: { [id_plazo]: % }, meta_visitas, bono_visitas, meta_clientes_nuevos, bono_clientes_nuevos })
router.put('/bonificaciones/reglas', soloAdministrador, guardarReglas);

// GET /bill/api/vendedores/admin/visitas?periodo=YYYY-MM&id_vendedor=  (visitas de todos los vendedores)
router.get('/visitas', soloAdministrador, listarVisitasAdmin);

// GET /bill/api/vendedores/admin/cuotas  (cuota mensual y valor representativo de cada producto, para la bonificación)
router.get('/cuotas', soloAdministrador, listarCuotas);

// PUT /bill/api/vendedores/admin/cuotas  (JSON: { cuotas: [{ id_producto, cuota_mensual, valor_representativo }] })
router.put('/cuotas', soloAdministrador, guardarCuotas);

// GET /bill/api/vendedores/admin/consultas/ventas?desde=&hasta=&agrupar=dia|semana|mes&id_vendedor=
router.get('/consultas/ventas', soloAdministrador, consultarVentasAdmin);

// GET /bill/api/vendedores/admin/consultas/pedidos?estado=pendiente|entregado|anulado&desde=&hasta=&id_vendedor=
router.get('/consultas/pedidos', soloAdministrador, consultarPedidosAdmin);

// Niveles y plazos del motor de precios (hojas Niveles y Plazos). Cada uno trae usos: { precios, historial }
// GET    /bill/api/vendedores/admin/niveles      POST /admin/niveles  JSON: { id_nivel, nombre, unidades_desde, unidades_hasta?, estado? }
// PUT    /bill/api/vendedores/admin/niveles/:id  (parcial; el código no cambia)
// DELETE /bill/api/vendedores/admin/niveles/:id  (borra también sus precios; 409 si ya lo usan pedidos o ventas)
// Lo mismo en /admin/plazos  JSON: { id_plazo, nombre, dias_desde, dias_hasta?, se_factura?, orden?, estado? }
// (409 al eliminar si ya lo usan pagos o comisiones)
for (const tipo of ['niveles', 'plazos']) {
    const conEste = [...soloAdministrador, conTipo(tipo)];
    router.get(`/${tipo}`, conEste, listarRegistros);
    router.post(`/${tipo}`, conEste, crearRegistro);
    router.put(`/${tipo}/:id`, conEste, actualizarRegistro);
    router.delete(`/${tipo}/:id`, conEste, eliminarRegistro);
}

module.exports = router;
