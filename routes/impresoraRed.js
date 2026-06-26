const express = require('express');
const net = require('net');

const router = express.Router();

const validarDestino = (ip, puerto) => {
  const ipLimpia = String(ip || '').trim();
  const puertoNumero = Number(puerto);

  if (net.isIP(ipLimpia) !== 4) {
    throw new Error('Escribe una dirección IPv4 válida.');
  }

  if (!Number.isInteger(puertoNumero) || puertoNumero < 1 || puertoNumero > 65535) {
    throw new Error('El puerto de la impresora no es válido.');
  }

  return { ip: ipLimpia, puerto: puertoNumero };
};

const enviarAImpresora = ({ ip, puerto, datos }) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: puerto });
    let terminado = false;

    const fallar = (error) => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      reject(new Error(`No se pudo conectar con ${ip}:${puerto}. ${error.message}`));
    };

    socket.setTimeout(5000);
    socket.once('error', fallar);
    socket.once('timeout', () => fallar(new Error('Tiempo de espera agotado.')));
    socket.once('connect', () => {
      if (!datos) {
        terminado = true;
        socket.end();
        resolve();
        return;
      }

      socket.end(datos, () => {
        if (terminado) return;
        terminado = true;
        resolve();
      });
    });
  });

router.post('/probar', async (req, res) => {
  try {
    const destino = validarDestino(req.body?.ip, req.body?.puerto);
    await enviarAImpresora(destino);
    res.json({ mensaje: 'Conexión correcta con la impresora.' });
  } catch (error) {
    res.status(400).json({ mensaje: error.message });
  }
});

router.post('/imprimir', async (req, res) => {
  try {
    const destino = validarDestino(req.body?.ip, req.body?.puerto);
    const texto = String(req.body?.texto || '').slice(0, 100000);
    const copias = Math.min(Math.max(Number(req.body?.copias) || 1, 1), 3);

    if (!texto.trim()) {
      throw new Error('El ticket está vacío.');
    }

    const inicio = Buffer.from([0x1b, 0x40]);
    // TSP143IIILAN usa Star Line Mode: ESC d 2 alimenta y corta el papel.
    const corte = Buffer.from([0x1b, 0x64, 0x02]);
    const contenido = Buffer.concat(
      Array.from({ length: copias }, () =>
        Buffer.concat([inicio, Buffer.from(`${texto}\n`, 'ascii'), corte])
      )
    );

    await enviarAImpresora({ ...destino, datos: contenido });
    res.json({ mensaje: 'Ticket enviado a la impresora.' });
  } catch (error) {
    res.status(400).json({ mensaje: error.message });
  }
});

module.exports = router;
