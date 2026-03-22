const mongoose = require('mongoose');

const detalleCotizacionSchema = new mongoose.Schema(
  {
    productoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Producto',
      default: null,
    },
    nombreProducto: {
      type: String,
      required: true,
      trim: true,
    },
    codigo: {
      type: String,
      default: '',
      trim: true,
    },
    categoria: {
      type: String,
      default: '',
      trim: true,
    },
    imagenUrl: {
      type: String,
      default: '',
      trim: true,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
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

    // Campos para COMPRA
    descuento: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // Campos para CONSIGNACION
    incrementoPorcentaje: {
      type: Number,
      default: 0,
      min: 0,
    },
    comisionClientePorcentaje: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // Totales de línea
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalLinea: {
      type: Number,
      default: 0,
      min: 0,
    },
    precioRedondeado: {
      type: Number,
      default: 0,
      min: 0,
    },
    valorComisionCliente: {
      type: Number,
      default: 0,
      min: 0,
    },
    gananciaHilos: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalGananciaCliente: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalGananciaHilos: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const cotizacionSchema = new mongoose.Schema(
  {
    folio: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true,
    },
    tipo: {
      type: String,
      enum: ['COMPRA', 'CONSIGNACION'],
      required: true,
      uppercase: true,
      trim: true,
    },
    formato: {
      type: String,
      enum: ['ventas', 'consignaciones'],
      required: true,
      trim: true,
    },

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
    fechaCotizacion: {
      type: Date,
      required: true,
      default: Date.now,
    },
    vigencia: {
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
      alias: 'items',
      validate: [
        (arr) => Array.isArray(arr) && arr.length > 0,
        'La cotización debe incluir productos',
      ],
    },

    totalPiezas: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    totalGananciaCliente: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalGananciaHilos: {
      type: Number,
      default: 0,
      min: 0,
    },

    estatus: {
      type: String,
      enum: ['pendiente', 'aprobada', 'rechazada'],
      default: 'pendiente',
    },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('Cotizacion', cotizacionSchema);