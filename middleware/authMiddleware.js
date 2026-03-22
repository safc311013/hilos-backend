const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const normalizarRol = (rol = '') => String(rol || '').trim().toLowerCase();

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
        .json({ mensaje: 'No autorizado, token no proporcionado' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const usuario = await Usuario.findById(decoded.id).select('-password');

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ mensaje: 'Usuario inválido o inactivo' });
    }

    req.usuario = usuario;
    next();
  } catch (error) {
    return res.status(401).json({ mensaje: 'Token inválido' });
  }
};

const soloAdmin = (req, res, next) => {
  if (normalizarRol(req.usuario?.rol) !== 'admin') {
    return res.status(403).json({ mensaje: 'Acceso denegado. Solo admin.' });
  }
  next();
};

const permitirRoles = (...rolesPermitidos) => {
  const rolesNormalizados = rolesPermitidos.map(normalizarRol);

  return (req, res, next) => {
    const rolUsuario = normalizarRol(req.usuario?.rol);

    if (!rolesNormalizados.includes(rolUsuario)) {
      return res.status(403).json({
        mensaje: 'No tienes permisos para realizar esta acción',
      });
    }

    next();
  };
};

const bloquearRoles = (...rolesBloqueados) => {
  const rolesNormalizados = rolesBloqueados.map(normalizarRol);

  return (req, res, next) => {
    const rolUsuario = normalizarRol(req.usuario?.rol);

    if (rolesNormalizados.includes(rolUsuario)) {
      return res.status(403).json({
        mensaje: 'No tienes permisos para acceder a este módulo',
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