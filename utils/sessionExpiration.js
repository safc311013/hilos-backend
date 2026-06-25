const DEFAULT_SESSION_MS = 16 * 60 * 60 * 1000;

const parseExpiresInToMs = (value = process.env.JWT_EXPIRES_IN || '16h') => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 1000;
  }

  const texto = String(value || '').trim().toLowerCase();
  if (!texto) return DEFAULT_SESSION_MS;

  if (/^\d+$/.test(texto)) {
    return Number(texto) * 1000;
  }

  const match = texto.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/);
  if (!match) return DEFAULT_SESSION_MS;

  const cantidad = Number(match[1]);
  const unidad = match[2];
  const multiplicadores = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return cantidad * multiplicadores[unidad];
};

const calcularExpiraAt = (inicioAt = new Date()) => {
  return new Date(new Date(inicioAt).getTime() + parseExpiresInToMs());
};

module.exports = {
  calcularExpiraAt,
  parseExpiresInToMs,
};
