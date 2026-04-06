const express = require('express');
const Producto = require('../models/Producto');
const HistorialProducto = require('../models/HistorialProducto');
const { proteger } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');
const cloudinary = require('../config/cloudinary');

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

const escaparRegex = (texto = '') => {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const construirRegexPrefijo = (texto = '', { uppercase = false } = {}) => {
  const limpio = String(texto || '').trim();
  if (!limpio) return null;

  const base = uppercase ? limpio.toUpperCase() : limpio;
  return new RegExp(`^${escaparRegex(base)}`, uppercase ? undefined : 'i');
};

const aNumero = (valor) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : NaN;
};

const resolverPrecio = (body = {}) => {
  return aNumero(body.precioVenta ?? body.precio);
};

const serializarProducto = (producto) => {
  if (!producto) return producto;

  const obj = typeof producto.toObject === 'function'
    ? producto.toObject()
    : { ...producto };

  return {
    ...obj,
    precioVenta: obj.precio,
  };
};

const serializarListaProductos = (productos = []) => {
  return productos.map(serializarProducto);
};

const construirFiltroBusqueda = ({
  q = '',
  activo,
  stockMayorQueCero = false,
  stockBajo = false,
  categoria = '',
}) => {
  const filtro = {};

  if (typeof activo === 'boolean') {
    filtro.activo = activo;
  }

  if (stockMayorQueCero) {
    filtro.stock = { $gt: 0 };
  }

  if (stockBajo) {
    filtro.stock = { ...(filtro.stock || {}), $lte: 3 };
  }

  if (categoria) {
    filtro.categoria = new RegExp(`^${escaparRegex(String(categoria).trim())}$`, 'i');
  }

  const texto = String(q || '').trim();

  if (texto) {
    const regexCodigo = construirRegexPrefijo(texto, { uppercase: true });
    const regexTexto = construirRegexPrefijo(texto);

    filtro.$or = [
      { codigo: regexCodigo },
      { nombre: regexTexto },
      { categoria: regexTexto },
    ];
  }

  return filtro;
};

const obtenerPaginacion = (req, defaultLimit = 12) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defaultLimit, 1), 100);

  return { page, limit };
};

const obtenerOrdenInventario = (sortKey, direction) => {
  const camposPermitidos = ['codigo', 'categoria', 'nombre', 'costoArtesano', 'precio', 'stock'];
  const key = camposPermitidos.includes(sortKey) ? sortKey : 'codigo';
  const dir = direction === 'desc' ? -1 : 1;

  return { [key]: dir, createdAt: -1 };
};

const crearActorDesdeRequest = (req) => ({
  usuarioId: req.usuario?._id,
  nombre: req.usuario?.nombre || 'Usuario desconocido',
  email: req.usuario?.email || '',
  rol: req.usuario?.rol || 'desconocido',
});

const valorLegible = (valor) => {
  if (valor === undefined || valor === null) return '';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  return String(valor);
};

const construirCambiosProducto = (anterior, nuevo) => {
  const cambios = [];

  const comparaciones = [
    ['codigo', anterior.codigo, nuevo.codigo],
    ['nombre', anterior.nombre, nuevo.nombre],
    ['categoria', anterior.categoria, nuevo.categoria],
    ['costoArtesano', anterior.costoArtesano, nuevo.costoArtesano],
    ['precioVenta', anterior.precio, nuevo.precio],
    ['stock', anterior.stock, nuevo.stock],
    ['activo', anterior.activo, nuevo.activo],
  ];

  comparaciones.forEach(([campo, antes, despues]) => {
    if (valorLegible(antes) !== valorLegible(despues)) {
      cambios.push({
        campo,
        antes: valorLegible(antes),
        despues: valorLegible(despues),
      });
    }
  });

  return cambios;
};

const registrarHistorialProducto = async ({
  productoId,
  codigo,
  nombreProducto,
  tipo,
  detalle,
  cambios = [],
  req,
}) => {
  try {
    await HistorialProducto.create({
      productoId,
      codigo: String(codigo || '').trim().toUpperCase(),
      nombreProducto: String(nombreProducto || '').trim(),
      tipo,
      detalle: String(detalle || '').trim(),
      cambios,
      actor: crearActorDesdeRequest(req),
    });
  } catch (error) {
    console.error('No se pudo registrar el historial del producto:', error.message);
  }
};

router.get('/', proteger, permitirAdminSupervisorOCajero, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const categoria = String(req.query.categoria || '').trim();
    const stockBajo = String(req.query.stockBajo || '').toLowerCase() === 'true';
    const activoParam = req.query.activo;

    let activo;
    if (activoParam === 'true') activo = true;
    if (activoParam === 'false') activo = false;

    const filtro = construirFiltroBusqueda({
      q,
      categoria,
      stockBajo,
      activo,
    });

    const productos = await Producto.find(filtro).sort({ createdAt: -1 });
    res.json(serializarListaProductos(productos));
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener productos', error: error.message });
  }
});

