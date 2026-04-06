const mongoose = require('mongoose');

const cambioCampoSchema = new mongoose.Schema(
  {
    campo: {
      type: String,
      required: true,
      trim: true,
    },
    antes: {
      type: String,
      default: '',
      trim: true,
    },
    despues: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
);

const actorSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usuario',
      required: false,
    },
    nombre: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    rol: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const historialProductoSchema = new mongoose.Schema(
  {
    productoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Producto',
      required: true,
      index: true,
    },
    codigo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    nombreProducto: {
      type: String,
      required: true,
      trim: true,
    },
    tipo: {
      type: String,
      enum: ['CREACION', 'EDICION', 'ELIMINACION'],
      required: true,
      index: true,
    },
    detalle: {
      type: String,
      default: '',
      trim: true,
    },
    cambios: {
      type: [cambioCampoSchema],
      default: [],
    },
    actor: {
      type: actorSchema,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

historialProductoSchema.index({ codigo: 1, createdAt: -1 });
historialProductoSchema.index({ productoId: 1, createdAt: -1 });

module.exports = mongoose.model('HistorialProducto', historialProductoSchema);
