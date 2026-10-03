// Asset composition lenses: only published cuts, and the groups foot.
//
// node --test tests/asset_lenses.test.mjs
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

const CACHE_BUST = fs.readFileSync(path.join(ROOT, 'js/assetLenses.js'), 'utf8').match(/\?v=(bmon\d+)/)[1];
const { buildComposition, lensAccountsFor, lensSpec } = await import(
  `../js/assetLenses.js?v=${CACHE_BUST}`
);

function row(cuenta, total, extra = {}) {
  return {
    cuenta,
    periodo: '202608',
    ins_cod: 1,
    monto_total: total,
    monto_clp: extra.clp ?? 0,
    monto_uf: extra.uf ?? 0,
    monto_tc: extra.tc ?? 0,
    monto_ext: extra.ext ?? 0,
  };
}

test('Uruguay business lines foot to total assets and loans are the headline', () => {
  const rows = [
    row('1', 1000, { clp: 400, ext: 600 }),
    row('1.4', 700, { clp: 200, ext: 500 }),
    row('1.4.1', 500, { clp: 100, ext: 400 }),
    row('1.4.2', 150, { clp: 80, ext: 70 }),
    row('1.4.3', 50, { clp: 20, ext: 30 }),
    row('1.3', 200, { clp: 150, ext: 50 }),
    row('1.10', 100, { clp: 100, ext: 0 }),
  ];
  const view = buildComposition(rows, 'UY', 'business', ['202608']);
  assert.equal(view.available, true);
  assert.equal(view.total, 1000);
  const loans = view.lines.find((l) => l.key === 'loans');
  const debt = view.lines.find((l) => l.key === 'acOther');
  const subs = view.lines.find((l) => l.key === 'subs');
  assert.equal(loans.value, 700);
  assert.equal(loans.pct, 70);
  assert.equal(debt, undefined);
  assert.equal(subs.value, 100);
  assert.equal(view.lines.some((l) => l.key === 'residual'), false);
  assert.equal(view.headline.values[0], 70);
});

test('Uruguay uses parent 1.4 once when the loan children are absent', () => {
  const rows = [
    row('1', 1000),
    row('1.4', 700),
    row('1.3', 300),
  ];
  const view = buildComposition(rows, 'UY', 'business', ['202608']);
  const loans = view.lines.find((l) => l.key === 'loans');
  assert.equal(loans.label, 'Amortized-cost assets');
  assert.equal(loans.value, 700);
  assert.equal(view.lines.find((l) => l.key === 'acOther'), undefined);
  assert.equal(view.lines.some((l) => l.key === 'residual'), false);
  const covered = view.lines.reduce((s, l) => s + l.value, 0);
  assert.equal(covered, 1000);
});

test('a missing Uruguay group is called out instead of being hidden inside another line', () => {
  const rows = [
    row('1', 1000),
    row('1.4.1', 600),
  ];
  const view = buildComposition(rows, 'UY', 'business', ['202608']);
  const residual = view.lines.find((l) => l.key === 'residual');
  assert.ok(residual);
  assert.equal(residual.value, 400);
  assert.match(residual.label, /Not in these lines/);
});

test('Uruguay currency share divides by the published total', () => {
  const rows = [
    row('1', 1000, { clp: 390, ext: 600 }),
    row('1.4.1', 600, { clp: 100, ext: 500 }),
    row('1.3', 400, { clp: 290, ext: 100 }),
  ];
  const view = buildComposition(rows, 'UY', 'currency', ['202608']);
  assert.equal(view.kind, 'currency');
  assert.equal(view.headline.values[0], 60);
  const fx = view.currencyTotal.parts.find((p) => p.key === 'ext');
  assert.equal(fx.value, 600);
  assert.equal(fx.pct, 60);
  const loans = view.lines.find((l) => l.key === 'loans');
  assert.equal(loans.fxPct, (500 / 600) * 100);
});

test('Uruguay has no mortgage or card lens, and says so', () => {
  const view = buildComposition([], 'UY', 'credit', ['202608']);
  assert.equal(view.available, false);
  assert.equal(view.instead, 'business');
  assert.match(view.reason, /does not publish mortgage/i);
  const residency = lensSpec('UY', 'residency');
  assert.equal(residency.available, true);
  assert.match(residency.scope, /credit book/i);
});

