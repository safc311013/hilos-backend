const express = require('express');
const Producto = require('../models/Producto');
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
    filtro.categoria = categoria;
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

router.get('/', proteger, permitirAdminSupervisorOCajero, async (req, res) => {
  try {
    const productos = await Producto.find().sort({ createdAt: -1 });
    res.json(productos);
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
      items,
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
      items,
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

router.get('/codigo/:codigo', proteger, permitirAdminSupervisorOCajero, async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim().toUpperCase();

    const producto = await Producto.findOne({
      codigo,
      activo: true,
      stock: { $gt: 0 },
    }).lean();

    if (!producto) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' });
    }

    res.json(producto);
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

    res.json(productos);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener stock bajo', error: error.message });
  }
});

router.post('/', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const codigoNormalizado = String(req.body.codigo || '').trim().toUpperCase();

    const existe = await Producto.findOne({ codigo: codigoNormalizado });
    if (existe) {
      return res.status(400).json({ mensaje: 'Ya existe un producto con ese código' });
    }

    const payload = {
      codigo: codigoNormalizado,
      nombre: String(req.body.nombre || '').trim(),
      categoria: String(req.body.categoria || '').trim() || 'General',
      costoArtesano: Number(req.body.costoArtesano),
      precio: Number(req.body.precio),
      stock: Number(req.body.stock),
      stockMinimo: 3,
      activo: req.body.activo ?? true,
      imagenUrl: String(req.body.imagenUrl || '').trim(),
      imagenPublicId: String(req.body.imagenPublicId || '').trim(),
    };

    const producto = await Producto.create(payload);
    sendEvent('productos', { accion: 'crear', producto });
    res.status(201).json(producto);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al crear producto', error: error.message });
  }
});

router.put('/:id', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const codigoNormalizado = String(req.body.codigo || '').trim().toUpperCase();

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
      nombre: String(req.body.nombre || '').trim(),
      categoria: String(req.body.categoria || '').trim() || 'General',
      costoArtesano: Number(req.body.costoArtesano),
      precio: Number(req.body.precio),
      stock: Number(req.body.stock),
      stockMinimo: 3,
      activo: req.body.activo ?? true,
      imagenUrl: nuevaImagenUrl,
      imagenPublicId: nuevaImagenPublicId,
    };

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
        console.error('No se pudo eliminar la imagen anterior de Cloudinary:', errorCloudinary.message);
      }
    }

    sendEvent('productos', { accion: 'actualizar', producto });
    res.json(producto);
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

    if (producto.imagenPublicId) {
      try {
        await cloudinary.uploader.destroy(producto.imagenPublicId);
      } catch (errorCloudinary) {
        console.error('No se pudo eliminar la imagen de Cloudinary:', errorCloudinary.message);
      }
    }

    sendEvent('productos', { accion: 'eliminar', productoId: req.params.id });
    res.json({ mensaje: 'Producto eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar producto', error: error.message });
  }
});

module.exports = router;