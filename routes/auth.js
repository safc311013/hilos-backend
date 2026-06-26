const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const Usuario = require('../models/Usuario');
const SesionUsuario = require('../models/SesionUsuario');
const { proteger } = require('../middleware/authMiddleware');
const { calcularExpiraAt } = require('../utils/sessionExpiration');

const router = express.Router();

const ROLES_APP_ANDROID = ['admin', 'supervisor'];

const generarToken = (id, sesionId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET no está configurado en el entorno');
  }

  return jwt.sign(
    { id, sid: sesionId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '16h' }
  );
};

const serializarUsuario = (usuario) => ({
  _id: usuario._id,
  nombre: usuario.nombre,
  email: usuario.email,
  rol: usuario.rol,
  activo: usuario.activo,
  debeCambiarPassword: Boolean(usuario.debeCambiarPassword),
  passwordCambiadaAt: usuario.passwordCambiadaAt,
  restablecidoAt: usuario.restablecidoAt,
  createdAt: usuario.createdAt,
  updatedAt: usuario.updatedAt,
});

const puedeEntrarAppAndroid = (usuario) => {
  return ROLES_APP_ANDROID.includes(usuario.rol);
};

const obtenerIp = (req) => {
  const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return reenviada || req.ip || req.socket?.remoteAddress || '';
};

const limpiarIp = (valor) => {
  const ip = String(valor || '').trim();
  return ip.length <= 80 ? ip : '';
};

const limpiarTexto = (valor, limite = 120) => {
  return String(valor || '').trim().slice(0, limite);
};

const obtenerInfoDispositivo = (body = {}) => {
  const dispositivo = body.dispositivo && typeof body.dispositivo === 'object'
    ? body.dispositivo
    : {};

  return {
    dispositivoId: limpiarTexto(dispositivo.id, 120),
    dispositivoNombre: limpiarTexto(dispositivo.nombre, 120),
    navegador: limpiarTexto(dispositivo.navegador, 120),
    sistemaOperativo: limpiarTexto(dispositivo.sistemaOperativo, 120),
    idioma: limpiarTexto(dispositivo.idioma, 40),
    zonaHoraria: limpiarTexto(dispositivo.zonaHoraria, 80),
    pantalla: limpiarTexto(dispositivo.pantalla, 40),
  };
};

const detectarAlertasAcceso = async (usuarioId, { dispositivoId, ipPublicaCliente }) => {
  const sesionesPrevias = await SesionUsuario.find({ usuario: usuarioId })
    .select('dispositivoId ipPublicaCliente')
    .sort({ inicioAt: -1 })
    .limit(100)
    .lean();

  if (sesionesPrevias.length === 0) {
    return {
      esDispositivoNuevo: false,
      esNuevaIpPublica: false,
    };
  }

  return {
    esDispositivoNuevo: Boolean(dispositivoId)
      && !sesionesPrevias.some((sesion) => sesion.dispositivoId === dispositivoId),
    esNuevaIpPublica: Boolean(ipPublicaCliente)
      && !sesionesPrevias.some((sesion) => sesion.ipPublicaCliente === ipPublicaCliente),
  };
};

const procesarLogin = async (req, res, { restringirParaAndroid = false } = {}) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({
        mensaje: 'El correo y la contraseña son obligatorios',
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        mensaje: 'Falta configurar JWT_SECRET en el backend',
      });
    }

    const usuario = await Usuario.findOne({ email }).select('+password');

    if (!usuario) {
      return res.status(401).json({
        mensaje: 'Credenciales inválidas',
      });
    }

    if (!usuario.activo) {
      return res.status(403).json({
        mensaje: 'Usuario inactivo',
      });
    }

    if (typeof usuario.compararPassword !== 'function') {
      console.error('El modelo Usuario no tiene el método compararPassword');
      return res.status(500).json({
        mensaje: 'Error interno de autenticación',
      });
    }

    const passwordValido = await usuario.compararPassword(password);

    if (!passwordValido) {
      return res.status(401).json({
        mensaje: 'Credenciales inválidas',
      });
    }

    if (restringirParaAndroid && !puedeEntrarAppAndroid(usuario)) {
      return res.status(403).json({
        mensaje: 'Solo administradores y supervisores pueden iniciar sesión en la app Android',
      });
    }

    const sesionId = randomUUID();
    const inicioAt = new Date();
    const plataformaSolicitada = String(req.body.plataforma || '').toLowerCase();
    const plataforma = restringirParaAndroid
      ? 'android'
      : plataformaSolicitada === 'desktop'
        ? 'desktop'
        : 'web';
    const ipServidor = limpiarIp(obtenerIp(req));
    const ipPublicaCliente = limpiarIp(req.body.ipPublicaCliente);
    const dispositivo = obtenerInfoDispositivo(req.body);
    const alertasAcceso = await detectarAlertasAcceso(usuario._id, {
      dispositivoId: dispositivo.dispositivoId,
      ipPublicaCliente,
    });

    await SesionUsuario.create({
      usuario: usuario._id,
      sesionId,
      nombreUsuario: usuario.nombre,
      emailUsuario: usuario.email,
      rolUsuario: usuario.rol,
      plataforma,
      ip: ipPublicaCliente || ipServidor,
      ipServidor,
      ipPublicaCliente,
      ...dispositivo,
      ...alertasAcceso,
      agenteUsuario: String(req.headers['user-agent'] || '').slice(0, 500),
      inicioAt,
      expiraAt: calcularExpiraAt(inicioAt),
    });

    const token = generarToken(usuario._id, sesionId);

    return res.json({
      mensaje: 'Inicio de sesión exitoso',
      token,
      usuario: serializarUsuario(usuario),
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({
      mensaje: 'Error al iniciar sesión',
      error: error.message,
    });
  }
};

