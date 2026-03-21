const express = require('express');
const mongoose = require('mongoose');
const Cotizacion = require('../models/Cotizacion');
const { proteger } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');

const router = express.Router();

const FORMATOS = {
  VENTA: 'ventas',
  CONSIGNACION: 'consignaciones',
};

const TIPOS = {
  COMPRA: 'COMPRA',
  CONSIGNACION: 'CONSIGNACION',
};

const PREFIJOS_FOLIO = {
  [FORMATOS.VENTA]: 'CM',
  [FORMATOS.CONSIGNACION]: 'CG',
};

const clamp = (valor, min, max) => Math.min(Math.max(valor, min), max);

const aNumero = (valor) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
};

const escaparRegex = (texto = '') => {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const normalizarTexto = (valor = '') => String(valor || '').trim();

const normalizarProductoId = (valor) => {
  if (!valor) return null;
  return mongoose.Types.ObjectId.isValid(valor)
    ? new mongoose.Types.ObjectId(valor)
    : null;
};

const resolverFormatoYTipo = (payload = {}) => {
  const formato = normalizarTexto(payload.formato).toLowerCase();
  const tipo = normalizarTexto(payload.tipo).toUpperCase();

  if (formato === FORMATOS.CONSIGNACION || tipo === TIPOS.CONSIGNACION) {
    return {
      formato: FORMATOS.CONSIGNACION,
      tipo: TIPOS.CONSIGNACION,
    };
  }

  return {
    formato: FORMATOS.VENTA,
    tipo: TIPOS.COMPRA,
  };
};

const normalizarFechaCotizacion = (valor) => {
  if (!valor) return new Date();

  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    return new Date(`${valor.trim()}T00:00:00`);
  }

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? new Date() : fecha;
};

const obtenerFechaISOParaFolio = (valor) => {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    return valor.trim();
  }

  const fecha = normalizarFechaCotizacion(valor);
  return fecha.toISOString().slice(0, 10);
};

const generarBaseFolio = (formato, fechaCotizacion) => {
  const prefijo = PREFIJOS_FOLIO[formato] || 'CT';
  const fecha = obtenerFechaISOParaFolio(fechaCotizacion);
  return `${prefijo}-${fecha}`;
};

const calcularLineaCompra = (item) => {
  const cantidad = aNumero(item.cantidad);
  const precioUnitario = aNumero(item.precioUnitario);
  const descuento = clamp(aNumero(item.descuento), 0, 100);

  const subtotal = cantidad * precioUnitario;
  const descuentoMonto = subtotal * (descuento / 100);
  const totalLinea = Math.max(subtotal - descuentoMonto, 0);

  return {
    descuento,
    subtotal,
    totalLinea,
  };
};

const calcularLineaConsignacion = (item) => {
  const cantidad = aNumero(item.cantidad);
  const precioUnitario = aNumero(item.precioUnitario);
  const incrementoPorcentaje = Math.max(aNumero(item.incrementoPorcentaje), 0);
  const comisionClientePorcentaje = clamp(
    aNumero(item.comisionClientePorcentaje),
    0,
    100
  );

  const subtotal = cantidad * precioUnitario;
  const incrementoValor = precioUnitario * (incrementoPorcentaje / 100);
  const nuevoPrecio = precioUnitario + incrementoValor;
  const precioRedondeado = Math.ceil(nuevoPrecio);
  const valorComisionCliente =
    precioRedondeado * (comisionClientePorcentaje / 100);
  const gananciaHilos = Math.max(precioRedondeado - valorComisionCliente, 0);

  const totalLinea = cantidad * precioRedondeado;
  const totalGananciaCliente = cantidad * valorComisionCliente;
  const totalGananciaHilos = cantidad * gananciaHilos;

  return {
    incrementoPorcentaje,
    comisionClientePorcentaje,
    subtotal,
    totalLinea,
    precioRedondeado,
    valorComisionCliente,
    gananciaHilos,
    totalGananciaCliente,
    totalGananciaHilos,
  };
};

