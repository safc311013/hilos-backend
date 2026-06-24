const express = require('express');
const Usuario = require('../models/Usuario');
const SesionUsuario = require('../models/SesionUsuario');
const { proteger, soloAdmin } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');

const router = express.Router();

const serializarUsuario = (usuario) => {
  const obj = typeof usuario.toObject === 'function' ? usuario.toObject() : usuario;
  const { password, ...sinPassword } = obj;
  return sinPassword;
};

router.get('/', proteger, soloAdmin, async (req, res) => {
  try {
    const usuarios = await Usuario.find().select('-password').sort({ createdAt: -1 });
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener usuarios', error: error.message });
  }
});

router.post('/', proteger, soloAdmin, async (req, res) => {
  try {
    const emailNormalizado = req.body.email?.toLowerCase().trim();

    const existe = await Usuario.findOne({ email: emailNormalizado });
    if (existe) {
      return res.status(400).json({ mensaje: 'Ya existe un usuario con ese correo' });
    }

    const passwordTemporal = String(req.body.password || '').trim();

    if (passwordTemporal.length < 6) {
      return res.status(400).json({
        mensaje: 'La contraseña temporal debe tener al menos 6 caracteres',
      });
    }

    const usuario = await Usuario.create({
      nombre: String(req.body.nombre || '').trim(),
      email: emailNormalizado,
      password: passwordTemporal,
      rol: req.body.rol || 'cajero',
      activo: req.body.activo ?? true,
      debeCambiarPassword: true,
      passwordCambiadaAt: null,
      restablecidoAt: null,
    });

    const usuarioSinPassword = await Usuario.findById(usuario._id).select('-password');
    sendEvent('usuarios', { accion: 'crear', usuario: usuarioSinPassword });

    res.status(201).json(usuarioSinPassword);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al crear usuario', error: error.message });
  }
});

router.get('/historial-sesiones', proteger, soloAdmin, async (req, res) => {
  try {
    const filtro = {};
    if (req.query.usuarioId) filtro.usuario = req.query.usuarioId;
    if (req.query.motivo === 'activa') filtro.estado = 'activa';
    if (req.query.motivo && !['todas', 'activa'].includes(req.query.motivo)) {
      filtro.motivoCierre = req.query.motivo;
    }

    const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 500);
    const sesiones = await SesionUsuario.find(filtro).sort({ inicioAt: -1 }).limit(limite).lean();
    res.json(sesiones);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener el historial de sesiones', error: error.message });
  }
});

router.post('/:id/restablecer', proteger, soloAdmin, async (req, res) => {
  try {
    const passwordTemporal = String(req.body.password || '').trim();

    if (passwordTemporal.length < 6) {
      return res.status(400).json({
        mensaje: 'La contraseña temporal debe tener al menos 6 caracteres',
      });
    }

    const usuario = await Usuario.findById(req.params.id).select('+password');

    if (!usuario) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    usuario.password = passwordTemporal;
    usuario.debeCambiarPassword = true;
    usuario.passwordCambiadaAt = null;
    usuario.restablecidoAt = new Date();
    usuario.activo = true;
    await usuario.save();

    const usuarioSinPassword = serializarUsuario(usuario);
    sendEvent('usuarios', { accion: 'restablecer', usuario: usuarioSinPassword });

    res.json(usuarioSinPassword);
  } catch (error) {
    res.status(400).json({
      mensaje: 'Error al restablecer usuario',
      error: error.message,
    });
  }
});

router.put('/:id', proteger, soloAdmin, async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.password;

    if (data.email) {
      data.email = data.email.toLowerCase().trim();

      const existe = await Usuario.findOne({
        email: data.email,
        _id: { $ne: req.params.id },
      });

      if (existe) {
        return res.status(400).json({ mensaje: 'Ya existe un usuario con ese correo' });
      }
    }

    const usuario = await Usuario.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    }).select('-password');

    if (!usuario) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    sendEvent('usuarios', { accion: 'actualizar', usuario });
    res.json(usuario);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al actualizar usuario', error: error.message });
  }
});

router.delete('/:id', proteger, soloAdmin, async (req, res) => {
  try {
    const usuario = await Usuario.findByIdAndDelete(req.params.id);

    if (!usuario) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    sendEvent('usuarios', { accion: 'eliminar', usuarioId: req.params.id });
    res.json({ mensaje: 'Usuario eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar usuario', error: error.message });
  }
});

module.exports = router;
