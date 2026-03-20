const express = require('express');
const Venta = require('../models/Venta');
const Producto = require('../models/Producto');
const { proteger } = require('../middleware/authMiddleware');

const router = express.Router();

const permitirAdminOSupervisor = (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ mensaje: 'No autorizado' });
  }

  if (!['admin', 'supervisor'].includes(req.usuario.rol)) {
    return res.status(403).json({ mensaje: 'No tienes permisos para esta acción' });
  }

  next();
};

router.get('/resumen', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const inicioManana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);

    const totalProductos = await Producto.countDocuments();
    const stockBajo = await Producto.countDocuments({
      $expr: { $lte: ['$stock', '$stockMinimo'] },
      activo: true,
    });

    const ventasHoy = await Venta.find({
      createdAt: { $gte: inicioHoy, $lt: inicioManana },
    });

    const totalVentasHoy = ventasHoy.reduce((acc, item) => acc + item.total, 0);

    const totalVentas = await Venta.aggregate([
      {
        $group: {
          _id: null,
          suma: { $sum: '$total' },
          cantidad: { $sum: 1 },
        },
      },
    ]);

    res.json({
      totalProductos,
      stockBajo,
      ventasHoy: ventasHoy.length,
      totalVentasHoy,
      totalHistorico: totalVentas[0]?.suma || 0,
      cantidadVentasHistoricas: totalVentas[0]?.cantidad || 0,
    });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al generar resumen', error: error.message });
  }
});

router.get('/por-fecha', proteger, permitirAdminOSupervisor, async (req, res) => {
  try {
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ mensaje: 'Debes proporcionar inicio y fin' });
    }

    const fechaInicio = new Date(`${inicio}T00:00:00`);
    const fechaFin = new Date(`${fin}T23:59:59`);

    const ventas = await Venta.find({
      createdAt: { $gte: fechaInicio, $lte: fechaFin },
    })
      .populate('usuario', 'nombre')
      .sort({ createdAt: -1 });

    const total = ventas.reduce((acc, venta) => acc + venta.total, 0);

    res.json({
      rango: { inicio, fin },
      totalVentas: total,
      cantidadVentas: ventas.length,
      ventas,
    });
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al consultar reporte', error: error.message });
  }
});

module.exports = router;