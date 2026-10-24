'use strict';

/* =========================================================
   ProCro v2 – Calculs du quotidien
   Règle de 3 · Prix au poids · Pourcentages · Comparateur de promos
   ========================================================= */

/* ---------- Petits utilitaires ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Lit une saisie ("12,5", "1 200", "7.5") et renvoie un nombre, ou NaN si vide/invalide. */
function parseNum(value) {
    const s = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (s === '') return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

/** Écrit un nombre dans un champ (virgule à la française). */
function toInput(n) {
    if (n === undefined || n === null || n === '' || Number.isNaN(n)) return '';
    return String(n).replace('.', ',');
}

const setVal = (sel, v) => { const el = $(sel); if (el) el.value = toInput(v); };

const numberFormatters = {};
function fmt(n, maxDigits = 2) {
    if (!Number.isFinite(n)) return '–';
    numberFormatters[maxDigits] ??= new Intl.NumberFormat('fr-FR', { maximumFractionDigits: maxDigits });
    return numberFormatters[maxDigits].format(n);
}

const moneyFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const money = n => (Number.isFinite(n) ? moneyFormatter.format(n) : '–');
const pct = (n, d = 1) => `${fmt(n, d)}\u202f%`;
const signedPct = (n, d = 1) => (n > 0 ? '+' : '') + pct(n, d);

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

let toastTimer;
function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth; // relance l'animation
    el.classList.add('bump');
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Met à jour un bloc .result (valeur principale + sous-texte). */
function setResult(box, { value, sub = '', state = 'ok' }) {
    box.classList.toggle('is-empty', state === 'empty');
    box.classList.toggle('is-error', state === 'error');
    const valueEl = $('.result-value', box);
    if (state === 'ok' && valueEl.textContent !== value) bump(valueEl);
    valueEl.textContent = value;
    $('.result-sub', box).textContent = sub;
}

/** Affiche une liste d'exemples cliquables. */
function renderExampleChips(container, examples, onPick) {
    container.innerHTML = examples
        .map((ex, i) => `<button type="button" class="chip" data-i="${i}">${esc(ex.label)}</button>`)
        .join('');
    container.addEventListener('click', e => {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        onPick(examples[Number(btn.dataset.i)]);
        scrollToTop();
    });
}

/** Champ numérique générique (utilisé par les pourcentages et les promos). */
function fieldHTML({ id = '', dataF = '', label, suffix = '', ph = '', value = '' }) {
    const idAttr = id ? ` id="${id}"` : '';
    const dataAttr = dataF ? ` data-f="${dataF}"` : '';
    return `
        <label class="field">
            <span class="field-label">${esc(label)}</span>
            <span class="input-wrap">
                <input${idAttr}${dataAttr} class="num" type="text" inputmode="decimal" autocomplete="off"
                       placeholder="${esc(ph)}" value="${esc(value)}">
                ${suffix ? `<span class="suffix">${esc(suffix)}</span>` : ''}
            </span>
        </label>`;
}

/* ---------- Unités ---------- */
const UNITS = {
    g:  { label: 'g',  family: 'mass', factor: 1 },
    kg: { label: 'kg', family: 'mass', factor: 1000 },
    mL: { label: 'mL', family: 'vol',  factor: 1 },
    cL: { label: 'cL', family: 'vol',  factor: 10 },
    L:  { label: 'L',  family: 'vol',  factor: 1000 },
    u:  { label: 'unité', family: 'unit', factor: 1 },
};

const FAMILIES = {
    mass: { name: 'poids',  ref: 'kg',    refLabel: 'au kilo',   refFactor: 1000, small: '100 g',  smallFactor: 100 },
    vol:  { name: 'volume', ref: 'L',     refLabel: 'au litre',  refFactor: 1000, small: '100 mL', smallFactor: 100 },
    unit: { name: 'unités', ref: 'unité', refLabel: 'à l’unité', refFactor: 1,    small: null },
};

function unitOptions(selected = 'g') {
    return Object.entries(UNITS)
        .map(([key, u]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${u.label}</option>`)
        .join('');
}

/** Formate une quantité exprimée en unité de base (g, mL ou unités). */
function fmtQty(base, family) {
    if (family === 'mass') return base >= 1000 ? `${fmt(base / 1000, 3)} kg` : `${fmt(base, 1)} g`;
    if (family === 'vol') {
        if (base >= 1000) return `${fmt(base / 1000, 3)} L`;
        return base >= 10 ? `${fmt(base / 10, 1)} cL` : `${fmt(base, 1)} mL`;
    }
    return `${fmt(base, 2)} unité${base > 1 ? 's' : ''}`;
}

/** Prix de référence : €/kg, €/L ou €/unité. */
function refPrice(perBase, family) {
    const fam = FAMILIES[family];
    return `${money(perBase * fam.refFactor)}/${fam.ref}`;
}

/* =========================================================
   BASE DE DONNÉES (historique) – compatible avec la v1
   ========================================================= */
const DB = {
    db: null,

    open() {
        return new Promise(resolve => {
            try {
                if (!('indexedDB' in window)) return resolve(null);
                const req = indexedDB.open('ProCro', 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('calculations')) {
                        const store = db.createObjectStore('calculations', { keyPath: 'id', autoIncrement: true });
                        store.createIndex('date', 'date', { unique: false });
                    }
                };
                req.onsuccess = () => { this.db = req.result; resolve(this.db); };
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    },

    run(mode, action) {
        return new Promise(resolve => {
            if (!this.db) return resolve(mode === 'readonly' ? [] : false);
            try {
                const tx = this.db.transaction('calculations', mode);
                const req = action(tx.objectStore('calculations'));
                tx.oncomplete = () => resolve(mode === 'readonly' ? (req.result || []) : true);
                tx.onerror = () => resolve(mode === 'readonly' ? [] : false);
            } catch {
                resolve(mode === 'readonly' ? [] : false);
            }
        });
    },

    all()        { return this.run('readonly',  s => s.getAll()); },
    add(entry)   { return this.run('readwrite', s => s.add(entry)); },
    remove(id)   { return this.run('readwrite', s => s.delete(id)); },
    clear()      { return this.run('readwrite', s => s.clear()); },
};

/* =========================================================
   1. RÈGLE DE 3
   ========================================================= */
const Rule3 = {
    last: null,

    examples: [
        { label: '⛽ 7 L aux 100 km → pour 170 km ?', v: { a: 100, b: 7, c: 170 } },
        { label: '🍰 200 g de farine pour 4 → pour 6 ?', v: { a: 4, b: 200, c: 6 } },
        { label: '🚗 150 km en 2 h → en 5 h ?', v: { a: 2, b: 150, c: 5 } },
        { label: '💱 1 € = 1,08 $ → 50 € ?', v: { a: 1, b: 1.08, c: 50 } },
        { label: '👷 4 ouvriers en 6 j → 3 ouvriers ?', v: { a: 4, b: 6, c: 3, inverse: true } },
    ],

    init() {
        ['a', 'b', 'c'].forEach(k => $(`#r3-${k}`).addEventListener('input', () => this.calc()));
        $('#r3-inverse').addEventListener('change', () => this.calc());
        $('#r3-clear').addEventListener('click', () => this.restore({}));
        renderExampleChips($('#r3-examples'), this.examples, ex => this.restore(ex.v));
        this.calc();
    },

    calc() {
        const a = parseNum($('#r3-a').value);
        const b = parseNum($('#r3-b').value);
        const c = parseNum($('#r3-c').value);
        const inverse = $('#r3-inverse').checked;
        const out = $('#r3-x');
        const explain = $('#r3-explain');
        this.last = null;

        if (![a, b, c].every(Number.isFinite)) {
            out.textContent = '?';
            explain.innerHTML = 'Remplis <b>A</b>, <b>B</b> et <b>C</b> : <b>X</b> apparaît tout seul.';
            return;
        }
        if ((!inverse && a === 0) || (inverse && c === 0)) {
            out.textContent = '?';
            explain.textContent = inverse ? 'C ne peut pas être égal à 0.' : 'A ne peut pas être égal à 0.';
            return;
        }

        const x = inverse ? (a * b) / c : (b * c) / a;
        const shown = fmt(x, 4);
        if (out.textContent !== shown) bump(out);
        out.textContent = shown;

        explain.innerHTML = inverse
            ? `X = A × B ÷ C = ${fmt(a, 4)} × ${fmt(b, 4)} ÷ ${fmt(c, 4)} = <b>${shown}</b>`
            : `X = B × C ÷ A = ${fmt(b, 4)} × ${fmt(c, 4)} ÷ ${fmt(a, 4)} = <b>${shown}</b>`;

        this.last = {
            title: inverse ? 'Règle de 3 inverse' : 'Règle de 3',
            summary: `${fmt(a, 4)} → ${fmt(b, 4)} ; ${fmt(c, 4)} → ${shown}${inverse ? ' (inverse)' : ''}`,
            inputs: { a, b, c, inverse },
        };
    },

    restore(v) {
        setVal('#r3-a', v.a);
        setVal('#r3-b', v.b);
        setVal('#r3-c', v.c);
        $('#r3-inverse').checked = !!v.inverse;
        this.calc();
    },
};

/* =========================================================
   2. PRIX AU POIDS
   ========================================================= */
const Price = {
    mode: 'qty',
    last: null,

    examples: [
        { label: '🧀 7,50 € les 300 g → 500 g ?', v: { mode: 'qty', price: 7.5, qty: 300, unit: 'g', target: 500, tunit: 'g' } },
        { label: '🥩 18,90 € le kg → 350 g ?', v: { mode: 'qty', price: 18.9, qty: 1, unit: 'kg', target: 350, tunit: 'g' } },
        { label: '🫒 4,20 € les 75 cL → 1 L ?', v: { mode: 'qty', price: 4.2, qty: 75, unit: 'cL', target: 1, tunit: 'L' } },
        { label: '🍬 12 € le kg, budget 5 € ?', v: { mode: 'budget', price: 12, qty: 1, unit: 'kg', budget: 5, bunit: 'g' } },
    ],

    init() {
        ['#pr-price', '#pr-qty', '#pr-target', '#pr-budget'].forEach(s => $(s).addEventListener('input', () => this.calc()));
        ['#pr-unit', '#pr-tunit', '#pr-bunit'].forEach(s => $(s).addEventListener('change', () => this.calc()));
        $$('[data-price-mode]').forEach(btn => btn.addEventListener('click', () => this.setMode(btn.dataset.priceMode)));
        $('#pr-clear').addEventListener('click', () => this.restore({ mode: this.mode }));
        renderExampleChips($('#pr-examples'), this.examples, ex => this.restore(ex.v));
        this.calc();
    },

    setMode(mode) {
        this.mode = mode;
        $$('[data-price-mode]').forEach(btn => {
            const on = btn.dataset.priceMode === mode;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', String(on));
        });
        $('#pr-qty-block').hidden = mode !== 'qty';
        $('#pr-budget-block').hidden = mode !== 'budget';
        this.calc();
    },

    calc() {
        const box = $('#pr-result');
        const facts = $('#pr-facts');
        this.last = null;
        facts.innerHTML = '';

        const price = parseNum($('#pr-price').value);
        const qty = parseNum($('#pr-qty').value);
        const unitKey = $('#pr-unit').value;
        const unit = UNITS[unitKey];

        if (!(price > 0) || !(qty > 0)) {
            setResult(box, { value: '?', sub: 'Indique un prix et la quantité qui va avec', state: 'empty' });
            return;
        }

        const fam = FAMILIES[unit.family];
        const perBase = price / (qty * unit.factor);

        const list = [[`Prix ${fam.refLabel}`, money(perBase * fam.refFactor)]];
        if (fam.small) list.push([`Prix pour ${fam.small}`, money(perBase * fam.smallFactor)]);
        facts.innerHTML = list.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');

        const incompatible = other => setResult(box, {
            value: 'Unités incompatibles',
            sub: `Impossible de convertir du ${fam.name} en ${FAMILIES[other.family].name}.`,
            state: 'error',
        });

        if (this.mode === 'qty') {
            const target = parseNum($('#pr-target').value);
            const tunitKey = $('#pr-tunit').value;
            const tu = UNITS[tunitKey];
            if (!(target > 0)) {
                setResult(box, { value: '?', sub: 'Indique la quantité voulue', state: 'empty' });
                return;
            }
            if (tu.family !== unit.family) return incompatible(tu);

            const total = perBase * target * tu.factor;
            setResult(box, { value: money(total), sub: `pour ${fmt(target, 3)} ${tu.label}` });
            this.last = {
                title: `Prix pour ${fmt(target, 3)} ${tu.label}`,
                summary: `${money(price)} les ${fmt(qty, 3)} ${unit.label} → ${fmt(target, 3)} ${tu.label} = ${money(total)}`,
                inputs: { mode: 'qty', price, qty, unit: unitKey, target, tunit: tunitKey },
            };
        } else {
            const budget = parseNum($('#pr-budget').value);
            const bunitKey = $('#pr-bunit').value;
            const bu = UNITS[bunitKey];
            if (!(budget > 0)) {
                setResult(box, { value: '?', sub: 'Indique ton budget', state: 'empty' });
                return;
            }
            if (bu.family !== unit.family) return incompatible(bu);

            const q = budget / perBase / bu.factor;
            let sub = `pour ${money(budget)}`;
            if (bu.family === 'unit') sub += ` (soit ${Math.floor(q + 1e-9)} entière${Math.floor(q) > 1 ? 's' : ''})`;
            setResult(box, { value: `${fmt(q, 3)} ${bu.label}`, sub });
            this.last = {
                title: `Budget de ${money(budget)}`,
                summary: `${money(price)} les ${fmt(qty, 3)} ${unit.label} → ${money(budget)} = ${fmt(q, 3)} ${bu.label}`,
                inputs: { mode: 'budget', price, qty, unit: unitKey, budget, bunit: bunitKey },
            };
        }
    },

    restore(v) {
        setVal('#pr-price', v.price);
        setVal('#pr-qty', v.qty);
        setVal('#pr-target', v.target);
        setVal('#pr-budget', v.budget);
        $('#pr-unit').value = v.unit || 'g';
        $('#pr-tunit').value = v.tunit || 'g';
        $('#pr-bunit').value = v.bunit || 'g';
        this.setMode(v.mode || 'qty');
    },
};

/* =========================================================
   3. POURCENTAGES
   ========================================================= */
const PCT_MODES = {
    promo: {
        label: 'Prix soldé',
        hint: 'Le prix final après une remise. Ex : 49,90 € à −30 %.',
        fields: [{ k: 'p', label: 'Prix de départ', suffix: '€', ph: '49,90' }, { k: 'r', label: 'Remise', suffix: '%', ph: '30' }],
        example: { p: 49.9, r: 30 },
        compute({ p, r }) {
            if (r < 0 || r > 100) return { error: 'La remise doit être comprise entre 0 et 100 %.' };
            const f = p * (1 - r / 100);
            return {
                value: money(f),
                sub: `Tu économises ${money(p - f)}`,
                explain: `${money(p)} × (1 − ${pct(r, 2)}) = ${money(p)} × ${fmt(1 - r / 100, 4)} = <b>${money(f)}</b>`,
                summary: `${money(p)} à −${pct(r, 2)} = ${money(f)}`,
            };
        },
    },

    realDiscount: {
        label: 'Remise réelle',
        hint: 'Quel est le vrai % de remise entre l’ancien et le nouveau prix ?',
        fields: [{ k: 'a', label: 'Prix avant', suffix: '€', ph: '24,90' }, { k: 'b', label: 'Prix après', suffix: '€', ph: '19,90' }],
        example: { a: 24.9, b: 19.9 },
        compute({ a, b }) {
            if (a <= 0) return { error: 'Le prix avant doit être supérieur à 0.' };
            const r = (1 - b / a) * 100;
            const explain = `(1 − ${money(b)} ÷ ${money(a)}) × 100 = <b>${pct(r, 2)}</b>`;
            if (r < 0) {
                return {
                    value: `+${pct(-r)}`,
                    sub: `Attention : c’est une hausse de ${money(b - a)} !`,
                    explain,
                    summary: `${money(a)} → ${money(b)} : hausse de ${pct(-r)}`,
                };
            }
            return {
                value: `−${pct(r)}`,
                sub: `Économie de ${money(a - b)}`,
                explain,
                summary: `${money(a)} → ${money(b)} : −${pct(r)}`,
            };
        },
    },

    original: {
        label: 'Prix avant remise',
        hint: 'Tu connais le prix payé et la remise ? Retrouve le prix d’origine.',
        fields: [{ k: 'f', label: 'Prix payé', suffix: '€', ph: '34,93' }, { k: 'r', label: 'Remise appliquée', suffix: '%', ph: '30' }],
        example: { f: 34.93, r: 30 },
        compute({ f, r }) {
            if (r < 0 || r >= 100) return { error: 'La remise doit être comprise entre 0 et 99,99 %.' };
            const p = f / (1 - r / 100);
            return {
                value: money(p),
                sub: `La remise valait ${money(p - f)}`,
                explain: `${money(f)} ÷ (1 − ${pct(r, 2)}) = ${money(f)} ÷ ${fmt(1 - r / 100, 4)} = <b>${money(p)}</b>`,
                summary: `${money(f)} payé à −${pct(r, 2)} → ${money(p)} avant remise`,
            };
        },
    },

    of: {
        label: '% d’un nombre',
        hint: 'Ex : combien font 20 % de 150 ?',
        fields: [{ k: 'r', label: 'Pourcentage', suffix: '%', ph: '20' }, { k: 'n', label: 'Du nombre', ph: '150' }],
        example: { r: 20, n: 150 },
        compute({ r, n }) {
            const x = (n * r) / 100;
            return {
                value: fmt(x, 4),
                sub: `${pct(r, 2)} de ${fmt(n, 4)}`,
                explain: `${fmt(n, 4)} × ${fmt(r, 4)} ÷ 100 = <b>${fmt(x, 4)}</b>`,
                summary: `${pct(r, 2)} de ${fmt(n, 4)} = ${fmt(x, 4)}`,
            };
        },
    },

    share: {
        label: 'Part en %',
        hint: 'A représente quel pourcentage de B ? Ex : 15 sur 60.',
        fields: [{ k: 'a', label: 'Partie (A)', ph: '15' }, { k: 'b', label: 'Total (B)', ph: '60' }],
        example: { a: 15, b: 60 },
        compute({ a, b }) {
            if (b === 0) return { error: 'Le total ne peut pas être égal à 0.' };
            const x = (a / b) * 100;
            return {
                value: pct(x, 2),
                sub: `${fmt(a, 4)} sur ${fmt(b, 4)}`,
                explain: `${fmt(a, 4)} ÷ ${fmt(b, 4)} × 100 = <b>${pct(x, 2)}</b>`,
                summary: `${fmt(a, 4)} sur ${fmt(b, 4)} = ${pct(x, 2)}`,
            };
        },
    },

    change: {
        label: 'Évolution',
        hint: 'De combien de % une valeur a augmenté ou baissé ? Ex : un prix passe de 2,10 € à 2,45 €.',
        fields: [{ k: 'a', label: 'Valeur de départ', ph: '2,10' }, { k: 'b', label: 'Nouvelle valeur', ph: '2,45' }],
        example: { a: 2.1, b: 2.45 },
        compute({ a, b }) {
            if (a === 0) return { error: 'La valeur de départ ne peut pas être égale à 0.' };
            const x = ((b - a) / Math.abs(a)) * 100;
            const sub = x === 0 ? 'Aucun changement' : `${x > 0 ? 'Hausse' : 'Baisse'} de ${fmt(Math.abs(b - a), 4)}`;
            return {
                value: signedPct(x, 2),
                sub,
                explain: `(${fmt(b, 4)} − ${fmt(a, 4)}) ÷ ${fmt(Math.abs(a), 4)} × 100 = <b>${signedPct(x, 2)}</b>`,
                summary: `${fmt(a, 4)} → ${fmt(b, 4)} : ${signedPct(x, 2)}`,
            };
        },
    },

    stacked: {
        label: 'Remises cumulées',
        hint: 'Ex : −20 % en rayon puis −10 % en caisse. Ça ne fait pas −30 % !',
        fields: [{ k: 'r1', label: '1ʳᵉ remise', suffix: '%', ph: '20' }, { k: 'r2', label: '2ᵉ remise', suffix: '%', ph: '10' }],
        example: { r1: 20, r2: 10 },
        compute({ r1, r2 }) {
            if ([r1, r2].some(r => r < 0 || r > 100)) return { error: 'Chaque remise doit être comprise entre 0 et 100 %.' };
            const k = (1 - r1 / 100) * (1 - r2 / 100);
            const t = (1 - k) * 100;
            return {
                value: `−${pct(t, 2)}`,
                sub: r1 > 0 && r2 > 0 ? `au total (et non −${pct(r1 + r2, 2)})` : 'au total',
                explain: `1 − (1 − ${pct(r1, 2)}) × (1 − ${pct(r2, 2)}) = 1 − ${fmt(k, 4)} = <b>${pct(t, 2)}</b>`,
                summary: `−${pct(r1, 2)} puis −${pct(r2, 2)} = −${pct(t, 2)}`,
            };
        },
    },
};

const Percent = {
    mode: 'promo',
    last: null,

    init() {
        $('#pct-modes').innerHTML = Object.entries(PCT_MODES)
            .map(([key, m]) => `<button type="button" class="chip" role="tab" data-mode="${key}">${esc(m.label)}</button>`)
            .join('');
        $('#pct-modes').addEventListener('click', e => {
            const btn = e.target.closest('[data-mode]');
            if (btn) this.setMode(btn.dataset.mode);
        });
        $('#pct-fields').addEventListener('input', () => this.calc());
        $('#pct-example').addEventListener('click', () => this.restore({ mode: this.mode, values: PCT_MODES[this.mode].example }));
        $('#pct-clear').addEventListener('click', () => this.restore({ mode: this.mode, values: {} }));
        this.setMode('promo');
    },

    setMode(mode) {
        if (!PCT_MODES[mode]) mode = 'promo';
        this.mode = mode;
        const m = PCT_MODES[mode];
        $$('#pct-modes [data-mode]').forEach(btn => {
            const on = btn.dataset.mode === mode;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', String(on));
        });
        $('#pct-hint').textContent = m.hint;
        $('#pct-fields').innerHTML = m.fields.map(f => fieldHTML({ id: `pct-${f.k}`, ...f })).join('');
        this.calc();
    },

    calc() {
        const m = PCT_MODES[this.mode];
        const box = $('#pct-result');
        const explain = $('#pct-explain');
        const values = {};
        m.fields.forEach(f => { values[f.k] = parseNum($(`#pct-${f.k}`).value); });
        this.last = null;

        if (!Object.values(values).every(Number.isFinite)) {
            setResult(box, { value: '?', sub: 'Remplis les deux champs', state: 'empty' });
            explain.hidden = true;
            return;
        }

        const r = m.compute(values);
        if (r.error) {
            setResult(box, { value: 'Calcul impossible', sub: r.error, state: 'error' });
            explain.hidden = true;
            return;
        }

        setResult(box, { value: r.value, sub: r.sub });
        explain.innerHTML = r.explain;
        explain.hidden = false;
        this.last = { title: m.label, summary: r.summary, inputs: { mode: this.mode, values } };
    },

    restore({ mode, values = {} }) {
        this.setMode(mode);
        Object.entries(values).forEach(([k, v]) => setVal(`#pct-${k}`, v));
        this.calc();
    },
};

/* =========================================================
   4. COMPARATEUR DE PROMOS
   ========================================================= */
const PROMO_TYPES = {
    none:    { label: 'Pas de promo', params: [] },
    pct:     { label: 'Remise immédiate (−X %)', params: [{ k: 'p1', label: 'Remise', suffix: '%', ph: '30' }] },
    nth:     { label: 'Le 2ᵉ (ou 3ᵉ…) à −X %', params: [
                 { k: 'p1', label: 'Le combientième ?', suffix: 'ᵉ', ph: '2', def: '2' },
                 { k: 'p2', label: 'Remise sur celui-ci', suffix: '%', ph: '50' }] },
    free:    { label: 'X achetés + Y offerts', params: [
                 { k: 'p1', label: 'Achetés', ph: '2', def: '2' },
                 { k: 'p2', label: 'Offerts', ph: '1', def: '1' }],
               note: '« 3 pour le prix de 2 » = 2 achetés + 1 offert.' },
    lot:     { label: 'Lot : X articles pour Y €', params: [
                 { k: 'p1', label: 'Nombre d’articles', ph: '3' },
                 { k: 'p2', label: 'Prix du lot', suffix: '€', ph: '5' }] },
    bonus:   { label: '+X % de produit offert', params: [{ k: 'p1', label: 'Quantité offerte', suffix: '%', ph: '25' }],
               note: 'Indique la contenance normale, sans le bonus.' },
    loyalty: { label: 'X % sur la carte fidélité', params: [{ k: 'p1', label: 'Crédité sur la carte', suffix: '%', ph: '34' }],
               note: 'Cagnotté = remise sur un prochain achat, tu paies le prix plein aujourd’hui.' },
};

/** Calcule une offre : prix total payé, quantité totale obtenue, prix par unité de base. */
function computeOffer(o) {
    const price = parseNum(o.price);
    const qty = parseNum(o.qty);
    const unit = UNITS[o.unit] || UNITS.g;
    const a = parseNum(o.p1);
    const b = parseNum(o.p2);
    const isPct = x => x >= 0 && x <= 100;

    if (!(qty > 0)) return null;
    if (o.type !== 'lot' && !(price > 0)) return null;

    const base = qty * unit.factor;
    let n = 1;
    let total = price;
    let totalBase = base;

    switch (o.type) {
        case 'pct':
        case 'loyalty':
            if (!Number.isFinite(a)) return null;
            if (!isPct(a)) return { error: 'La remise doit être comprise entre 0 et 100 %.' };
            total = price * (1 - a / 100);
            break;

        case 'nth': {
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            const N = Math.round(a);
            if (N < 2) return { error: 'Indique 2 ou plus (ex : le 2ᵉ).' };
            if (!isPct(b)) return { error: 'La remise doit être comprise entre 0 et 100 %.' };
            n = N;
            total = price * (N - 1) + price * (1 - b / 100);
            totalBase = base * N;
            break;
        }

        case 'free': {
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            const N = Math.round(a);
            const M = Math.round(b);
            if (N < 1 || M < 1) return { error: 'Indique au moins 1 article acheté et 1 offert.' };
            n = N + M;
            total = price * N;
            totalBase = base * n;
            break;
        }

        case 'lot': {
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            const N = Math.round(a);
            if (N < 1 || b <= 0) return { error: 'Indique le nombre d’articles et le prix du lot.' };
            n = N;
            total = b;
            totalBase = base * N;
            break;
        }

        case 'bonus':
            if (!Number.isFinite(a)) return null;
            if (a <= 0) return { error: 'Indique le % de produit offert.' };
            totalBase = base * (1 + a / 100);
            break;
    }

    const perBase = total / totalBase;
    const normalPerBase = price > 0 ? price / base : NaN;
    const realDiscount = Number.isFinite(normalPerBase) ? (1 - perBase / normalPerBase) * 100 : NaN;

    return { n, total, totalBase, perBase, family: unit.family, realDiscount, loyalty: o.type === 'loyalty' };
}

function discountText(type, r) {
    if (type === 'none' || !Number.isFinite(r.realDiscount)) return '';
    if (r.realDiscount > 0.05) return `remise réelle <b>−${pct(r.realDiscount)}</b>`;
    if (r.realDiscount < -0.05) return `<span class="warn">⚠️ ${pct(-r.realDiscount)} plus cher que le prix normal</span>`;
    return 'aucune économie';
}

const Promo = {
    offers: [],
    nextId: 1,
    MAX: 4,
    last: null,

    examples: [
        {
            label: '🧺 Lessive : 2ᵉ à −30 % ou grand format ?',
            offers: [
                { name: 'Lessive 1,5 L – 2ᵉ à −30 %', price: '8,90', qty: '1,5', unit: 'L', type: 'nth', p1: '2', p2: '30' },
                { name: 'Lessive 3 L sans promo', price: '13,50', qty: '3', unit: 'L', type: 'none' },
                { name: 'Lessive 1,5 L +25 % offert', price: '9,20', qty: '1,5', unit: 'L', type: 'bonus', p1: '25' },
            ],
        },
        {
            label: '🥛 Yaourts : 2 + 1 offert ou pack de 12 ?',
            offers: [
                { name: 'Pack de 4 – 2 achetés + 1 offert', price: '2,40', qty: '500', unit: 'g', type: 'free', p1: '2', p2: '1' },
                { name: 'Pack de 12', price: '6,90', qty: '1,5', unit: 'kg', type: 'none' },
            ],
        },
        {
            label: '☕ Café : lot de 3 ou −34 % sur la carte ?',
            offers: [
                { name: 'Café 250 g – lot 3 pour 9 €', price: '3,49', qty: '250', unit: 'g', type: 'lot', p1: '3', p2: '9' },
                { name: 'Café 1 kg – 34 % sur la carte', price: '14,90', qty: '1', unit: 'kg', type: 'loyalty', p1: '34' },
            ],
        },
    ],

    init() {
        const box = $('#offers');
        const onEdit = e => this.onEdit(e);
        box.addEventListener('input', onEdit);
        box.addEventListener('change', onEdit);
        box.addEventListener('click', e => {
            const btn = e.target.closest('[data-remove]');
            if (btn) this.remove(Number(btn.dataset.remove));
        });
        $('#addOffer').addEventListener('click', () => this.add());
        $('#promo-reset').addEventListener('click', () => this.restore({}));
        renderExampleChips($('#promo-examples'), this.examples, ex => this.restore({ offers: ex.offers }));
        this.restore({});
    },

    blank(src = {}) {
        const { id, ...rest } = src;
        return { name: '', price: '', qty: '', unit: 'g', type: 'none', p1: '', p2: '', ...rest, id: this.nextId++ };
    },

    restore({ offers }) {
        const list = Array.isArray(offers) && offers.length ? offers.slice(0, this.MAX) : [{}, {}];
        this.offers = list.map(o => this.blank(o));
        while (this.offers.length < 2) this.offers.push(this.blank());
        this.renderOffers();
        this.calc();
    },

    add() {
        if (this.offers.length >= this.MAX) return;
        const prev = this.offers[this.offers.length - 1];
        this.offers.push(this.blank({ unit: prev?.unit || 'g' }));
        this.renderOffers();
        this.calc();
        const cards = $$('.offer');
        $('[data-f="price"]', cards[cards.length - 1])?.focus();
    },

    remove(id) {
        if (this.offers.length <= 2) return;
        this.offers = this.offers.filter(o => o.id !== id);
        this.renderOffers();
        this.calc();
    },

    onEdit(e) {
        const el = e.target;
        const field = el.dataset.f;
        if (!field) return;
        const card = el.closest('.offer');
        const offer = this.offers.find(o => o.id === Number(card.dataset.id));
        if (!offer || offer[field] === el.value) return;

        offer[field] = el.value;

        if (field === 'type') {
            const t = PROMO_TYPES[offer.type];
            offer.p1 = t.params[0]?.def ?? '';
            offer.p2 = t.params[1]?.def ?? '';
            $('.offer-params', card).innerHTML = this.paramsHTML(offer);
            $('.price-label', card).textContent = offer.type === 'lot' ? 'Prix normal (facultatif)' : 'Prix d’un article';
        }
        this.calc();
    },

    renderOffers() {
        const letters = 'ABCD';
        const removable = this.offers.length > 2;
        $('#offers').innerHTML = this.offers.map((o, i) => this.offerHTML(o, letters[i], removable)).join('');
        $('#addOffer').disabled = this.offers.length >= this.MAX;
        $('#addOffer').textContent = this.offers.length >= this.MAX ? '4 offres maximum' : '+ Ajouter une offre';
    },

    offerHTML(o, letter, removable) {
        const typeOptions = Object.entries(PROMO_TYPES)
            .map(([key, t]) => `<option value="${key}"${key === o.type ? ' selected' : ''}>${esc(t.label)}</option>`)
            .join('');
        return `
        <article class="offer" data-id="${o.id}">
            <div class="offer-head">
                <span class="offer-badge">${letter}</span>
                <input class="offer-name" data-f="name" type="text" maxlength="40" autocomplete="off"
                       value="${esc(o.name)}" placeholder="Offre ${letter} (ex : Lessive 1,5 L)" aria-label="Nom de l’offre ${letter}">
                ${removable ? `<button type="button" class="icon-btn" data-remove="${o.id}" aria-label="Retirer l’offre ${letter}">✕</button>` : ''}
            </div>
            <div class="grid-qty">
                <label class="field">
                    <span class="field-label price-label">${o.type === 'lot' ? 'Prix normal (facultatif)' : 'Prix d’un article'}</span>
                    <span class="input-wrap">
                        <input class="num" data-f="price" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(o.price)}">
                        <span class="suffix">€</span>
                    </span>
                </label>
                <label class="field">
                    <span class="field-label">Contenance</span>
                    <span class="input-wrap">
                        <input class="num" data-f="qty" type="text" inputmode="decimal" autocomplete="off" placeholder="500" value="${esc(o.qty)}">
                        <select data-f="unit" aria-label="Unité">${unitOptions(o.unit)}</select>
                    </span>
                </label>
            </div>
            <label class="field">
                <span class="field-label">Promotion</span>
                <select class="select" data-f="type">${typeOptions}</select>
            </label>
            <div class="offer-params">${this.paramsHTML(o)}</div>
            <div class="offer-result" aria-live="polite"></div>
        </article>`;
    },

    paramsHTML(o) {
        const t = PROMO_TYPES[o.type];
        if (!t.params.length) return '';
        const fields = t.params.map(p => fieldHTML({ dataF: p.k, label: p.label, suffix: p.suffix, ph: p.ph, value: o[p.k] })).join('');
        return `<div class="${t.params.length > 1 ? 'grid-2' : ''}">${fields}</div>${t.note ? `<p class="offer-note">${esc(t.note)}</p>` : ''}`;
    },

    calc() {
        const letters = 'ABCD';
        const rows = this.offers.map((o, i) => ({
            o,
            name: o.name.trim() || `Offre ${letters[i]}`,
            r: computeOffer(o),
        }));

        // Résultat sous chaque offre
        rows.forEach(({ o, r }) => {
            const card = $(`.offer[data-id="${o.id}"]`);
            if (!card) return;
            card.classList.remove('is-best');
            const el = $('.offer-result', card);
            if (!r) { el.textContent = 'Complète le prix, la contenance et la promo.'; return; }
            if (r.error) { el.innerHTML = `<span class="warn">${esc(r.error)}</span>`; return; }
            const extra = discountText(o.type, r);
            el.innerHTML = `Tu paies <b>${money(r.total)}</b> pour <b>${r.n} article${r.n > 1 ? 's' : ''}</b> (${fmtQty(r.totalBase, r.family)})
                → <b>${refPrice(r.perBase, r.family)}</b>${extra ? ` · ${extra}` : ''}${r.loyalty ? ' · <i>cagnotté</i>' : ''}`;
        });

        // Comparaison
        const out = $('#promo-results');
        const saveBtn = $('#promo-save');
        this.last = null;
        saveBtn.hidden = true;

        const valid = rows.filter(x => x.r && !x.r.error);
        if (valid.length < 2) {
            out.innerHTML = `<p class="empty-inline">Remplis au moins <b>2 offres</b> (prix, contenance et promo éventuelle) pour savoir laquelle est vraiment la moins chère.</p>`;
            return;
        }

        if (new Set(valid.map(x => x.r.family)).size > 1) {
            out.innerHTML = `<div class="alert">⚠️ Les offres n’utilisent pas le même type d’unité. Pour comparer, choisis partout du <b>poids</b> (g, kg), du <b>volume</b> (mL, cL, L) ou des <b>unités</b>.</div>`;
            return;
        }

        const family = valid[0].r.family;
        const fam = FAMILIES[family];
        valid.sort((x, y) => x.r.perBase - y.r.perBase);
        const best = valid[0];
        const worst = valid[valid.length - 1];
        const tie = valid[1].r.perBase / best.r.perBase - 1 < 0.0005;

        if (!tie) $(`.offer[data-id="${best.o.id}"]`)?.classList.add('is-best');

        let verdict;
        if (tie) {
            verdict = `🤝 <b>${esc(best.name)}</b> et <b>${esc(valid[1].name)}</b> reviennent au même prix ${fam.refLabel} : <b>${refPrice(best.r.perBase, family)}</b>.`;
        } else {
            const saving = (worst.r.perBase - best.r.perBase) * fam.refFactor;
            verdict = `🏆 <b>${esc(best.name)}</b> est la meilleure affaire : <b>${refPrice(best.r.perBase, family)}</b>.`
                + `<br>Par rapport à la moins intéressante, tu économises <b>${money(saving)}</b> par ${fam.ref}.`;
        }

        const insights = [];
        valid.slice(1).forEach(x => {
            const diff = (x.r.perBase / best.r.perBase - 1) * 100;
            if (x.o.type !== 'none' && diff >= 0.05) {
                insights.push(`<div class="alert">⚠️ Malgré sa promo, <b>${esc(x.name)}</b> revient <b>${pct(diff)}</b> plus cher ${fam.refLabel} que <b>${esc(best.name)}</b>.</div>`);
            }
        });
        valid.forEach(x => {
            if (x.o.type === 'lot' && x.r.realDiscount < -0.05) {
                insights.push(`<div class="alert">⚠️ Le lot <b>${esc(x.name)}</b> coûte plus cher que d’acheter les articles à l’unité !</div>`);
            }
        });
        if (!tie && best.r.n > 1) {
            insights.push(`<div class="alert info">ℹ️ <b>${esc(best.name)}</b> oblige à acheter <b>${best.r.n} articles</b> (${money(best.r.total)}). Ça ne vaut le coup que si tu vas tout utiliser.</div>`);
        }
        if (!tie && best.r.loyalty) {
            insights.push(`<div class="alert info">ℹ️ La remise de <b>${esc(best.name)}</b> est cagnottée : tu paies le prix plein aujourd’hui et la remise sert plus tard.</div>`);
        }

        const ranking = valid.map((x, i) => {
            const diff = (x.r.perBase / best.r.perBase - 1) * 100;
            let tag;
            if (i === 0 && !tie) tag = '<span class="tag tag-good">Meilleur prix</span>';
            else if (diff < 0.05) tag = '<span class="tag tag-good">Égalité</span>';
            else tag = `<span class="tag tag-bad">+${pct(diff)}</span>`;
            const disc = discountText(x.o.type, x.r);
            return `
            <li class="rank-item${i === 0 && !tie ? ' best' : ''}">
                <span class="rank-pos">${i === 0 && !tie ? '🏆' : i + 1}</span>
                <span class="rank-name">${esc(x.name)}</span>
                <span class="rank-price">${refPrice(x.r.perBase, family)}</span>
                <span class="rank-meta">${tag} ${money(x.r.total)} pour ${fmtQty(x.r.totalBase, family)}${disc ? ` · ${disc}` : ''}</span>
            </li>`;
        }).join('');

        out.innerHTML = `<div class="verdict">${verdict}</div><ol class="rank">${ranking}</ol>${insights.join('')}`;

        saveBtn.hidden = false;
        this.last = {
            title: `Promos : ${valid.map(x => x.name).join(' / ')}`.slice(0, 80),
            summary: tie
                ? `Égalité à ${refPrice(best.r.perBase, family)}`
                : `Meilleure offre : ${best.name} (${refPrice(best.r.perBase, family)})`,
            inputs: { offers: this.offers.map(({ id, ...rest }) => rest) },
        };
    },
};

/* =========================================================
   5. HISTORIQUE & SAUVEGARDE
   ========================================================= */
const TOOLS = { rule3: Rule3, price: Price, percent: Percent, promo: Promo };

const TYPE_META = {
    rule3:   { icon: '✕', page: 'rule3' },
    price:   { icon: '€', page: 'price' },
    percent: { icon: '%', page: 'percent' },
    promo:   { icon: '🏷', page: 'promo' },
};

const Saver = {
    pending: null,

    init() {
        this.dialog = $('#saveDialog');
        this.input = $('#saveName');

        document.addEventListener('click', e => {
            const btn = e.target.closest('[data-save]');
            if (btn) this.open(btn.dataset.save);
        });

        $('#saveCancel').addEventListener('click', () => this.dialog.close('cancel'));
        this.dialog.addEventListener('click', e => { if (e.target === this.dialog) this.dialog.close('cancel'); });
        this.dialog.addEventListener('close', () => {
            if (this.dialog.returnValue === 'save') this.commit(this.input.value.trim());
            this.pending = null;
        });
    },

    open(type) {
        const data = TOOLS[type]?.last;
        if (!data) { toast('Fais d’abord un calcul complet 🙂'); return; }
        this.pending = { type, ...data };

        if (typeof this.dialog.showModal === 'function') {
            this.input.value = '';
            this.input.placeholder = data.title;
            $('#saveSummary').textContent = data.summary;
            this.dialog.returnValue = '';
            this.dialog.showModal();
        } else {
            const name = window.prompt('Nom du calcul (facultatif)', '');
            if (name !== null) this.commit(name.trim());
            this.pending = null;
        }
    },

    async commit(name) {
        const p = this.pending;
        if (!p) return;
        const ok = await DB.add({
            type: p.type,
            title: name || p.title,
            summary: p.summary,
            inputs: p.inputs,
            date: new Date().toISOString(),
        });
        toast(ok ? 'Calcul sauvegardé ✓' : 'Sauvegarde impossible sur cet appareil');
    },
};

const History = {
    items: [],

    init() {
        $('#histList').addEventListener('click', async e => {
            const load = e.target.closest('[data-load]');
            const del = e.target.closest('[data-del]');
            if (load) {
                const item = this.items.find(i => i.id === Number(load.dataset.load));
                if (item) this.restore(item);
            } else if (del) {
                await DB.remove(Number(del.dataset.del));
                toast('Calcul supprimé');
                this.render();
            }
        });

        $('#histClear').addEventListener('click', async () => {
            if (!this.items.length) return;
            if (window.confirm('Effacer tout l’historique ?')) {
                await DB.clear();
                this.render();
            }
        });
    },

    /** Convertit aussi les anciens calculs de la v1 (name, a, b, c, result). */
    normalize(entry) {
        if (entry.type && entry.inputs) return entry;
        const a = Number(entry.a), b = Number(entry.b), c = Number(entry.c);
        const x = Number(entry.result);
        return {
            id: entry.id,
            type: 'rule3',
            title: entry.name || 'Règle de 3',
            summary: `${fmt(a, 4)} → ${fmt(b, 4)} ; ${fmt(c, 4)} → ${fmt(x, 4)}`,
            inputs: { a, b, c, inverse: false },
            date: entry.date,
        };
    },

    async render() {
        const list = $('#histList');
        const raw = await DB.all();
        this.items = raw.map(e => this.normalize(e)).sort((x, y) => y.id - x.id);
        $('#histClear').hidden = this.items.length === 0;

        if (!DB.db) {
            list.innerHTML = `<li class="empty"><span class="empty-ico">⚠️</span>L’historique n’est pas disponible sur ce navigateur (navigation privée ?).</li>`;
            return;
        }
        if (!this.items.length) {
            list.innerHTML = `<li class="empty"><span class="empty-ico">🗂️</span>Aucun calcul sauvegardé pour l’instant.<br>Appuie sur <b>Sauvegarder</b> après un calcul.</li>`;
            return;
        }

        list.innerHTML = this.items.map(item => {
            const meta = TYPE_META[item.type] || TYPE_META.rule3;
            const d = new Date(item.date);
            const date = Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
            return `
            <li class="hist-item">
                <span class="hist-icon" aria-hidden="true">${meta.icon}</span>
                <div>
                    <span class="hist-title">${esc(item.title)}</span>
                    <span class="hist-summary">${esc(item.summary)}</span>
                    <span class="hist-meta">${esc(date)}</span>
                </div>
                <div class="hist-actions">
                    <button type="button" class="btn btn-sm btn-soft" data-load="${item.id}">Reprendre</button>
                    <button type="button" class="icon-btn danger" data-del="${item.id}" aria-label="Supprimer">🗑</button>
                </div>
            </li>`;
        }).join('');
    },

    restore(item) {
        const tool = TOOLS[item.type];
        if (!tool) return;
        showPage(TYPE_META[item.type].page);
        tool.restore(item.inputs || {});
        toast('Calcul rechargé');
    },
};

/* =========================================================
   NAVIGATION
   ========================================================= */
const PAGES = {
    rule3: 'Règle de 3',
    price: 'Prix au poids',
    percent: 'Pourcentages',
    promo: 'Comparateur de promos',
    history: 'Historique',
};

function showPage(name) {
    if (!PAGES[name]) name = 'rule3';
    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    $$('.tab').forEach(tab => {
        const on = tab.dataset.page === name;
        tab.classList.toggle('active', on);
        if (on) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    });
    $('#pageSubtitle').textContent = PAGES[name];
    if (name === 'history') History.render();
    window.scrollTo(0, 0);
    try { localStorage.setItem('procro-page', name); } catch { /* stockage indisponible */ }
}

/* =========================================================
   SERVICE WORKER (hors ligne + mises à jour)
   ========================================================= */
function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker indisponible :', err));

    // Une nouvelle version a pris le relais : on propose d'actualiser
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) $('#updateBar').hidden = false;
    });
    $('#updateBtn').addEventListener('click', () => location.reload());
}

/* =========================================================
   DÉMARRAGE
   ========================================================= */
async function init() {
    $$('select[data-units]').forEach(s => { s.innerHTML = unitOptions(s.dataset.units); });

    Rule3.init();
    Price.init();
    Percent.init();
    Promo.init();
    Saver.init();
    History.init();

    $$('.tab').forEach(tab => tab.addEventListener('click', () => showPage(tab.dataset.page)));

    // Sélectionne tout le contenu d'un champ au toucher : plus rapide pour corriger une valeur
    document.addEventListener('focusin', e => {
        if (e.target.matches('input.num')) setTimeout(() => e.target.select(), 0);
    });

    await DB.open();

    let start = 'rule3';
    try { start = localStorage.getItem('procro-page') || 'rule3'; } catch { /* rien */ }
    showPage(start);

    registerServiceWorker();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