const normalizarProductos = (entrada, formato) => {
  if (!Array.isArray(entrada) || !entrada.length) {
    throw new Error('La cotización debe incluir al menos un producto');
  }

  return entrada.map((item, index) => {
    const nombreProducto = normalizarTexto(item.nombreProducto);
    const cantidad = aNumero(item.cantidad);
    const precioUnitario = aNumero(item.precioUnitario);

    if (!nombreProducto) {
      throw new Error(`El producto #${index + 1} debe tener nombre`);
    }

    if (cantidad <= 0) {
      throw new Error(`La cantidad del producto "${nombreProducto}" debe ser mayor a 0`);
    }

    if (precioUnitario < 0) {
      throw new Error(`El precio del producto "${nombreProducto}" no puede ser negativo`);
    }

    const base = {
      productoId: normalizarProductoId(item.productoId || item.producto),
      nombreProducto,
      codigo: normalizarTexto(item.codigo),
      categoria: normalizarTexto(item.categoria),
      imagenUrl: normalizarTexto(item.imagenUrl),
      stock: Math.max(aNumero(item.stock), 0),
      cantidad,
      precioUnitario,
    };

    if (formato === FORMATOS.CONSIGNACION) {
      const calculo = calcularLineaConsignacion(item);

      return {
        ...base,
        descuento: 0,
        incrementoPorcentaje: calculo.incrementoPorcentaje,
        comisionClientePorcentaje: calculo.comisionClientePorcentaje,
        subtotal: calculo.subtotal,
        totalLinea: calculo.totalLinea,
        precioRedondeado: calculo.precioRedondeado,
        valorComisionCliente: calculo.valorComisionCliente,
        gananciaHilos: calculo.gananciaHilos,
        totalGananciaCliente: calculo.totalGananciaCliente,
        totalGananciaHilos: calculo.totalGananciaHilos,
      };
    }

    const calculo = calcularLineaCompra(item);

    return {
      ...base,
      descuento: calculo.descuento,
      incrementoPorcentaje: 0,
      comisionClientePorcentaje: 0,
      subtotal: calculo.subtotal,
      totalLinea: calculo.totalLinea,
      precioRedondeado: 0,
      valorComisionCliente: 0,
      gananciaHilos: 0,
      totalGananciaCliente: 0,
      totalGananciaHilos: 0,
    };
  });
};

const calcularTotales = (productos, formato) => {
  const totalPiezas = productos.reduce(
    (acc, item) => acc + aNumero(item.cantidad),
    0
  );

  if (formato === FORMATOS.CONSIGNACION) {
    return {
      totalPiezas,
      total: productos.reduce((acc, item) => acc + aNumero(item.totalLinea), 0),
      totalGananciaCliente: productos.reduce(
        (acc, item) => acc + aNumero(item.totalGananciaCliente),
        0
      ),
      totalGananciaHilos: productos.reduce(
        (acc, item) => acc + aNumero(item.totalGananciaHilos),
        0
      ),
    };
  }

  return {
    totalPiezas,
    total: productos.reduce((acc, item) => acc + aNumero(item.totalLinea), 0),
    totalGananciaCliente: 0,
    totalGananciaHilos: 0,
  };
};

const obtenerFolioDisponible = async ({
  formato,
  fechaCotizacion,
  folioSolicitado,
  excluirId = null,
}) => {
  const folioLimpio = normalizarTexto(folioSolicitado).toUpperCase();

  if (folioLimpio) {
    const filtro = { folio: folioLimpio };

    if (excluirId) {
      filtro._id = { $ne: excluirId };
    }

    const existente = await Cotizacion.findOne(filtro).lean();

    if (existente) {
      throw new Error(`El folio "${folioLimpio}" ya existe`);
    }

    return folioLimpio;
  }

  const base = generarBaseFolio(formato, fechaCotizacion);
  const regex = new RegExp(`^${escaparRegex(base)}(?:-(\\d{2}))?$`, 'i');

  const filtro = { folio: regex };

  if (excluirId) {
    filtro._id = { $ne: excluirId };
  }

  const existentes = await Cotizacion.find(filtro).select('folio').lean();

  if (!existentes.length) {
    return base;
  }

  const suffixes = existentes
    .map((doc) => String(doc.folio || '').toUpperCase())
    .map((folio) => {
      if (folio === base.toUpperCase()) return 1;
      const match = folio.match(/-(\d{2})$/);
      return match ? Number(match[1]) : 1;
    })
    .filter((n) => Number.isFinite(n));

  const siguiente = (Math.max(...suffixes, 1) || 1) + 1;
  return `${base}-${String(siguiente).padStart(2, '0')}`;
};

const construirPayloadCotizacion = async (payload = {}, cotizacionActual = null) => {
  const { formato, tipo } = resolverFormatoYTipo(payload);

  const cliente = normalizarTexto(payload.cliente);
  if (!cliente) {
    throw new Error('El cliente es obligatorio');
  }

  const fechaCotizacion = normalizarFechaCotizacion(payload.fechaCotizacion);

  const entradaProductos =
    payload.items !== undefined
      ? payload.items
      : payload.productos !== undefined
      ? payload.productos
      : cotizacionActual?.productos || [];

  const productos = normalizarProductos(entradaProductos, formato);
  const totales = calcularTotales(productos, formato);

  const folio = await obtenerFolioDisponible({
    formato,
    fechaCotizacion,
    folioSolicitado: payload.folio || cotizacionActual?.folio,
    excluirId: cotizacionActual?._id || null,
  });

  return {
    folio,
    tipo,
    formato,
    cliente,
    telefono: normalizarTexto(payload.telefono),
    fechaCotizacion,
    vigencia: normalizarTexto(payload.vigencia),
    notas: normalizarTexto(payload.notas),
    productos,
    totalPiezas: totales.totalPiezas,
    total: totales.total,
    totalGananciaCliente: totales.totalGananciaCliente,
    totalGananciaHilos: totales.totalGananciaHilos,
    estatus: ['pendiente', 'aprobada', 'rechazada'].includes(payload.estatus)
      ? payload.estatus
      : cotizacionActual?.estatus || 'pendiente',
  };
};

