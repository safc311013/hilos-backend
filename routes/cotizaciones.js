const express = require('express');
const Cotizacion = require('../models/Cotizacion');
const { proteger } = require('../middleware/authMiddleware');
const { sendEvent } = require('../utils/sseManager');

const router = express.Router();

router.get('/', proteger, async (req, res) => {
  try {
    const cotizaciones = await Cotizacion.find().sort({ createdAt: -1 });
    res.json(cotizaciones);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener cotizaciones', error: error.message });
  }
});

router.post('/', proteger, async (req, res) => {
  try {
    const cotizacion = await Cotizacion.create(req.body);
    sendEvent('ventas', { accion: 'cotizacion_creada', cotizacion });
    res.status(201).json(cotizacion);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al crear cotización', error: error.message });
  }
});

router.put('/:id', proteger, async (req, res) => {
  try {
    const cotizacion = await Cotizacion.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!cotizacion) {
      return res.status(404).json({ mensaje: 'Cotización no encontrada' });
    }

    sendEvent('ventas', { accion: 'cotizacion_actualizada', cotizacion });
    res.json(cotizacion);
  } catch (error) {
    res.status(400).json({ mensaje: 'Error al actualizar cotización', error: error.message });
  }
});

router.delete('/:id', proteger, async (req, res) => {
  try {
    const cotizacion = await Cotizacion.findByIdAndDelete(req.params.id);

    if (!cotizacion) {
      return res.status(404).json({ mensaje: 'Cotización no encontrada' });
    }

    res.json({ mensaje: 'Cotización eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar cotización', error: error.message });
  }
});

module.exports = router;