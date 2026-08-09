// ============================================================
// UTILS — tiny DOM helpers with zero local imports
// ============================================================

export function setStatus(type, msg) {
  const dot = document.getElementById('sDot');
  const txt = document.getElementById('sTxt');
  if (dot) dot.className = 'status-dot ' + type;
  if (txt) txt.textContent = msg;
}

export function showErr(msg) {
  const b = document.getElementById('errBox');
  if (!b) return;
  b.style.display = msg ? 'block' : 'none';
  b.textContent = msg;
}

export function setLsMsg(text) {
  const el = document.getElementById('lsMsg');
  if (el) el.textContent = text;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Classify data/bootstrap errors into a user-facing Spanish dialog payload.
 * @param {unknown} err
 * @returns {{ kind: string, title: string, cause: string, steps: string[], technical: string, canRetry: boolean }}
 */
export function classifyDataError(err) {
  const kind = err?.kind || '';
  const status = err?.status;
  const msg = String(err?.message || err || '');
  const technical = err?.raw || msg;

  if (
    kind === 'blocked'
    || status === 401
    || status === 403
    || /Access blocked \(40[13]\)|API \/datos error 40[13]|error 40[13]/i.test(msg)
  ) {
    return {
      kind: 'blocked',
      title: 'Acceso bloqueado al cargar datos',
      cause:
        'La red o el hosting rechazó la petición (filtro anti-bot de Vercel, VPN/proxy corporativo, '
        + 'o un link de preview protegido). '
        + 'No significa que falten datos del banco (BTG Brasil, Itaú Uruguay, etc. están en la base).',
      steps: [
        'Abrí https://www.latambanks.co (con www) — no uses un link de preview/PR.',
        'Hard-refresh: Ctrl+Shift+R (Cmd+Shift+R en Mac).',
        'Desactivá VPN o proxy corporativo y volvé a intentar.',
        'Probá otra red (p. ej. datos móviles) si seguís bloqueado.',
      ],
      technical,
      canRetry: true,
    };
  }

  if (kind === 'cors' || /not allowed by cors|origin is not allowed/i.test(msg)) {
    return {
      kind: 'cors',
      title: 'Origen no permitido',
      cause: 'Esta página no está autorizada para llamar a la API de LatamBanks.',
      steps: [
        'Entrá por https://www.latambanks.co',
        'En desarrollo local usá http://localhost (con la API en el puerto 3000).',
      ],
      technical,
      canRetry: false,
    };
  }

  if (
    kind === 'timeout'
    || err?.name === 'AbortError'
    || /timed out after|took too long/i.test(msg)
  ) {
    return {
      kind: 'timeout',
      title: 'La consulta tardó demasiado',
      cause: 'El servidor no respondió a tiempo (límite ~28–30 s). Suele pasar con rangos From/To muy amplios o muchos bancos en comparación.',
      steps: [
        'Acortá el rango From / To (p. ej. últimos 12–18 meses).',
        'En Compare, seleccioná menos bancos (máx. 5).',
        'Reintentá en unos segundos.',
      ],
      technical,
      canRetry: true,
    };
  }

  if (kind === 'gateway' || status === 502 || status === 504 || /gateway timeout|API gateway/i.test(msg)) {
    return {
      kind: 'gateway',
      title: 'El servidor se saturó',
      cause: 'La API cortó la consulta por tiempo o carga (502/504). Los datos del banco existen; la petición fue demasiado pesada para un solo intento.',
      steps: [
        'Reducí el rango de períodos o la cantidad de bancos.',
        'Esperá unos segundos y reintentá.',
      ],
      technical,
      canRetry: true,
    };
  }

  if (
    kind === 'network'
    || /Failed to fetch|NetworkError|Load failed|network request failed/i.test(msg)
  ) {
    return {
      kind: 'network',
      title: 'Sin conexión con el servidor',
      cause: 'El navegador no pudo completar la petición (red, DNS o bloqueo). No es que falten datos del banco en la base.',
      steps: [
        'Confirmá que estás en https://www.latambanks.co (con www).',
        'Revisá Wi‑Fi / datos móviles y reintentá.',
        'Si usás VPN o proxy corporativo, probá sin él.',
      ],
      technical,
      canRetry: true,
    };
  }

  // Client-side bugs must not look like "the server failed".
  if (
    err?.name === 'TypeError'
    || err?.name === 'ReferenceError'
    || err?.name === 'RangeError'
    || /Cannot read propert|is not a function|is not defined/i.test(msg)
  ) {
    return {
      kind: 'client',
      title: 'Error al procesar los datos en pantalla',
      cause:
        'La petición pudo haber llegado, pero falló el render en el navegador. '
        + 'Hard-refresh suele bastar; si se repite, compartí el detalle técnico.',
      steps: [
        'Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).',
        'Confirmá que estás en https://www.latambanks.co',
        'Compartí el detalle técnico con el equipo.',
      ],
      technical,
      canRetry: true,
    };
  }

  const statusBit = status != null ? ` (HTTP ${status})` : '';
  return {
    kind: 'http',
    title: 'No se pudieron cargar los datos',
    cause: `Falló la petición al servidor${statusBit}. Revisá el detalle técnico para ver qué endpoint falló (bootstrap o /api/datos b1/r1/c1).`,
    steps: [
      'Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).',
      'Confirmá que estás en https://www.latambanks.co',
      'Si se repite, compartí el detalle técnico de abajo.',
    ],
    technical: technical || msg || '(sin detalle)',
    canRetry: true,
  };
}

let _errDialogMounted = false;
let _errDialogOnRetry = null;

function ensureErrorDialog() {
  if (_errDialogMounted) return;
  const el = document.createElement('div');
  el.id = 'appErrorModal';
  el.className = 'app-error-overlay';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="app-error-dialog" role="dialog" aria-modal="true" aria-labelledby="appErrorTitle">
      <div class="app-error-head">
        <div>
          <div class="app-error-eyebrow">LatamBanks · error de carga</div>
          <div id="appErrorTitle" class="app-error-title">No se pudieron cargar los datos</div>
        </div>
        <button type="button" class="app-error-close" id="appErrorClose" aria-label="Cerrar">×</button>
      </div>
      <div class="app-error-body">
        <div class="app-error-label">Qué pasó</div>
        <p id="appErrorCause" class="app-error-cause"></p>
        <div class="app-error-label">Cómo resolverlo</div>
        <ol id="appErrorSteps" class="app-error-steps"></ol>
        <details class="app-error-tech" open>
          <summary>Detalle técnico (qué petición falló)</summary>
          <pre id="appErrorTech"></pre>
        </details>
      </div>
      <div class="app-error-actions">
        <button type="button" class="rcbtn" id="appErrorDismiss">Cerrar</button>
        <button type="button" class="rcbtn active" id="appErrorRetry">Reintentar</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  _errDialogMounted = true;

  const hide = () => closeDataErrorDialog();
  el.addEventListener('click', (e) => { if (e.target === el) hide(); });
  document.getElementById('appErrorClose')?.addEventListener('click', hide);
  document.getElementById('appErrorDismiss')?.addEventListener('click', hide);
  document.getElementById('appErrorRetry')?.addEventListener('click', () => {
    const fn = _errDialogOnRetry;
    hide();
    if (typeof fn === 'function') fn();
    else if (typeof window.run === 'function') window.run();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('appErrorModal');
    if (modal?.style.display === 'flex') hide();
  });
}

export function closeDataErrorDialog() {
  const el = document.getElementById('appErrorModal');
  if (!el) return;
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
  _errDialogOnRetry = null;
}

/**
 * Modal claro: causa + pasos. Sustituye el banner rojo opaco para fallos de carga.
 * @param {unknown} err
 * @param {{ onRetry?: () => void }} [opts]
 */
export function showDataErrorDialog(err, opts = {}) {
  ensureErrorDialog();
  const info = classifyDataError(err);
  _errDialogOnRetry = opts.onRetry || null;

  const title = document.getElementById('appErrorTitle');
  const cause = document.getElementById('appErrorCause');
  const steps = document.getElementById('appErrorSteps');
  const tech = document.getElementById('appErrorTech');
  const retry = document.getElementById('appErrorRetry');
  const modal = document.getElementById('appErrorModal');

  if (title) title.textContent = info.title;
  if (cause) cause.textContent = info.cause;
  if (steps) {
    steps.innerHTML = info.steps.map((s) => `<li>${escHtml(s)}</li>`).join('');
  }
  if (tech) tech.textContent = info.technical;
  if (retry) retry.style.display = info.canRetry ? '' : 'none';

  // Keep a short status line; the modal carries the explanation.
  showErr('');
  setStatus('error', info.title);

  if (modal) {
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
  console.error('[data-error]', info.kind, err);
}
