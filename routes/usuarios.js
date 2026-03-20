const express = require('express');
const Usuario = require('../models/Usuario');
const { proteger, soloAdmin } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');

const router = express.Router();

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
      return res.status(400).json({ mensaje: 'Ya existe un usuario con ese email' });
    }

    const usuario = await Usuario.create({
      ...req.body,
      email: emailNormalizado,
    });

    const usuarioSinPassword = await Usuario.findById(usuario._id).select('-password');
    sendEvent('usuarios', { accion: 'crear', usuario: usuarioSinPassword });

    res.status(201).json(usuarioSinPassword);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al crear usuario', error: error.message });
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
        return res.status(400).json({ mensaje: 'Ya existe un usuario con ese email' });
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