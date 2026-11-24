const esCostoEnvioValido = (valor) => {
  if (typeof valor !== 'number' && typeof valor !== 'string') return false;

  const texto = String(valor).trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(texto)) return false;

  const monto = Number(texto);
  return Number.isFinite(monto) && Number.isSafeInteger(Math.round(monto * 100));
};

module.exports = { esCostoEnvioValido };
