const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const SesionUsuario = require('../models/SesionUsuario');

const cerrarSesionAuditada = async (token, motivoCierre, detalleCierre) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    if (!decoded?.sid) return;
    await SesionUsuario.findOneAndUpdate(
      { sesionId: decoded.sid, estado: 'activa' },
      { $set: { estado: 'cerrada', finAt: new Date(), motivoCierre, detalleCierre } }
    );
  } catch {
    // Un fallo de auditoría no debe ocultar la respuesta de autenticación.
  }
};

const proteger = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res
        .status(401)
        .json({
          mensaje: 'No autorizado, token no proporcionado',
          codigo: 'SESION_INVALIDA',
        });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const usuario = await Usuario.findById(decoded.id).select('-password');

    if (!usuario || !usuario.activo) {
      await cerrarSesionAuditada(
        token,
        'usuario_inactivo',
        usuario ? 'La cuenta fue desactivada.' : 'La cuenta ya no existe.'
      );
      return res.status(401).json({
        mensaje: 'Usuario inválido o inactivo',
        codigo: 'USUARIO_INACTIVO',
      });
    }

    req.usuario = usuario;
    next();
  } catch (error) {
    if (token) {
      await cerrarSesionAuditada(
        token,
        error?.name === 'TokenExpiredError' ? 'token_expirado' : 'error_autenticacion',
        error?.name === 'TokenExpiredError'
          ? 'La sesión expiró automáticamente.'
          : 'La aplicación rechazó la sesión por un error de autenticación.'
      );
    }
    return res.status(401).json({
      mensaje: error?.name === 'TokenExpiredError' ? 'Tu sesión venció' : 'Token inválido',
      codigo: error?.name === 'TokenExpiredError' ? 'SESION_VENCIDA' : 'SESION_INVALIDA',
    });
  }
};

const soloAdmin = (req, res, next) => {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ mensaje: 'Acceso denegado. Solo admin.' });
  }
  next();
};

const permitirRoles = (...rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ mensaje: 'No autorizado' });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        mensaje: 'No tienes permisos para realizar esta acción',
      });
    }

    next();
  };
};

const bloquearRoles = (...rolesBloqueados) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ mensaje: 'No autorizado' });
    }

    if (rolesBloqueados.includes(req.usuario.rol)) {
      return res.status(403).json({
        mensaje: 'No tienes permisos para realizar esta acción',
      });
    }

    next();
  };
};

module.exports = {
  proteger,
  soloAdmin,
  permitirRoles,
  bloquearRoles,
};