router.get('/test', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'Ruta de auth funcionando correctamente',
  });
});

/**
 * LOGIN WEB
 * Se queda como siempre.
 */
router.post('/login', async (req, res) => {
  return procesarLogin(req, res, { restringirParaAndroid: false });
});

/**
 * LOGIN APP ANDROID
 * Solo permite admin y supervisor.
 */
router.post('/login-app', async (req, res) => {
  return procesarLogin(req, res, { restringirParaAndroid: true });
});

router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : '';
    const decoded = token
      ? jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true })
      : null;

    if (decoded?.sid) {
      await SesionUsuario.findOneAndUpdate(
        { sesionId: decoded.sid, estado: 'activa' },
        {
          $set: {
            estado: 'cerrada',
            finAt: new Date(),
            motivoCierre: 'salida_voluntaria',
            detalleCierre: 'El usuario utilizó el botón Cerrar sesión.',
          },
        }
      );
    }

    return res.json({ mensaje: 'Sesión cerrada correctamente' });
  } catch {
    return res.status(500).json({ mensaje: 'No se pudo registrar el cierre de sesión' });
  }
});

/**
 * Devuelve el usuario autenticado a partir del token.
 */
router.get('/me', proteger, async (req, res) => {
  try {
    if (!req.usuario) {
      return res.status(401).json({
        mensaje: 'No autorizado',
      });
    }

    return res.json({
      usuario: serializarUsuario(req.usuario),
    });
  } catch (error) {
    console.error('Error en /api/auth/me:', error);
    return res.status(500).json({
      mensaje: 'Error al obtener usuario actual',
      error: error.message,
    });
  }
});

router.post('/cambiar-password', proteger, async (req, res) => {
  try {
    const passwordActual = String(req.body.passwordActual || '');
    const nuevaPassword = String(req.body.nuevaPassword || '');
    const confirmarPassword = String(req.body.confirmarPassword || '');

    if (!passwordActual || !nuevaPassword || !confirmarPassword) {
      return res.status(400).json({
        mensaje: 'Debes enviar la contraseña actual y la nueva contraseña',
      });
    }

    if (nuevaPassword !== confirmarPassword) {
      return res.status(400).json({
        mensaje: 'La confirmación no coincide con la nueva contraseña',
      });
    }

    if (nuevaPassword.length < 6) {
      return res.status(400).json({
        mensaje: 'La nueva contraseña debe tener al menos 6 caracteres',
      });
    }

    if (passwordActual === nuevaPassword) {
      return res.status(400).json({
        mensaje: 'La nueva contraseña debe ser diferente a la temporal',
      });
    }

    const usuario = await Usuario.findById(req.usuario._id).select('+password');

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ mensaje: 'Usuario inválido o inactivo' });
    }

    const passwordValido = await usuario.compararPassword(passwordActual);

    if (!passwordValido) {
      return res.status(401).json({
        mensaje: 'La contraseña actual no es correcta',
      });
    }

    usuario.password = nuevaPassword;
    usuario.debeCambiarPassword = false;
    usuario.passwordCambiadaAt = new Date();
    await usuario.save();

    return res.json({
      mensaje: 'Contraseña actualizada correctamente',
      usuario: serializarUsuario(usuario),
    });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    return res.status(500).json({
      mensaje: 'Error al cambiar contraseña',
      error: error.message,
    });
  }
});

module.exports = router;
