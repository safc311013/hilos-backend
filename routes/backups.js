const express = require('express');
const mongoose = require('mongoose');
const Producto = require('../models/Producto');
const HistorialProducto = require('../models/HistorialProducto');
const cloudinary = require('../config/cloudinary');
const { proteger, soloAdmin } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');

const router = express.Router();
const TIEMPO_LIMITE_FOTO_MS = 30000;
const TIPOS_FOTO_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

let modulosStreamingPromise;

const obtenerModulosStreaming = () => {
  if (!modulosStreamingPromise) {
    modulosStreamingPromise = Promise.all([
      import('stream-json'),
      import('stream-json/filters/pick.js'),
      import('stream-json/streamers/stream-array.js'),
      import('stream-chain'),
    ]);
  }

  return modulosStreamingPromise;
};

const crearLectoresRestauracion = async (origen) => {
  const [{ parser }, { pick }, { streamArray }, { chain }] = await obtenerModulosStreaming();
  const analizador = chain([parser()]);
  const productos = chain([pick({ filter: 'productos' }), streamArray()]);
  const historial = chain([pick({ filter: 'historialProductos' }), streamArray()]);

  const propagarError = (error) => {
    productos.destroy(error);
    historial.destroy(error);
  };

  origen.once('error', propagarError);
  analizador.once('error', propagarError);
  analizador.pipe(productos);
  analizador.pipe(historial);
  origen.pipe(analizador);

  return {
    productos,
    historial,
    cancelar: () => {
      origen.unpipe(analizador);
      origen.resume();
      analizador.destroy();
      productos.destroy();
      historial.destroy();
    },
  };
};

const validarProductoRespaldo = (registro, index, codigos) => {
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
};

