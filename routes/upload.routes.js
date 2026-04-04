const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { proteger, permitirRoles } = require('../middleware/authMiddleware');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 3 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp'];

    if (!tiposPermitidos.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
    }

    cb(null, true);
  },
});

router.post(
  '/producto',
  proteger,
  permitirRoles('admin', 'supervisor'),
  upload.single('imagen'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ mensaje: 'No se recibió ninguna imagen' });
      }

      const resultado = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'productos',
            resource_type: 'image',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );

        stream.end(req.file.buffer);
      });

      return res.json({
        url: resultado.secure_url,
        publicId: resultado.public_id,
      });
    } catch (error) {
      console.error('Error al subir imagen a Cloudinary:', error);
      return res.status(500).json({
        mensaje: 'No se pudo subir la imagen',
        error: error.message,
      });
    }
  }
);

module.exports = router;