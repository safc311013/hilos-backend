const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const os = require('os');
const fs = require('fs/promises');
const Producto = require('../models/Producto');
const HistorialProducto = require('../models/HistorialProducto');
const cloudinary = require('../config/cloudinary');
const { proteger, soloAdmin } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');

const router = express.Router();
const TIEMPO_LIMITE_FOTO_MS = 30000;
const TAMANO_MAXIMO_RESPALDO = 1024 * 1024 * 1024;
const TIPOS_FOTO_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

const uploadRespaldo = multer({
  dest: os.tmpdir(),
  limits: { fileSize: TAMANO_MAXIMO_RESPALDO, files: 1 },
  fileFilter: (req, file, cb) => {
    const nombreValido = String(file.originalname || '').toLowerCase().endsWith('.json');
    const mimeValido = ['', 'application/json', 'text/json', 'application/octet-stream'].includes(
      file.mimetype
    );

    if (!nombreValido || !mimeValido) {
      return cb(new Error('Selecciona un archivo de respaldo JSON válido'));
    }

    return cb(null, true);
  },
});

const recibirArchivoRespaldo = (req, res, next) => {
  uploadRespaldo.single('respaldo')(req, res, (error) => {
    if (!error) return next();

    const mensaje =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'El respaldo supera el límite de 1 GB'
        : error.message;
    return res.status(400).json({ mensaje });
  });
};

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

const validarYPrepararRespaldo = (respaldo) => {
  if (!respaldo || respaldo.formato !== 'hilos-inventario-backup' || respaldo.version !== 1) {
    throw new Error('El archivo no es una copia de seguridad compatible');
  }

  if (!Array.isArray(respaldo.productos) || !Array.isArray(respaldo.historialProductos)) {
    throw new Error('El respaldo no contiene la estructura completa del inventario');
  }

  const codigos = new Set();
  const productos = respaldo.productos.map((registro, index) => {
    if (!registro?.datos || typeof registro.datos !== 'object') {
      throw new Error(`El producto ${index + 1} no contiene datos válidos`);
    }

    const datos = { ...registro.datos };
    const codigo = String(datos.codigo || '').trim().toUpperCase();

    if (!codigo || codigos.has(codigo)) {
      throw new Error(`El código del producto ${index + 1} está vacío o duplicado`);
    }

    if (!mongoose.isValidObjectId(datos._id)) {
      throw new Error(`El producto ${codigo} tiene un identificador inválido`);
    }

    codigos.add(codigo);
    datos.codigo = codigo;

    const foto = registro.foto;
    if (!foto) {
      if (datos.imagenUrl || datos.imagenPublicId) {
        throw new Error(`El respaldo no contiene la foto registrada para ${codigo}`);
      }
      datos.imagenUrl = '';
      datos.imagenPublicId = '';
      return { datos, foto: null };
    }

    const tipoMime = String(foto.tipoMime || '').toLowerCase();
    if (!TIPOS_FOTO_PERMITIDOS.has(tipoMime) || !foto.contenidoBase64) {
      throw new Error(`La foto del producto ${codigo} no es válida`);
    }

    const tamanoBytes = Number(foto.tamanoBytes);
    if (!Number.isSafeInteger(tamanoBytes) || tamanoBytes <= 0) {
      throw new Error(`La foto del producto ${codigo} está dañada o incompleta`);
    }

    return {
      datos,
      foto: {
        tipoMime,
        tamanoBytes,
        contenidoBase64: foto.contenidoBase64,
      },
    };
  });

  return {
    productos,
    historial: respaldo.historialProductos.map((registro) => ({ ...registro })),
  };
};

const subirFotoRestaurada = (foto, carpeta) => {
  return new Promise((resolve, reject) => {
    const contenido = Buffer.from(foto.contenidoBase64, 'base64');
    if (!contenido.length || contenido.length !== foto.tamanoBytes) {
      return reject(new Error('La foto está dañada o incompleta'));
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: carpeta,
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      },
      (error, resultado) => {
        if (error) return reject(error);
        return resolve(resultado);
      }
    );

    stream.end(contenido);
  });
};

const eliminarFotosSubidas = async (publicIds) => {
  await Promise.allSettled(publicIds.map((publicId) => cloudinary.uploader.destroy(publicId)));
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

router.post(
  '/inventario/restaurar',
  proteger,
  soloAdmin,
  recibirArchivoRespaldo,
  async (req, res) => {
    const fotosSubidas = [];
    let session;

    try {
      if (!req.file) {
        return res.status(400).json({ mensaje: 'No se recibió el archivo de respaldo' });
      }

      let respaldo;
      try {
        respaldo = JSON.parse(await fs.readFile(req.file.path, 'utf8'));
      } catch {
        return res.status(400).json({ mensaje: 'El archivo JSON está dañado o no es válido' });
      }

      const preparado = validarYPrepararRespaldo(respaldo);
      respaldo = null;
      const carpeta = `productos/restaurados/${Date.now()}`;
      const productosRestaurados = [];

      // Las fotos se completan antes de modificar MongoDB.
      for (const producto of preparado.productos) {
        const datos = { ...producto.datos };

        if (producto.foto) {
          const resultado = await subirFotoRestaurada(producto.foto, carpeta);
          fotosSubidas.push(resultado.public_id);
          datos.imagenUrl = resultado.secure_url;
          datos.imagenPublicId = resultado.public_id;
          producto.foto.contenidoBase64 = null;
        }

        productosRestaurados.push(datos);
      }

      // Valida los esquemas antes de abrir la transacción destructiva.
      for (const datos of productosRestaurados) {
        await new Producto(datos).validate();
      }
      for (const datos of preparado.historial) {
        await new HistorialProducto(datos).validate();
      }

      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await HistorialProducto.deleteMany({}, { session });
        await Producto.deleteMany({}, { session });

        if (productosRestaurados.length) {
          await Producto.insertMany(productosRestaurados, { session });
        }
        if (preparado.historial.length) {
          await HistorialProducto.insertMany(preparado.historial, { session });
        }
      });

      sendEvent('productos', { accion: 'restauracion_completa' });

      return res.json({
        mensaje: 'Inventario restaurado correctamente',
        resumen: {
          productos: productosRestaurados.length,
          fotosRestauradas: fotosSubidas.length,
          registrosHistorial: preparado.historial.length,
        },
      });
    } catch (error) {
      await eliminarFotosSubidas(fotosSubidas);
      console.error('Error al restaurar respaldo de inventario:', error);
      return res.status(500).json({
        mensaje: 'No se pudo restaurar la copia de seguridad',
        error: error.message,
      });
    } finally {
      if (session) await session.endSession();
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
    }
  }
);

module.exports = router;