router.get('/categorias', proteger, permitirAdminSupervisorOCajero, async (req, res) => {
  try {
    const categorias = await Producto.distinct('categoria', {
      categoria: { $nin: [null, ''] },
    });

    const categoriasOrdenadas = categorias.sort((a, b) =>
      String(a).localeCompare(String(b), 'es', { sensitivity: 'base' })
    );

    res.json(categoriasOrdenadas);
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al obtener categorías',
      error: error.message,
    });
  }
});

router.get('/catalogo', proteger, permitirAdminSupervisorOCajero, async (req, res) => {
  try {
    const { page, limit } = obtenerPaginacion(req, 12);
    const q = String(req.query.q || '').trim();

    const filtro = construirFiltroBusqueda({
      q,
      activo: true,
      stockMayorQueCero: true,
    });

    const total = await Producto.countDocuments(filtro);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, totalPages);
    const skip = (currentPage - 1) * limit;

    const items = await Producto.find(filtro)
      .sort({ nombre: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      items: serializarListaProductos(items),
      page: currentPage,
      limit,
      total,
      totalPages,
    });
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al obtener catálogo paginado',
      error: error.message,
    });
  }
});

router.get('/inventario', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const { page, limit } = obtenerPaginacion(req, 20);
    const q = String(req.query.q || '').trim();
    const categoria = String(req.query.categoria || '').trim();
    const stockBajo = String(req.query.stockBajo || '').toLowerCase() === 'true';
    const sortKey = String(req.query.sortKey || 'codigo').trim();
    const direction = String(req.query.direction || 'asc').trim().toLowerCase();

    const filtro = construirFiltroBusqueda({
      q,
      categoria,
      stockBajo,
    });

    const total = await Producto.countDocuments(filtro);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, totalPages);
    const skip = (currentPage - 1) * limit;

    const items = await Producto.find(filtro)
      .sort(obtenerOrdenInventario(sortKey, direction))
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      items: serializarListaProductos(items),
      page: currentPage,
      limit,
      total,
      totalPages,
      sortKey: ['codigo', 'categoria', 'nombre', 'costoArtesano', 'precio', 'stock'].includes(sortKey)
        ? sortKey
        : 'codigo',
      direction: direction === 'desc' ? 'desc' : 'asc',
    });
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al obtener inventario paginado',
      error: error.message,
    });
  }
});

router.get('/codigo/:codigo/historial', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

    const items = await HistorialProducto.find({ codigo })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(items);
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al obtener el historial del producto',
      error: error.message,
    });
  }
});

/**
 * Para inventario interno conviene poder escanear incluso productos con stock 0.
 * Se mantiene activo: true, pero ya no se exige stock > 0.
 */
router.get('/codigo/:codigo', proteger, permitirAdminSupervisorOCajero, async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();

    const producto = await Producto.findOne({
      codigo,
      activo: true,
    }).lean();

    if (!producto) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    res.json(serializarProducto(producto));
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al buscar producto por código',
      error: error.message,
    });
  }
});

router.get('/stock-bajo', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const productos = await Producto.find({
      stock: { $lte: 3 },
      activo: true,
    }).sort({ stock: 1 });

    res.json(serializarListaProductos(productos));
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener stock bajo', error: error.message });
  }
});

router.post('/', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const codigoNormalizado = String(req.body.codigo || '').trim().toUpperCase();
    const nombre = String(req.body.nombre || '').trim();
    const categoria = String(req.body.categoria || '').trim() || 'General';
    const costoArtesano = aNumero(req.body.costoArtesano);
    const precio = resolverPrecio(req.body);
    const stock = aNumero(req.body.stock);

    if (!codigoNormalizado || !nombre) {
      return res.status(400).json({
        mensaje: 'Código y nombre son obligatorios',
      });
    }

    if (!Number.isFinite(costoArtesano) || costoArtesano < 0) {
      return res.status(400).json({
        mensaje: 'Costo artesano inválido',
      });
    }

    if (!Number.isFinite(precio) || precio < 0) {
      return res.status(400).json({
        mensaje: 'Precio de venta inválido',
      });
    }

    if (!Number.isFinite(stock) || stock < 0) {
      return res.status(400).json({
        mensaje: 'Stock inválido',
      });
    }

    const existe = await Producto.findOne({ codigo: codigoNormalizado });
    if (existe) {
      return res.status(400).json({ mensaje: 'Ya existe un producto con ese código' });
    }

    const payload = {
      codigo: codigoNormalizado,
      nombre,
      categoria,
      costoArtesano,
      precio,
      stock,
      stockMinimo: 3,
      activo: req.body.activo ?? true,
      imagenUrl: String(req.body.imagenUrl || '').trim(),
      imagenPublicId: String(req.body.imagenPublicId || '').trim(),
    };

    const producto = await Producto.create(payload);

    await registrarHistorialProducto({
      productoId: producto._id,
      codigo: producto.codigo,
      nombreProducto: producto.nombre,
      tipo: 'CREACION',
      detalle: 'Producto creado',
      cambios: [
        { campo: 'codigo', antes: '', despues: producto.codigo },
        { campo: 'nombre', antes: '', despues: producto.nombre },
        { campo: 'categoria', antes: '', despues: producto.categoria },
        { campo: 'costoArtesano', antes: '', despues: valorLegible(producto.costoArtesano) },
        { campo: 'precioVenta', antes: '', despues: valorLegible(producto.precio) },
        { campo: 'stock', antes: '', despues: valorLegible(producto.stock) },
      ],
      req,
    });

    sendEvent('productos', { accion: 'crear', producto: serializarProducto(producto) });
    res.status(201).json(serializarProducto(producto));
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al crear producto', error: error.message });
  }
});

