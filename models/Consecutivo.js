const mongoose = require('mongoose');

const consecutivoSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    prefijo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    fecha: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    ultimoNumero: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model('Consecutivo', consecutivoSchema);