const validarResumenRestaurado = (esperado, actual, nombre) => {
  if (esperado !== actual) {
    throw new Error(
      `El respaldo está incompleto: se esperaban ${esperado} ${nombre} y se encontraron ${actual}`
    );
  }
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

const escribirFragmento = (stream, contenido) => {
  return new Promise((resolve, reject) => {
    stream.write(contenido, 'utf8', (error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
};

const finalizarEscritura = (stream) => {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
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
    const [totalProductos, fotosIncluidas, registrosHistorial] = await Promise.all([
      Producto.countDocuments({}),
      Producto.countDocuments({
        $or: [
          { imagenPublicId: { $exists: true, $ne: '' } },
          { imagenUrl: { $exists: true, $ne: '' } },
        ],
      }),
      HistorialProducto.countDocuments({}),
    ]);

    const creadoEn = new Date();
    const cabecera = {
      formato: 'hilos-inventario-backup',
      version: 1,
      creadoEn: creadoEn.toISOString(),
      creadoPor: {
        id: req.usuario._id,
        nombre: req.usuario.nombre,
        email: req.usuario.email,
      },
      resumen: {
        productos: totalProductos,
        fotosIncluidas,
        bytesFotos: null,
        registrosHistorial,
      },
    };

    const fechaArchivo = creadoEn.toISOString().replace(/[:.]/g, '-');
    const nombreArchivo = `respaldo-inventario-${fechaArchivo}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Cache-Control', 'no-store');

    await escribirFragmento(res, `${JSON.stringify(cabecera).slice(0, -1)},"productos":[`);

    let primerProducto = true;
    const cursorProductos = Producto.find({}).sort({ codigo: 1 }).lean().cursor();
    for await (const producto of cursorProductos) {
      const foto = await descargarFoto(producto);
      const registro = JSON.stringify({ datos: producto, foto });
      await escribirFragmento(res, `${primerProducto ? '' : ','}${registro}`);
      primerProducto = false;
    }

    await escribirFragmento(res, '],"historialProductos":[');

    let primerHistorial = true;
    const cursorHistorial = HistorialProducto.find({}).sort({ createdAt: 1 }).lean().cursor();
    for await (const registro of cursorHistorial) {
      await escribirFragmento(res, `${primerHistorial ? '' : ','}${JSON.stringify(registro)}`);
      primerHistorial = false;
    }

    await escribirFragmento(res, ']}');
    await finalizarEscritura(res);
  } catch (error) {
    console.error('Error al crear respaldo de inventario:', error);

    if (!res.headersSent) {
      return res.status(502).json({
        mensaje: 'No se pudo crear una copia completa del inventario',
        error: error.message,
      });
    }

    res.destroy(error);
  }
});

router.post(
  '/inventario/restaurar',
  proteger,
  soloAdmin,
  async (req, res) => {
    const fotosSubidas = [];
    let session;
    let cancelarLectura;

    try {
      if (!String(req.headers['content-type'] || '').startsWith('application/octet-stream')) {
        return res.status(415).json({ mensaje: 'El archivo de respaldo no tiene un formato válido' });
      }

      const resumenEsperado = {
        productos: Number(req.headers['x-respaldo-productos']),
        registrosHistorial: Number(req.headers['x-respaldo-historial']),
      };
      if (
        !Number.isSafeInteger(resumenEsperado.productos) ||
        !Number.isSafeInteger(resumenEsperado.registrosHistorial) ||
        resumenEsperado.productos < 0 ||
        resumenEsperado.registrosHistorial < 0
      ) {
        return res.status(400).json({ mensaje: 'El resumen del respaldo no es válido' });
      }

      const carpeta = `productos/restaurados/${Date.now()}`;
      const productosRestaurados = [];
      const historialRestaurado = [];
      const codigos = new Set();
      const lectores = await crearLectoresRestauracion(req);
      cancelarLectura = lectores.cancelar;

      await Promise.all([
        (async () => {
          for await (const { key, value } of lectores.productos) {
            const producto = validarProductoRespaldo(value, key, codigos);
            const datos = { ...producto.datos };

            if (producto.foto) {
              const resultado = await subirFotoRestaurada(producto.foto, carpeta);
              fotosSubidas.push(resultado.public_id);
              datos.imagenUrl = resultado.secure_url;
              datos.imagenPublicId = resultado.public_id;
              producto.foto.contenidoBase64 = null;
              value.foto.contenidoBase64 = null;
            }

            await new Producto(datos).validate();
            productosRestaurados.push(datos);
          }
        })(),
        (async () => {
          for await (const { value } of lectores.historial) {
            const datos = { ...value };
            await new HistorialProducto(datos).validate();
            historialRestaurado.push(datos);
          }
        })(),
      ]);
      cancelarLectura = null;

      validarResumenRestaurado(
        resumenEsperado.productos,
        productosRestaurados.length,
        'productos'
      );
      validarResumenRestaurado(
        resumenEsperado.registrosHistorial,
        historialRestaurado.length,
        'registros de historial'
      );

      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await HistorialProducto.deleteMany({}, { session });
        await Producto.deleteMany({}, { session });

        if (productosRestaurados.length) {
          await Producto.insertMany(productosRestaurados, { session });
        }
        if (historialRestaurado.length) {
          await HistorialProducto.insertMany(historialRestaurado, { session });
        }
      });

      sendEvent('productos', { accion: 'restauracion_completa' });

      return res.json({
        mensaje: 'Inventario restaurado correctamente',
        resumen: {
          productos: productosRestaurados.length,
          fotosRestauradas: fotosSubidas.length,
          registrosHistorial: historialRestaurado.length,
        },
      });
    } catch (error) {
      if (cancelarLectura) cancelarLectura();
      await eliminarFotosSubidas(fotosSubidas);
      console.error('Error al restaurar respaldo de inventario:', error);
      return res.status(500).json({
        mensaje: 'No se pudo restaurar la copia de seguridad',
        error: error.message,
      });
    } finally {
      if (session) await session.endSession();
    }
  }
);

module.exports = router;