router.get('/', proteger, async (req, res) => {
  try {
    const {
      q,
      formato,
      tipo,
      estatus,
      cliente,
      folio,
      desde,
      hasta,
    } = req.query;

    const filtro = {};

    if (formato && [FORMATOS.VENTA, FORMATOS.CONSIGNACION].includes(formato)) {
      filtro.formato = formato;
    }

    if (tipo && [TIPOS.COMPRA, TIPOS.CONSIGNACION].includes(String(tipo).toUpperCase())) {
      filtro.tipo = String(tipo).toUpperCase();
    }

    if (estatus && ['pendiente', 'aprobada', 'rechazada'].includes(estatus)) {
      filtro.estatus = estatus;
    }

    if (cliente) {
      filtro.cliente = { $regex: escaparRegex(cliente), $options: 'i' };
    }

    if (folio) {
      filtro.folio = { $regex: escaparRegex(folio), $options: 'i' };
    }

    if (desde || hasta) {
      filtro.fechaCotizacion = {};
      if (desde) {
        filtro.fechaCotizacion.$gte = new Date(`${desde}T00:00:00`);
      }
      if (hasta) {
        filtro.fechaCotizacion.$lte = new Date(`${hasta}T23:59:59.999`);
      }
    }

    if (q) {
      const regex = { $regex: escaparRegex(q), $options: 'i' };
      filtro.$or = [
        { folio: regex },
        { cliente: regex },
        { telefono: regex },
        { notas: regex },
        { vigencia: regex },
        { productos: { $elemMatch: { nombreProducto: regex } } },
        { productos: { $elemMatch: { codigo: regex } } },
        { productos: { $elemMatch: { categoria: regex } } },
      ];
    }

    const cotizaciones = await Cotizacion.find(filtro).sort({
      createdAt: -1,
      fechaCotizacion: -1,
    });

    res.json(cotizaciones);
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al obtener cotizaciones',
      error: error.message,
    });
  }
});

router.post('/', proteger, async (req, res) => {
  try {
    const payload = await construirPayloadCotizacion(req.body);
    const cotizacion = await Cotizacion.create(payload);

    sendEvent('ventas', { accion: 'cotizacion_creada', cotizacion });
    res.status(201).json(cotizacion);
  } catch (error) {
    const status = error.code === 11000 ? 400 : 400;
    res.status(status).json({
      mensaje: 'Error al crear cotización',
      error:
        error.code === 11000
          ? 'Ya existe una cotización con ese folio'
          : error.message,
    });
  }
});

router.put('/:id', proteger, async (req, res) => {
  try {
    const cotizacionActual = await Cotizacion.findById(req.params.id);

    if (!cotizacionActual) {
      return res.status(404).json({ mensaje: 'Cotización no encontrada' });
    }

    const baseActual = cotizacionActual.toObject();
    const payloadFusionado = {
      ...baseActual,
      ...req.body,
    };

    const payload = await construirPayloadCotizacion(
      payloadFusionado,
      cotizacionActual
    );

    cotizacionActual.set(payload);
    await cotizacionActual.save();

    sendEvent('ventas', {
      accion: 'cotizacion_actualizada',
      cotizacion: cotizacionActual,
    });

    res.json(cotizacionActual);
  } catch (error) {
    const status = error.code === 11000 ? 400 : 400;
    res.status(status).json({
      mensaje: 'Error al actualizar cotización',
      error:
        error.code === 11000
          ? 'Ya existe una cotización con ese folio'
          : error.message,
    });
  }
});

router.delete('/:id', proteger, async (req, res) => {
  try {
    const cotizacion = await Cotizacion.findByIdAndDelete(req.params.id);

    if (!cotizacion) {
      return res.status(404).json({ mensaje: 'Cotización no encontrada' });
    }

    sendEvent('ventas', {
      accion: 'cotizacion_eliminada',
      cotizacionId: req.params.id,
      folio: cotizacion.folio,
    });

    res.json({ mensaje: 'Cotización eliminada correctamente' });
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al eliminar cotización',
      error: error.message,
    });
  }
});

module.exports = router;