router.put('/:id', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const codigoNormalizado = String(req.body.codigo || '').trim().toUpperCase();
    const nombre = String(req.body.nombre || '').trim();
    const categoria = String(req.body.categoria || '').trim() || 'General';
    const costoArtesano = aNumero(req.body.costoArtesano);
    const precio = resolverPrecio(req.body);
    const stock = aNumero(req.body.stock);

    if (!codigoNormalizado || !nombre) {
      return res.status(400).json({
        mensaje: 'Código y nombre son obligatorios',
      });
    }

    if (!Number.isFinite(costoArtesano) || costoArtesano < 0) {
      return res.status(400).json({
        mensaje: 'Costo artesano inválido',
      });
    }

    if (!Number.isFinite(precio) || precio < 0) {
      return res.status(400).json({
        mensaje: 'Precio de venta inválido',
      });
    }

    if (!Number.isFinite(stock) || stock < 0) {
      return res.status(400).json({
        mensaje: 'Stock inválido',
      });
    }

    const existe = await Producto.findOne({
      codigo: codigoNormalizado,
      _id: { $ne: req.params.id },
    });

    if (existe) {
      return res.status(400).json({ mensaje: 'Ya existe otro producto con ese código' });
    }

    const productoActual = await Producto.findById(req.params.id);

    if (!productoActual) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    const nuevaImagenUrl = String(req.body.imagenUrl || '').trim();
    const nuevaImagenPublicId = String(req.body.imagenPublicId || '').trim();

    const payload = {
      codigo: codigoNormalizado,
      nombre,
      categoria,
      costoArtesano,
      precio,
      stock,
      stockMinimo: 3,
      activo: req.body.activo ?? true,
      imagenUrl: nuevaImagenUrl,
      imagenPublicId: nuevaImagenPublicId,
    };

    const cambios = construirCambiosProducto(productoActual, payload);

    const producto = await Producto.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    const imagenAnterior =
      productoActual.imagenPublicId &&
      productoActual.imagenPublicId !== nuevaImagenPublicId
        ? productoActual.imagenPublicId
        : '';

    if (imagenAnterior) {
      try {
        await cloudinary.uploader.destroy(imagenAnterior);
      } catch (errorCloudinary) {
        console.error(
          'No se pudo eliminar la imagen anterior de Cloudinary:',
          errorCloudinary.message
        );
      }
    }

    await registrarHistorialProducto({
      productoId: producto._id,
      codigo: producto.codigo,
      nombreProducto: producto.nombre,
      tipo: 'EDICION',
      detalle: cambios.length > 0
        ? `Producto actualizado (${cambios.length} cambio(s))`
        : 'Producto actualizado sin cambios detectables',
      cambios,
      req,
    });

    sendEvent('productos', { accion: 'actualizar', producto: serializarProducto(producto) });
    res.json(serializarProducto(producto));
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al actualizar producto', error: error.message });
  }
});

router.delete('/:id', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const producto = await Producto.findByIdAndDelete(req.params.id);

    if (!producto) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    await registrarHistorialProducto({
      productoId: producto._id,
      codigo: producto.codigo,
      nombreProducto: producto.nombre,
      tipo: 'ELIMINACION',
      detalle: 'Producto eliminado',
      cambios: [
        { campo: 'codigo', antes: producto.codigo, despues: '' },
        { campo: 'nombre', antes: producto.nombre, despues: '' },
        { campo: 'categoria', antes: producto.categoria, despues: '' },
        { campo: 'costoArtesano', antes: valorLegible(producto.costoArtesano), despues: '' },
        { campo: 'precioVenta', antes: valorLegible(producto.precio), despues: '' },
        { campo: 'stock', antes: valorLegible(producto.stock), despues: '' },
      ],
      req,
    });

    if (producto.imagenPublicId) {
      try {
        await cloudinary.uploader.destroy(producto.imagenPublicId);
      } catch (errorCloudinary) {
        console.error(
          'No se pudo eliminar la imagen de Cloudinary:',
          errorCloudinary.message
        );
      }
    }

    sendEvent('productos', { accion: 'eliminar', productoId: req.params.id });
    res.json({ mensaje: 'Producto eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar producto', error: error.message });
  }
});

module.exports = router;
