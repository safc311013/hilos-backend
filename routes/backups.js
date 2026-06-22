const express = require('express');
const Producto = require('../models/Producto');
const HistorialProducto = require('../models/HistorialProducto');
const cloudinary = require('../config/cloudinary');
const { proteger, soloAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
const TIEMPO_LIMITE_FOTO_MS = 30000;

const obtenerUrlFoto = (producto) => {
  if (producto.imagenPublicId) {
    return cloudinary.url(producto.imagenPublicId, {
      secure: true,
      resource_type: 'image',
    });
  }

  return String(producto.imagenUrl || '').trim();
};

const validarUrlFoto = (urlFoto) => {
  const url = new URL(urlFoto);

  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') {
    throw new Error('La foto no pertenece al almacenamiento seguro de Cloudinary');
  }

  return url.toString();
};

const descargarFoto = async (producto) => {
  const urlFoto = obtenerUrlFoto(producto);
  if (!urlFoto) return null;

  const codigo = producto.codigo || producto._id.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIEMPO_LIMITE_FOTO_MS);

  try {
    const urlSegura = validarUrlFoto(urlFoto);
    const respuesta = await fetch(urlSegura, {
      signal: controller.signal,
      redirect: 'error',
    });

    if (!respuesta.ok) {
      throw new Error(`Cloudinary respondió con estado ${respuesta.status}`);
    }

    const tipoMime = String(respuesta.headers.get('content-type') || '').split(';')[0];
    if (!tipoMime.startsWith('image/')) {
      throw new Error('El archivo descargado no es una imagen');
    }

    const contenido = Buffer.from(await respuesta.arrayBuffer());

    return {
      publicId: producto.imagenPublicId || '',
      urlOriginal: producto.imagenUrl || urlSegura,
      tipoMime,
      tamanoBytes: contenido.length,
      contenidoBase64: contenido.toString('base64'),
    };
  } catch (error) {
    const detalle = error.name === 'AbortError' ? 'tiempo de espera agotado' : error.message;
    throw new Error(`No se pudo respaldar la foto del producto ${codigo}: ${detalle}`);
  } finally {
    clearTimeout(timeout);
  }
};

router.get('/inventario/resumen', proteger, soloAdmin, async (req, res) => {
  try {
    const [productos, productosConFoto, registrosHistorial] = await Promise.all([
      Producto.countDocuments({}),
      Producto.countDocuments({
        $or: [
          { imagenPublicId: { $exists: true, $ne: '' } },
          { imagenUrl: { $exists: true, $ne: '' } },
        ],
      }),
      HistorialProducto.countDocuments({}),
    ]);

    return res.json({ productos, productosConFoto, registrosHistorial });
  } catch (error) {
    return res.status(500).json({
      mensaje: 'No se pudo obtener el resumen del inventario',
      error: error.message,
    });
  }
});

router.get('/inventario/descargar', proteger, soloAdmin, async (req, res) => {
  try {
    const [productos, historial] = await Promise.all([
      Producto.find({}).sort({ codigo: 1 }).lean(),
      HistorialProducto.find({}).sort({ createdAt: 1 }).lean(),
    ]);

    const productosRespaldados = [];
    let fotosIncluidas = 0;
    let bytesFotos = 0;

    // Se descargan en serie para no saturar la memoria ni Cloudinary.
    for (const producto of productos) {
      const foto = await descargarFoto(producto);
      if (foto) {
        fotosIncluidas += 1;
        bytesFotos += foto.tamanoBytes;
      }

      productosRespaldados.push({
        datos: producto,
        foto,
      });
    }

    const creadoEn = new Date();
    const respaldo = {
      formato: 'hilos-inventario-backup',
      version: 1,
      creadoEn: creadoEn.toISOString(),
      creadoPor: {
        id: req.usuario._id,
        nombre: req.usuario.nombre,
        email: req.usuario.email,
      },
      resumen: {
        productos: productosRespaldados.length,
        fotosIncluidas,
        bytesFotos,
        registrosHistorial: historial.length,
      },
      productos: productosRespaldados,
      historialProductos: historial,
    };

    const fechaArchivo = creadoEn.toISOString().replace(/[:.]/g, '-');
    const nombreArchivo = `respaldo-inventario-${fechaArchivo}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(JSON.stringify(respaldo));
  } catch (error) {
    console.error('Error al crear respaldo de inventario:', error);
    return res.status(502).json({
      mensaje: 'No se pudo crear una copia completa del inventario',
      error: error.message,
    });
  }
});

module.exports = router;
