require('dotenv').config();
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const existe = await Usuario.findOne({ email: 'admin@hilos.local' });

    if (existe) {
      console.log('El usuario admin ya existe');
      process.exit(0);
    }

    const admin = await Usuario.create({
      nombre: 'Administrador',
      email: 'admin@hilos.local',
      password: 'Kalito22',
      rol: 'admin',
      activo: true,
    });

    console.log('Admin creado:', admin.email);
    process.exit(0);
  } catch (error) {
    console.error('Error al crear admin:', error.message);
    process.exit(1);
  }
};

seedAdmin();