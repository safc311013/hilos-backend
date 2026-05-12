const express = require('express');
const Venta = require('../models/Venta');
const Producto = require('../models/Producto');
const { proteger } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');

const router = express.Router();

const permitirAdminOSupervisor = (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ mensaje: 'No autorizado' });
  }

  if (!['admin', 'supervisor'].includes(req.usuario.rol)) {
    return res.status(403).json({ mensaje: 'No tienes permisos para esta acción' });
  }

  next();
};

const permitirAdminSupervisorOCajero = (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ mensaje: 'No autorizado' });
  }

  if (!['admin', 'supervisor', 'cajero'].includes(req.usuario.rol)) {
    return res.status(403).json({ mensaje: 'No tienes permisos para esta acción' });
  }

  next();
};

const generarFolio = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `V-${y}${m}${d}-${h}${min}${s}`;
};

const limpiarTexto = (valor) => String(valor || '').trim();
const INVENTARIOS = ['taxco', 'tienda'];
const normalizarInventario = (valor) => {
  const inventario = String(valor || '').trim().toLowerCase();
  return INVENTARIOS.includes(inventario) ? inventario : 'tienda';
};

const obtenerStockInventario = (producto, inventario) => {
  if (inventario === 'taxco') {
    return Number(producto.stockTaxco ?? 0);
  }

  const stockTienda = Number(producto.stockTienda ?? 0);
  if (stockTienda > 0 || Number(producto.stockTaxco ?? 0) > 0) {
    return stockTienda;
  }

  return Number(producto.stock ?? 0);
};

const obtenerCampoStockInventario = (inventario) =>
  inventario === 'taxco' ? 'stockTaxco' : 'stockTienda';

router.get('/', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const ventas = await Venta.find()
      .populate('usuario', 'nombre email rol')
      .sort({ createdAt: -1 });

    res.json(ventas);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener ventas', error: error.message });
  }
});

router.post('/', proteger, permitirAdminSupervisorOCajero, async (req, res) => {
  try {
    const {
      productos,
      metodoPago,
      origenCotizacion = false,
      cotizacion = null,
    } = req.body;

    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ mensaje: 'Debes enviar productos para registrar la venta' });
    }

    let subtotalGeneral = 0;
    let descuentoTotal = 0;
    let total = 0;
    const detalleVenta = [];

    for (const item of productos) {
      const producto = await Producto.findById(item.producto);

      if (!producto) {
        return res.status(404).json({ mensaje: `Producto no encontrado: ${item.producto}` });
      }

      const cantidad = Number(item.cantidad);
      const descuentoPorcentaje = Number(item.descuentoPorcentaje || 0);
      const inventarioOrigen = normalizarInventario(
        item.inventarioOrigen || item.inventario
      );

      if (
        Number(producto.stock || 0) > 0 &&
        Number(producto.stockTaxco || 0) === 0 &&
        Number(producto.stockTienda || 0) === 0
      ) {
        if (inventarioOrigen === 'taxco') {
          producto.stockTaxco = Number(producto.stock || 0);
        } else {
          producto.stockTienda = Number(producto.stock || 0);
        }
        producto.inventario = inventarioOrigen;
        await producto.save();
      }

      const stockDisponible = obtenerStockInventario(producto, inventarioOrigen);

      if (!cantidad || cantidad < 1) {
        return res.status(400).json({
          mensaje: `Cantidad inválida para ${producto.nombre}`,
        });
      }

      if (descuentoPorcentaje < 0 || descuentoPorcentaje > 100) {
        return res.status(400).json({
          mensaje: `Descuento inválido para ${producto.nombre}`,
        });
      }

      if (stockDisponible < cantidad) {
        return res.status(400).json({
          mensaje: `Stock insuficiente en inventario de ${
            inventarioOrigen === 'taxco' ? 'Taxco' : 'Tienda'
          } para ${producto.nombre}. Disponible: ${stockDisponible}`,
        });
      }

      const precioUnitarioRecibido = Number(item.precioUnitario);
      const precioUnitario = Number.isFinite(precioUnitarioRecibido) && precioUnitarioRecibido >= 0
        ? precioUnitarioRecibido
        : Number(producto.precio || 0);

      const codigoProducto = limpiarTexto(item.codigoProducto || producto.codigo);
      const nombreProducto = limpiarTexto(item.nombreProducto || producto.nombre);
      const categoriaProducto = limpiarTexto(item.categoriaProducto || producto.categoria);
      const pieza = limpiarTexto(item.pieza);

      const subtotalBruto = precioUnitario * cantidad;
      const descuentoMonto = subtotalBruto * (descuentoPorcentaje / 100);
      const subtotalFinal = subtotalBruto - descuentoMonto;

      subtotalGeneral += subtotalBruto;
      descuentoTotal += descuentoMonto;
      total += subtotalFinal;

      detalleVenta.push({
        producto: producto._id,
        codigoProducto,
        nombreProducto,
        categoriaProducto,
        inventarioOrigen,
        pieza,
        cantidad,
        precioUnitario,
        descuentoPorcentaje,
        descuentoMonto,
        subtotalBruto,
        subtotalFinal,
      });
    }

    for (const item of productos) {
      const inventarioOrigen = normalizarInventario(
        item.inventarioOrigen || item.inventario
      );
      const campoStock = obtenerCampoStockInventario(inventarioOrigen);
      await Producto.findByIdAndUpdate(item.producto, {
        $inc: {
          [campoStock]: -Number(item.cantidad),
          stock: -Number(item.cantidad),
        },
      });
    }

    const ventaPayload = {
      folio: generarFolio(),
      productos: detalleVenta,
      subtotal: subtotalGeneral,
      descuentoTotal,
      total,
      metodoPago: metodoPago || 'efectivo',
      origenCotizacion: Boolean(origenCotizacion),
      usuario: req.usuario._id,
    };

    if (origenCotizacion && cotizacion) {
      ventaPayload.cotizacion = {
        cliente: limpiarTexto(cotizacion.cliente),
        fechaCotizacion: limpiarTexto(cotizacion.fechaCotizacion),
        vigencia: limpiarTexto(cotizacion.vigencia),
        notas: limpiarTexto(cotizacion.notas),
        totalCotizacion: Number(cotizacion.totalCotizacion || 0),
      };
    }

    const venta = await Venta.create(ventaPayload);

    const ventaCompleta = await Venta.findById(venta._id).populate(
      'usuario',
      'nombre email rol'
    );

    sendEvent('ventas', { accion: 'crear', venta: ventaCompleta });
    sendEvent('productos', { accion: 'stock_actualizado' });

    res.status(201).json(ventaCompleta);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al registrar venta', error: error.message });
  }
});

module.exports = router;
