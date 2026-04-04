require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const Usuario = require('./models/Usuario');
const { addClient, removeClient } = require('./utils/sseManager');

const authRoutes = require('./routes/auth');
const productosRoutes = require('./routes/productos');
const usuariosRoutes = require('./routes/usuarios');
const ventasRoutes = require('./routes/ventas');
const reportesRoutes = require('./routes/reportes');
const cotizacionesRoutes = require('./routes/cotizaciones');
const uploadRoutes = require('./routes/upload.routes');

const app = express();

/**
 * CORS flexible para no romper frontend web ni desarrollo local.
 *
 * Permite:
 * - orígenes configurados por variables
 * - localhost para desarrollo
 * - cualquier subdominio de netlify.app
 * - peticiones sin origin (Postman, apps móviles, curl)
 */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
].filter(Boolean);

const esOrigenNetlifyValido = (origin) => {
  try {
    const url = new URL(origin);
    return url.hostname.endsWith('.netlify.app');
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite Postman, curl, apps móviles nativas, etc.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Permite sitios publicados en Netlify
      if (esOrigenNetlifyValido(origin)) {
        return callback(null, true);
      }

      console.warn(`CORS bloqueó el origen: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

let isConnected = false;
let connectionPromise = null;

async function conectarMongo() {
  if (isConnected) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
      isConnected = true;
      console.log('MongoDB conectado correctamente');
    })
    .catch((error) => {
      connectionPromise = null;
      console.error('Error al conectar MongoDB:', error.message);
      throw error;
    });

  return connectionPromise;
}

app.get('/', (req, res) => {
  res.json({ mensaje: 'API Hilos funcionando correctamente' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mensaje: 'Backend activo' });
});

app.use(async (req, res, next) => {
  try {
    await conectarMongo();
    next();
  } catch (error) {
    res.status(500).json({
      mensaje: 'Error al conectar con la base de datos',
      error: error.message,
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/cotizaciones', cotizacionesRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/realtime/events', async (req, res) => {
  try {
    const token = req.query.token;

    if (!token) {
      return res.status(401).json({ mensaje: 'Token requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const usuario = await Usuario.findById(decoded.id).select('-password');

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ mensaje: 'Usuario inválido o inactivo' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        mensaje: 'Conectado a SSE',
      })}\n\n`
    );

    addClient(res);

    req.on('close', () => {
      removeClient(res);
    });
  } catch (error) {
    res.status(401).json({ mensaje: 'Token inválido para SSE' });
  }
});

const PORT = process.env.PORT || 5000;

if (process.env.VERCEL !== '1') {
  conectarMongo()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error('No se pudo iniciar el servidor:', error.message);
      process.exit(1);
    });
}

module.exports = app;