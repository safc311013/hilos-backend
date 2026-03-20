const mongoose = require('mongoose');

const detalleCotizacionSchema = new mongoose.Schema(
  {
    nombreProducto: {
      type: String,
      required: true,
    },
    cantidad: {
      type: Number,
      required: true,
      min: 1,
    },
    precioUnitario: {
      type: Number,
      required: true,
      min: 0,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const cotizacionSchema = new mongoose.Schema(
  {
    cliente: {
      type: String,
      required: true,
      trim: true,
    },
    telefono: {
      type: String,
      default: '',
      trim: true,
    },
    notas: {
      type: String,
      default: '',
      trim: true,
    },
    productos: {
      type: [detalleCotizacionSchema],
      required: true,
      validate: [(arr) => arr.length > 0, 'La cotización debe incluir productos'],
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    estatus: {
      type: String,
      enum: ['pendiente', 'aprobada', 'rechazada'],
      default: 'pendiente',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cotizacion', cotizacionSchema);