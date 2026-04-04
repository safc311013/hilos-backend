const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const { proteger } = require('../middleware/authMiddleware');

const router = express.Router();

const generarToken = (id) => {
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
  createdAt: usuario.createdAt,
  updatedAt: usuario.updatedAt,
});

router.get('/test', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'Ruta de auth funcionando correctamente',
  });
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({
        mensaje: 'Email y password son obligatorios',
      });
    }

    const usuario = await Usuario.findOne({ email });

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

    const passwordValido = await usuario.compararPassword(password);

    if (!passwordValido) {
      return res.status(401).json({
        mensaje: 'Credenciales inválidas',
      });
    }

    const token = generarToken(usuario._id);

    res.json({
      mensaje: 'Login exitoso',
      token,
      usuario: serializarUsuario(usuario),
    });
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al iniciar sesión',
      error: error.message,
    });
  }
});

/**
 * Devuelve el usuario autenticado a partir del token.
 * Muy útil para Android al abrir la app y restaurar sesión.
 */
router.get('/me', proteger, async (req, res) => {
  try {
    if (!req.usuario) {
      return res.status(401).json({
        mensaje: 'No autorizado',
      });
    }

    res.json({
      usuario: serializarUsuario(req.usuario),
    });
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al obtener usuario actual',
      error: error.message,
    });
  }
});

module.exports = router;