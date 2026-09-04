// Árbol de cuentas del Account View.
//
// El desplegable de "search account" listaba las cuentas de primer nivel del
// grupo activo, y el nivel se medía con la regla de la CMF chilena en todos los
// países menos Brasil. En Uruguay, Perú, Estados Unidos, Argentina, México y
// Panamá los códigos no tienen esa forma, así que ninguna cuenta salía como de
// primer nivel y el desplegable aparecía vacío: solo se veía algo al escribir,
// porque la búsqueda por texto no mira niveles.
//
// Correr con:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

globalThis.window = { location: { hostname: 'localhost' }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => ({ style: {}, dataset: {} }),
};

// El sufijo ?v= tiene que ser el mismo que usa accountview.js en sus imports:
// con otro, Node carga una segunda instancia de state.js y el ST que se escribe
// acá no es el que lee la vista.
const CACHE_BUST = fs.readFileSync(path.join(ROOT, 'js/views/accountview.js'), 'utf8')
  .match(/\.\.\/state\.js\?(v=bmon\d+)/)[1];

const { ST } = await import(`${ROOT}/js/state.js?${CACHE_BUST}`);
const { avGetLevel, avIsChildOf } = await import(`${ROOT}/js/views/accountview.js`);

const PLANES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/fixtures/account_view_plan_cuentas.json'), 'utf8'),
);

const SLUG = {
  CL: 'chile', CO: 'colombia', BR: 'brasil', UY: 'uruguay',
  PE: 'peru', US: 'usa', AR: 'argentina', MX: 'mexico', PA: 'panama',
};

function useCountry(iso) {
  ST.country = SLUG[iso];
  ST.planCuentas = PLANES[iso];
}

/** Lo que termina dibujando avRenderTree partiendo de las raíces. */
function treeReach(iso) {
  useCountry(iso);
  const all = Object.keys(ST.planCuentas).filter((c) => avGetLevel(c) > 0).sort();
  const roots = all.filter((c) => avGetLevel(c) === 1);
  const seen = new Set();
  const walk = (c) => {
    if (seen.has(c)) return;
    seen.add(c);
    const lvl = avGetLevel(c);
    if (lvl >= 3) return;
    all.filter((ch) => ch !== c && avGetLevel(ch) === lvl + 1 && avIsChildOf(c, ch)).forEach(walk);
  };
  roots.forEach(walk);
  return { all, roots, seen };
}

test('todos los países muestran cuentas sin que haya que escribir nada', () => {
  for (const iso of Object.keys(SLUG)) {
    const { roots } = treeReach(iso);
    assert.ok(roots.length > 0, `${iso} no tiene cuentas de primer nivel: el desplegable saldría vacío`);
  }
});

test('los países de códigos planos o por puntos no esconden ninguna cuenta', () => {
  // Chile y Colombia quedan fuera a propósito: sus planes mezclan el plan viejo
  // de siete dígitos con el nuevo de nueve y arrastran huérfanas de antes.
  for (const iso of ['BR', 'UY', 'PE', 'US', 'AR', 'MX', 'PA']) {
    const { all, seen } = treeReach(iso);
    const fuera = all.filter((c) => !seen.has(c));
    assert.deepEqual(fuera, [], `${iso} deja cuentas fuera del árbol`);
  }
});

test('Uruguay: el nivel es la profundidad de puntos y los sueltos son raíz', () => {
  useCountry('UY');
  assert.equal(avGetLevel('1'), 1);
  assert.equal(avGetLevel('1.1'), 2);
  assert.equal(avGetLevel('1.1.1'), 3);
  assert.equal(avGetLevel('19'), 1);
  // Anexos y subtotales del BCU no llevan punto: son raíces sin hijos.
  assert.equal(avGetLevel('A1_BCU_VISTA'), 1);
  assert.equal(avGetLevel('A2_1'), 1);
  assert.equal(avGetLevel('R_EJERCICIO'), 1);
});

test('Uruguay: los hijos se buscan por ruta, no por prefijo del código', () => {
  useCountry('UY');
  assert.equal(avIsChildOf('1', '1.1'), true);
  assert.equal(avIsChildOf('1.1', '1.1.1'), true);
  // Por prefijo, '19' y '1.10' se colgarían de '1' y de '1.1'.
  assert.equal(avIsChildOf('1', '19'), false);
  assert.equal(avIsChildOf('1', '19.1'), false);
  assert.equal(avIsChildOf('1.1', '1.10'), false);
  assert.equal(avIsChildOf('2', '1.1'), false);
});

test('Uruguay: ninguna cuenta cuelga de dos padres a la vez', () => {
  const { all } = treeReach('UY');
  for (const ch of all) {
    const lvl = avGetLevel(ch);
    if (lvl <= 1) continue;
    const padres = all.filter((p) => p !== ch && avGetLevel(p) === lvl - 1 && avIsChildOf(p, ch));
    assert.ok(padres.length <= 1, `${ch} cuelga de ${padres.length} padres: ${padres.join(', ')}`);
  }
});

test('los códigos planos son todos raíz y no se cuelgan entre sí', () => {
  for (const iso of ['US', 'AR', 'MX', 'PA', 'PE', 'BR']) {
    useCountry(iso);
    const codes = Object.keys(ST.planCuentas);
    for (const c of codes) assert.equal(avGetLevel(c), 1, `${iso}/${c} debería ser de primer nivel`);
    // Sin jerarquía, un slug nunca es hijo de otro aunque comparta prefijo.
    assert.equal(codes.filter((c) => codes.some((p) => p !== c && avIsChildOf(p, c))).length, 0);
  }
});

test('Chile y Colombia conservan la jerarquía por ceros finales', () => {
  useCountry('CL');
  assert.equal(avGetLevel('100000000'), 0);   // raíz del plan, no se lista
  assert.equal(avGetLevel('105000000'), 1);
  assert.equal(avGetLevel('105000100'), 2);
  assert.equal(avGetLevel('105000101'), 3);
  assert.equal(avIsChildOf('105000000', '105000100'), true);
  assert.equal(avIsChildOf('105000100', '105000101'), true);

  useCountry('CO');
  assert.equal(avGetLevel('100000'), 0);
  assert.equal(avGetLevel('110000'), 1);
  assert.equal(avGetLevel('110500'), 2);
  assert.equal(avGetLevel('110505'), 3);
  assert.equal(avIsChildOf('110000', '110500'), true);
  assert.equal(avIsChildOf('110500', '110505'), true);
});
