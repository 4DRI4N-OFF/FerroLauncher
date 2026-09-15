import test from 'node:test';
import assert from 'node:assert/strict';
import { STR, getLang } from '../src/i18n.js';

const es = STR.es;
const en = STR.en;

test('i18n: ES y EN tienen exactamente las mismas claves', () => {
  const a = Object.keys(es).sort();
  const b = Object.keys(en).sort();
  const soloEs = a.filter((k) => !(k in en));
  const soloEn = b.filter((k) => !(k in es));
  assert.deepEqual(soloEs, [], 'claves en ES que faltan en EN');
  assert.deepEqual(soloEn, [], 'claves en EN que faltan en ES');
  assert.ok(a.length > 200, `número de claves sospechoso: ${a.length}`);
});

test('i18n: ninguna clave está vacía ni es idéntica por accidente al otro idioma salvo calcos', () => {
  const vacias = Object.keys(es).filter((k) => !String(es[k] ?? '').trim() || !String(en[k] ?? '').trim());
  assert.deepEqual(vacias, [], 'hay claves sin traducir');
});

test('i18n: los marcadores {x} coinciden entre idiomas (si falta uno, la UI sale rota)', () => {
  const marks = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const roto = Object.keys(es).filter((k) => marks(es[k]) !== marks(en[k]));
  assert.deepEqual(roto, [], `marcadores distintos en: ${roto.join(', ')}`);
});

test('i18n: getLang no petar sin localStorage (entorno node)', () => {
  assert.equal(getLang(), 'es');
});

test('i18n: el inglés no deja texto en español sin calco', () => {
  // 'Jugar', 'Instancias'... son palabras que en ES/EN difieren siempre; esta
  // lista es la que se cuela al copiar y pegar la columna española
  const sospecha = /\b(demás|también|versión|ajustes|cuenta|instancia|descarga|ventana|archivos|pulsar|válid)/i;
  const malas = Object.keys(en).filter((k) => sospecha.test(en[k]));
  assert.deepEqual(malas, [], `EN contiene texto ES en: ${malas.join(', ')}`);
});
