const express = require('express');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const router = express.Router();

const generarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
};

router.get('/test', (req, res) => {
  res.json({
    ok: true,
    mensaje: 'Ruta de auth funcionando correctamente',
  });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ mensaje: 'Email y password son obligatorios' });
    }

    const usuario = await Usuario.findOne({ email: email.toLowerCase() });

    if (!usuario) {
      return res.status(401).json({ mensaje: 'Credenciales inválidas' });
    }

    if (!usuario.activo) {
      return res.status(403).json({ mensaje: 'Usuario inactivo' });
    }

    const passwordValido = await usuario.compararPassword(password);

    if (!passwordValido) {
      return res.status(401).json({ mensaje: 'Credenciales inválidas' });
    }

    res.json({
      mensaje: 'Login exitoso',
      token: generarToken(usuario._id),
      usuario: {
        _id: usuario._id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
    });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al iniciar sesión', error: error.message });
  }
});

module.exports = router;