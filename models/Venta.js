const mongoose = require('mongoose');

const detalleVentaSchema = new mongoose.Schema(
  {
    producto: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Producto',
      required: true,
    },
    codigoProducto: {
      type: String,
      default: '',
      trim: true,
    },
    nombreProducto: {
      type: String,
      required: true,
      trim: true,
    },
    categoriaProducto: {
      type: String,
      default: '',
      trim: true,
    },
    pieza: {
      type: String,
      default: '',
      trim: true,
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
    descuentoPorcentaje: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    descuentoMonto: {
      type: Number,
      default: 0,
      min: 0,
    },
    subtotalBruto: {
      type: Number,
      default: 0,
      min: 0,
    },
    subtotalFinal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const cotizacionRelacionadaSchema = new mongoose.Schema(
  {
    cliente: {
      type: String,
      default: '',
      trim: true,
    },
    fechaCotizacion: {
      type: String,
      default: '',
      trim: true,
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
    totalCotizacion: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const ventaSchema = new mongoose.Schema(
  {
    folio: {
      type: String,
      required: true,
      unique: true,
    },
    productos: {
      type: [detalleVentaSchema],
      required: true,
      validate: [(arr) => arr.length > 0, 'La venta debe incluir productos'],
    },
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    descuentoTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    metodoPago: {
      type: String,
      enum: ['efectivo', 'tarjeta', 'transferencia'],
      default: 'efectivo',
    },
    origenCotizacion: {
      type: Boolean,
      default: false,
    },
    cotizacion: {
      type: cotizacionRelacionadaSchema,
      default: () => ({}),
    },
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usuario',
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Venta', ventaSchema);