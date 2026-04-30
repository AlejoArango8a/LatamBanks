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
  b.style.display = msg ? 'block' : 'none';
  b.textContent = msg;
}

export function setLsMsg(text) {
  const el = document.getElementById('lsMsg');
  if (el) el.textContent = text;
}
