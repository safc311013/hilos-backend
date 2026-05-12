const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { proteger } = require('../middleware/authMiddleware');

const router = express.Router();

const ROLES_APP_ANDROID = ['admin', 'supervisor'];

const generarToken = (id) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET no está configurado en el entorno');
  }

  return jwt.sign(
    { id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
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

const procesarLogin = async (req, res, { restringirParaAndroid = false } = {}) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({
        mensaje: 'Email y password son obligatorios',
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

    const token = generarToken(usuario._id);

    return res.json({
      mensaje: 'Login exitoso',
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
        mensaje: 'Debes enviar la contraseÃ±a actual y la nueva contraseÃ±a',
      });
    }

    if (nuevaPassword !== confirmarPassword) {
      return res.status(400).json({
        mensaje: 'La confirmaciÃ³n no coincide con la nueva contraseÃ±a',
      });
    }

    if (nuevaPassword.length < 6) {
      return res.status(400).json({
        mensaje: 'La nueva contraseÃ±a debe tener al menos 6 caracteres',
      });
    }

    if (passwordActual === nuevaPassword) {
      return res.status(400).json({
        mensaje: 'La nueva contraseÃ±a debe ser diferente a la temporal',
      });
    }

    const usuario = await Usuario.findById(req.usuario._id).select('+password');

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ mensaje: 'Usuario invÃ¡lido o inactivo' });
    }

    const passwordValido = await usuario.compararPassword(passwordActual);

    if (!passwordValido) {
      return res.status(401).json({
        mensaje: 'La contraseÃ±a actual no es correcta',
      });
    }

    usuario.password = nuevaPassword;
    usuario.debeCambiarPassword = false;
    usuario.passwordCambiadaAt = new Date();
    await usuario.save();

    return res.json({
      mensaje: 'ContraseÃ±a actualizada correctamente',
      usuario: serializarUsuario(usuario),
    });
  } catch (error) {
    console.error('Error al cambiar contraseÃ±a:', error);
    return res.status(500).json({
      mensaje: 'Error al cambiar contraseÃ±a',
      error: error.message,
    });
  }
});

module.exports = router;
