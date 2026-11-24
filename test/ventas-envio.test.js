const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const mongoose = require('mongoose');
const Venta = require('../models/Venta');
const Producto = require('../models/Producto');
const router = require('../routes/ventas');

const rutaVenta = router.stack.find((layer) => layer.route?.methods.post).route;
const registrarVenta = rutaVenta.stack.at(-1).handle;
const autorizarVenta = rutaVenta.stack[1].handle;
const productoId = new mongoose.Types.ObjectId();
const usuarioId = new mongoose.Types.ObjectId();

const crearRespuesta = () => ({
  statusCode: 200,
  status(codigo) {
    this.statusCode = codigo;
    return this;
  },
  json(datos) {
    this.body = datos;
    return this;
  },
});

const crearSolicitud = (datos = {}) => ({
  usuario: { _id: usuarioId, rol: 'cajero' },
  body: {
    productos: [{ producto: productoId, cantidad: 2, descuentoPorcentaje: 25 }],
    metodoPago: 'efectivo',
    ...datos,
  },
});

test('el envío se permite a administradores, supervisores y cajeros', () => {
  for (const rol of ['admin', 'supervisor', 'cajero']) {
    let autorizado = false;
    autorizarVenta(
      { usuario: { rol } },
      crearRespuesta(),
      () => { autorizado = true; }
    );
    assert.equal(autorizado, true, rol);
  }
});

test('montos inválidos se rechazan antes de consultar o modificar inventario', async (t) => {
  t.after(() => mock.restoreAll());
  const consultaProducto = mock.method(Producto, 'findById', async () => {
    throw new Error('No debe consultar productos');
  });
  const actualizarStock = mock.method(Producto, 'findByIdAndUpdate', async () => {
    throw new Error('No debe modificar stock');
  });
  const guardarVenta = mock.method(Venta, 'create', async () => {
    throw new Error('No debe crear ventas');
  });

  for (const costoEnvio of [-1, 0.001, Infinity, NaN, '', ' ', 'abc', '1.234', '1e2', null, true, [], {}, Number.MAX_VALUE]) {
    const res = crearRespuesta();
    await registrarVenta(crearSolicitud({ costoEnvio }), res);
    assert.equal(res.statusCode, 400, String(costoEnvio));
    assert.match(res.body.mensaje, /monto de envío/);
  }

  assert.equal(consultaProducto.mock.callCount(), 0);
  assert.equal(actualizarStock.mock.callCount(), 0);
  assert.equal(guardarVenta.mock.callCount(), 0);
});

test('la venta guarda el envío, lo suma sin descuento y solo descuenta productos del stock', async (t) => {
  t.after(() => mock.restoreAll());
  const producto = {
    _id: productoId,
    codigo: 'PRUEBA',
    nombre: 'Producto de prueba',
    precio: 100,
    stock: 20,
    stockTienda: 20,
    stockTaxco: 0,
  };
  let ventaGuardada;
  mock.method(Producto, 'findById', async () => producto);
  const actualizarStock = mock.method(Producto, 'findByIdAndUpdate', async () => null);
  mock.method(Venta, 'create', async (datos) => {
    ventaGuardada = new Venta(datos);
    await ventaGuardada.validate();
    return ventaGuardada;
  });
  mock.method(Venta, 'findById', () => ({ populate: async () => ventaGuardada }));

  for (const costoEnvio of [undefined, 0, 29.5, '29.50', 0.01]) {
    const res = crearRespuesta();
    await registrarVenta(crearSolicitud({ costoEnvio }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.costoEnvio, Number(costoEnvio || 0));
    assert.equal(res.body.subtotal, 200);
    assert.equal(res.body.descuentoTotal, 50);
    assert.equal(res.body.total, 150 + Number(costoEnvio || 0));
    assert.equal(res.body.productos.length, 1);
    assert.equal(res.body.productos[0].subtotalFinal, 150);
    assert.deepEqual(actualizarStock.mock.calls.at(-1).arguments[1], {
      $inc: { stockTienda: -2, stock: -2 },
    });
  }

  const res = crearRespuesta();
  await registrarVenta(crearSolicitud({
    costoEnvio: 75,
    productos: [{ producto: productoId, cantidad: 2, descuentoPorcentaje: 100 }],
  }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.total, 75);
  assert.equal(res.body.descuentoTotal, 200);
});

test('el modelo conserva compatibilidad con ventas sin envío y valida el importe', () => {
  assert.equal(new Venta().costoEnvio, 0);
  for (const costoEnvio of [-1, Infinity, 0.001]) {
    const venta = new Venta({ costoEnvio });
    assert.ok(venta.validateSync()?.errors.costoEnvio, String(costoEnvio));
  }
});
