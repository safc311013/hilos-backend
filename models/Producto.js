const mongoose = require('mongoose');

const productoSchema = new mongoose.Schema(
  {
    codigo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    nombre: {
      type: String,
      required: true,
      trim: true,
    },
    categoria: {
      type: String,
      default: 'General',
      trim: true,
    },
    costoArtesano: {
      type: Number,
      required: true,
      min: 0,
    },
    precio: {
      type: Number,
      required: true,
      min: 0,
    },
    stockTaxco: {
      type: Number,
      min: 0,
      default: 0,
    },
    stockTienda: {
      type: Number,
      min: 0,
      default: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    stockMinimo: {
      type: Number,
      default: 3,
      min: 0,
      immutable: true,
    },
    activo: {
      type: Boolean,
      default: true,
    },
    inventario: {
      type: String,
      enum: ['taxco', 'tienda'],
      default: 'tienda',
      trim: true,
      lowercase: true,
    },
    imagenUrl: {
      type: String,
      default: '',
      trim: true,
    },
    imagenPublicId: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

// Índices útiles para filtros y orden en catálogo / inventario
productoSchema.pre('validate', function sincronizarStockInventarios(next) {
  const stockLegacy = Number(this.stock || 0);
  const taxcoDefinido = this.stockTaxco !== undefined && this.stockTaxco !== null;
  const tiendaDefinido = this.stockTienda !== undefined && this.stockTienda !== null;

  if (!taxcoDefinido && !tiendaDefinido && stockLegacy > 0) {
    if (this.inventario === 'taxco') {
      this.stockTaxco = stockLegacy;
      this.stockTienda = 0;
    } else {
      this.stockTaxco = 0;
      this.stockTienda = stockLegacy;
    }
  }

  this.stockTaxco = Math.max(Number(this.stockTaxco || 0), 0);
  this.stockTienda = Math.max(Number(this.stockTienda || 0), 0);
  this.stock = this.stockTaxco + this.stockTienda;

  next();
});

productoSchema.index({ activo: 1, stock: 1, nombre: 1 });
productoSchema.index({ categoria: 1, nombre: 1 });
productoSchema.index({ categoria: 1, codigo: 1 });
productoSchema.index({ stock: 1, codigo: 1 });
productoSchema.index({ inventario: 1, stock: 1 });
productoSchema.index({ nombre: 1 });
productoSchema.index({ categoria: 1 });

// El índice unique de codigo ya lo genera Mongoose/Mongo,
// así que no hace falta repetirlo manualmente.

module.exports = mongoose.model('Producto', productoSchema);
