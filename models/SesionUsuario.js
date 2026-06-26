const mongoose = require('mongoose');

const sesionUsuarioSchema = new mongoose.Schema(
  {
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
    sesionId: { type: String, required: true, unique: true, index: true },
    nombreUsuario: { type: String, required: true, trim: true },
    emailUsuario: { type: String, required: true, lowercase: true, trim: true },
    rolUsuario: { type: String, required: true },
    plataforma: { type: String, enum: ['web', 'android', 'desktop'], default: 'web' },
    ip: { type: String, default: '' },
    ipServidor: { type: String, default: '' },
    ipPublicaCliente: { type: String, default: '' },
    dispositivoId: { type: String, default: '', index: true },
    dispositivoNombre: { type: String, default: '' },
    navegador: { type: String, default: '' },
    sistemaOperativo: { type: String, default: '' },
    idioma: { type: String, default: '' },
    zonaHoraria: { type: String, default: '' },
    pantalla: { type: String, default: '' },
    esDispositivoNuevo: { type: Boolean, default: false, index: true },
    esNuevaIpPublica: { type: Boolean, default: false, index: true },
    agenteUsuario: { type: String, default: '' },
    inicioAt: { type: Date, required: true, default: Date.now, index: true },
    expiraAt: { type: Date, default: null, index: true },
    finAt: { type: Date, default: null },
    estado: { type: String, enum: ['activa', 'cerrada'], default: 'activa', index: true },
    motivoCierre: {
      type: String,
      enum: ['salida_voluntaria', 'token_expirado', 'usuario_inactivo', 'error_autenticacion'],
      default: null,
    },
    detalleCierre: { type: String, default: '' },
  },
  { timestamps: true }
);

sesionUsuarioSchema.index({ inicioAt: -1, usuario: 1 });
sesionUsuarioSchema.index({ usuario: 1, dispositivoId: 1 });
sesionUsuarioSchema.index({ usuario: 1, ipPublicaCliente: 1 });

module.exports = mongoose.model('SesionUsuario', sesionUsuarioSchema);