test('Chile currency keeps UF apart from foreign currency', () => {
  const rows = [
    row('100000000', 1000, { clp: 400, uf: 250, tc: 50, ext: 300 }),
    row('140000000', 700, { clp: 200, uf: 200, tc: 0, ext: 300 }),
    row('110000000', 300, { clp: 200, uf: 50, tc: 50, ext: 0 }),
  ];
  const view = buildComposition(rows, 'CL', 'currency', ['202608']);
  assert.equal(view.headline.values[0], 30);
  const uf = view.currencyTotal.parts.find((p) => p.key === 'uf');
  assert.equal(uf.value, 250);
  assert.notEqual(uf.key, 'ext');
  assert.equal(lensSpec('CL', 'residency').available, false);
  const credit = buildComposition([
    row('500000000', 1000),
    row('145000000', 600),
    row('146000000', 250),
    row('148000000', 150),
  ], 'CL', 'credit', ['202608']);
  assert.equal(credit.available, true);
  assert.equal(credit.lines.find((l) => l.key === 'comercial').pct, 60);
  assert.equal(credit.lines.find((l) => l.key === 'vivienda').value, 250);
});

test('Peru product lines leave an Other bucket instead of being forced to 100%', () => {
  const rows = [
    row('TOTAL_ACTIVO', 2000),
    row('CREDITOS_NETOS', 800),
    row('INVERSIONES_NETAS', 1200),
    row('VIGENTES', 500),
    row('HIPOTECARIOS_PARA_VIVIENDA', 200),
    row('TARJETAS_DE_CREDITO', 100),
  ];
  const business = buildComposition(rows, 'PE', 'business', ['202608']);
  assert.equal(business.lines.find((l) => l.key === 'loans').pct, 40);
  assert.equal(business.lines.some((l) => l.key === 'residual'), false);
  const credit = buildComposition(rows, 'PE', 'credit', ['202608']);
  const other = credit.lines.find((l) => l.key === 'other');
  assert.equal(other.value, 200);
  assert.equal(lensSpec('PE', 'currency').available, false);
  assert.equal(lensSpec('PE', 'residency').available, false);
});

test('United States residual is the FDIC cut, not a made-up product mix', () => {
  const rows = [
    row('ASSET', 1000),
    row('CHBAL', 100),
    row('SC', 200),
    row('LNLS', 500),
    row('LNRE', 300),
    row('LNCI', 150),
  ];
  const business = buildComposition(rows, 'US', 'business', ['202608']);
  assert.equal(business.lines.find((l) => l.key === 'other').value, 200);
  const credit = buildComposition(rows, 'US', 'credit', ['202608']);
  assert.equal(credit.lines.find((l) => l.key === 'other').value, 50);
  assert.equal(lensSpec('US', 'residency').available, false);
});

test('Brazil prefers the current total and still separates domestic from exterior', () => {
  const rows = [
    row('78182', 9999),
    row('140220', 1000),
    row('140205', 400),
    row('140200', 600),
    row('24454', 80),
    row('23358', 70),
    row('23383', 10),
  ];
  const business = buildComposition(rows, 'BR', 'business', ['202608']);
  assert.equal(business.total, 1000);
  assert.equal(business.lines.find((l) => l.key === 'loans').value, 400);
  const residency = buildComposition(rows, 'BR', 'residency', ['202608']);
  assert.equal(residency.lines.find((l) => l.key === 'exterior').pct, 12.5);
  assert.equal(lensSpec('BR', 'credit').available, false);
  assert.equal(lensSpec('BR', 'currency').available, false);
});

test('lens accounts cover every published line so a switch does not need another fetch', () => {
  const uy = lensAccountsFor('UY');
  assert.ok(uy.b1.includes('1'));
  assert.ok(uy.b1.includes('1.10'));
  assert.ok(uy.b1.includes('A2_GROSS'));
  assert.ok(uy.b1.includes('A2_1_4'));
  const cl = lensAccountsFor('CL');
  assert.ok(cl.b1.includes('100000000'));
  assert.ok(cl.b1.includes('145000000'));
  const co = lensAccountsFor('CO');
  assert.ok(co.b1.includes('140000'));
  assert.ok(!co.b1.includes('148000'));
  assert.ok(!co.b1.includes('149000'));
});
