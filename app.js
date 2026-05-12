// app.js
class ProCro {
    constructor() {
        this.db = null;
        this.init();
    }

    async init() {
        // Initialise IndexedDB
        await this.initDB();

        // Enregistre le Service Worker
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('sw.js');
                console.log('Service Worker enregistré');
            } catch (err) {
                console.log('Service Worker non disponible:', err);
            }
        }

        // Événements navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchPage(e.target.dataset.page));
        });

        // Événements formulaire CALCULATOR
        const inputA = document.getElementById('inputA');
        const inputB = document.getElementById('inputB');
        const inputC = document.getElementById('inputC');
        
        if (inputA) inputA.addEventListener('input', () => this.calculate());
        if (inputB) inputB.addEventListener('input', () => this.calculate());
        if (inputC) inputC.addEventListener('input', () => this.calculate());

        const calculateBtn = document.getElementById('calculateBtn');
        const saveBtn = document.getElementById('saveBtn');
        
        if (calculateBtn) calculateBtn.addEventListener('click', () => this.calculate(true));
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveResult());

        // === ACCORDÉON ===
        const exampleToggle = document.getElementById('exampleToggle');
        const exampleContent = document.getElementById('exampleContent');

        if (exampleToggle && exampleContent) {
            exampleToggle.addEventListener('click', () => {
                exampleToggle.classList.toggle('active');
                exampleContent.classList.toggle('active');
            });
        }

        // === COMPARISON PAGE ===
        this.initComparison();

        // Charge l'historique au démarrage
        this.loadHistory();
    }

   // === COMPARISON PAGE ===
initComparison() {
    const compareBtn = document.getElementById('compareBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', () => this.performComparison());
    }
}

performComparison() {
    // Récupérer les données
    const p1 = {
        name: document.getElementById('comp-product1-name').value.trim() || 'Produit 1',
        val1: parseFloat(document.getElementById('comp-product1-val1').value) || 0,
        unit1: document.getElementById('comp-product1-unit1').value.trim() || 'unité',
        val2: parseFloat(document.getElementById('comp-product1-val2').value) || 0,
        unit2: document.getElementById('comp-product1-unit2').value.trim() || 'unité',
    };

    const p2 = {
        name: document.getElementById('comp-product2-name').value.trim() || 'Produit 2',
        val1: parseFloat(document.getElementById('comp-product2-val1').value) || 0,
        unit1: document.getElementById('comp-product2-unit1').value.trim() || 'unité',
        val2: parseFloat(document.getElementById('comp-product2-val2').value) || 0,
        unit2: document.getElementById('comp-product2-unit2').value.trim() || 'unité',
    };

    // Validation
    if (p1.val1 === 0 || p2.val1 === 0 || p1.val2 === 0 || p2.val2 === 0) {
        alert('⚠️ Veuillez remplir tous les champs avec des nombres valides');
        return;
    }

    // Afficher les résultats
    this.displayComparisonResults(p1, p2);
}

displayComparisonResults(p1, p2) {
    const resultsSection = document.getElementById('comparisonResults');
    resultsSection.classList.remove('hidden');

    // ===== CALCUL DES RATIOS =====
    const ratio1_val1perval2 = p1.val1 / p1.val2;
    const ratio1_val2perval1 = p1.val2 / p1.val1;

    const ratio2_val1perval2 = p2.val1 / p2.val2;
    const ratio2_val2perval1 = p2.val2 / p2.val1;

    // ===== AFFICHAGE PRODUIT 1 =====
    document.getElementById('comp-result-ratio-p1-name1').textContent = 
        `Ratio ${this.escapeHtml(p1.name)} (${p1.unit1}/${p1.unit2})`;
    document.getElementById('comp-result-ratio-p1-val1').textContent = 
        `${ratio1_val1perval2.toFixed(4)} ${p1.unit1}/${p1.unit2}`;

    document.getElementById('comp-result-ratio-p1-name2').textContent = 
        `Ratio ${this.escapeHtml(p1.name)} (${p1.unit2}/${p1.unit1})`;
    document.getElementById('comp-result-ratio-p1-val2').textContent = 
        `${ratio1_val2perval1.toFixed(4)} ${p1.unit2}/${p1.unit1}`;

    // ===== AFFICHAGE PRODUIT 2 =====
    document.getElementById('comp-result-ratio-p2-name1').textContent = 
        `Ratio ${this.escapeHtml(p2.name)} (${p2.unit1}/${p2.unit2})`;
    document.getElementById('comp-result-ratio-p2-val1').textContent = 
        `${ratio2_val1perval2.toFixed(4)} ${p2.unit1}/${p2.unit2}`;

    document.getElementById('comp-result-ratio-p2-name2').textContent = 
        `Ratio ${this.escapeHtml(p2.name)} (${p2.unit2}/${p2.unit1})`;
    document.getElementById('comp-result-ratio-p2-val2').textContent = 
        `${ratio2_val2perval1.toFixed(4)} ${p2.unit2}/${p2.unit1}`;

    // ===== COMPARAISONS SUPPLÉMENTAIRES =====
    this.displayExtraComparisons(p1, p2, ratio1_val1perval2, ratio1_val2perval1, ratio2_val1perval2, ratio2_val2perval1);
}

displayExtraComparisons(p1, p2, ratio1_r1, ratio1_r2, ratio2_r1, ratio2_r2) {
    // ===== 1. DIFFÉRENCES ABSOLUES =====
    const diffVal1 = p2.val1 - p1.val1;
    const diffVal2 = p2.val2 - p1.val2;

    const diffVal1Text = diffVal1 >= 0 ? `+${diffVal1.toFixed(2)}${p1.unit1}` : `${diffVal1.toFixed(2)}${p1.unit1}`;
    const diffVal2Text = diffVal2 >= 0 ? `+${diffVal2.toFixed(2)}${p1.unit2}` : `${diffVal2.toFixed(2)}${p1.unit2}`;

    const whichMoreVal1 = diffVal1 > 0 ? `${this.escapeHtml(p2.name)} a plus` : `${this.escapeHtml(p1.name)} a plus`;
    const whichMoreVal2 = diffVal2 > 0 ? `${this.escapeHtml(p2.name)} a plus` : `${this.escapeHtml(p1.name)} a plus`;

    document.getElementById('comp-diff-unit1-label').textContent = `Différence ${p1.unit1}`;
    document.getElementById('comp-diff-unit1-value').textContent = `${diffVal1Text} (${whichMoreVal1})`;

    document.getElementById('comp-diff-unit2-label').textContent = `Différence ${p1.unit2}`;
    document.getElementById('comp-diff-unit2-value').textContent = `${diffVal2Text} (${whichMoreVal2})`;

    // ===== 2. % DE DIFFÉRENCE SUR LES RATIOS =====
    const percentDiffRatio1 = ((ratio2_r1 - ratio1_r1) / ratio1_r1 * 100).toFixed(1);
    const percentDiffRatio2 = ((ratio2_r2 - ratio1_r2) / ratio1_r2 * 100).toFixed(1);

    const symbolRatio1 = percentDiffRatio1 >= 0 ? '+' : '';
    const symbolRatio2 = percentDiffRatio2 >= 0 ? '+' : '';

    document.getElementById('comp-percent-ratio1-label').textContent = 
        `${this.escapeHtml(p2.name)} : ${symbolRatio1}${percentDiffRatio1}% sur ${p1.unit1}/${p1.unit2}`;
    document.getElementById('comp-percent-ratio1-value').textContent = '';

    document.getElementById('comp-percent-ratio2-label').textContent = 
        `${this.escapeHtml(p2.name)} : ${symbolRatio2}${percentDiffRatio2}% sur ${p1.unit2}/${p1.unit1}`;
    document.getElementById('comp-percent-ratio2-value').textContent = '';

    // ===== 3. VALEUR NORMALISÉE POUR 100 DE L'UNITÉ 2 =====
    const normalizedVal1_p1 = (p1.val1 / p1.val2 * 100).toFixed(2);
    const normalizedVal1_p2 = (p2.val1 / p2.val2 * 100).toFixed(2);

    document.getElementById('comp-normalized-label').textContent = 
        `Pour 100${p1.unit2}`;
    document.getElementById('comp-normalized-value').textContent = 
        `${this.escapeHtml(p1.name)} : ${normalizedVal1_p1}${p1.unit1} | ${this.escapeHtml(p2.name)} : ${normalizedVal1_p2}${p1.unit1}`;
}

formatNumber(num) {
    if (Math.abs(num) >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    } else if (Math.abs(num) >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

    // ===== DATABASE =====
    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ProCro', 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('calculations')) {
                    const store = db.createObjectStore('calculations', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('date', 'date', { unique: false });
                }
            };
        });
    }

    addToHistory(name, a, b, c, result) {
        if (!this.db) return;

        const transaction = this.db.transaction(['calculations'], 'readwrite');
        const store = transaction.objectStore('calculations');

        store.add({
            name: name || `Calcul ${new Date().toLocaleString()}`,
            a, b, c, result,
            date: new Date().toISOString(),
            formula: `Si ${a} = ${b}, alors ${c} = ${result.toFixed(4)}`
        });

        transaction.oncomplete = () => this.loadHistory();
    }

    async loadHistory() {
        if (!this.db) return;

        const transaction = this.db.transaction(['calculations'], 'readonly');
        const store = transaction.objectStore('calculations');
        const request = store.getAll();

        request.onsuccess = () => {
            const calculations = request.result.reverse();
            this.displayHistory(calculations);
        };
    }

    displayHistory(calculations) {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        if (calculations.length === 0) {
            historyList.innerHTML = '<p class="empty-state">Aucun calcul sauvegardé. Effectue un calcul et sauvegarde-le !</p>';
            return;
        }

        historyList.innerHTML = calculations.map(calc => `
            <div class="history-item">
                <div class="history-item-content">
                    <div class="history-item-name">${this.escapeHtml(calc.name)}</div>
                    <div class="history-item-formula">${calc.a} → ${calc.b} × ${calc.c} = ${calc.result.toFixed(4)}</div>
                </div>
                <div class="history-item-buttons">
                    <button class="btn btn-secondary btn-sm" onclick="app.loadCalculation(${calc.id}, ${calc.a}, ${calc.b}, ${calc.c})">Charger</button>
                    <button class="btn btn-danger btn-sm" onclick="app.deleteCalculation(${calc.id})">Supprimer</button>
                </div>
            </div>
        `).join('');
    }

    deleteCalculation(id) {
        if (!this.db || !confirm('Supprimer ce calcul ?')) return;

        const transaction = this.db.transaction(['calculations'], 'readwrite');
        const store = transaction.objectStore('calculations');
        store.delete(id);

        transaction.oncomplete = () => this.loadHistory();
    }

    loadCalculation(id, a, b, c) {
        const inputA = document.getElementById('inputA');
        const inputB = document.getElementById('inputB');
        const inputC = document.getElementById('inputC');

        if (inputA) inputA.value = a;
        if (inputB) inputB.value = b;
        if (inputC) inputC.value = c;

        this.calculate();
        this.switchPage('calculator');
    }

    // ===== CALCULATION =====
    calculate(verbose = false) {
        const inputA = document.getElementById('inputA');
        const inputB = document.getElementById('inputB');
        const inputC = document.getElementById('inputC');
        const resultElement = document.getElementById('resultX');

        if (!inputA || !inputB || !inputC || !resultElement) return;

        const a = parseFloat(inputA.value) || 0;
        const b = parseFloat(inputB.value) || 0;
        const c = parseFloat(inputC.value) || 0;

        if (a === 0 || !a || !b || !c) {
            resultElement.textContent = '-';
            return;
        }

        const result = (b * c) / a;
        resultElement.textContent = result.toFixed(2);
    }

    saveResult() {
        const resultNameInput = document.getElementById('resultName');
        const inputA = document.getElementById('inputA');
        const inputB = document.getElementById('inputB');
        const inputC = document.getElementById('inputC');
        const resultElement = document.getElementById('resultX');

        if (!resultNameInput || !inputA || !inputB || !inputC || !resultElement) return;

        const name = resultNameInput.value.trim();
        const a = parseFloat(inputA.value);
        const b = parseFloat(inputB.value);
        const c = parseFloat(inputC.value);
        const result = parseFloat(resultElement.textContent);

        if (!a || !b || !c || !result || isNaN(result)) {
            alert('Veuillez d\'abord effectuer un calcul valide.');
            return;
        }

        this.addToHistory(name, a, b, c, result);
        resultNameInput.value = '';
        alert('Calcul sauvegardé avec succès ! 📝');
    }

    // ===== NAVIGATION =====
    switchPage(pageName) {
        // Masque toutes les pages
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

        // Affiche la page sélectionnée
        document.getElementById(pageName)?.classList.add('active');
        document.querySelector(`[data-page="${pageName}"]`)?.classList.add('active');
    }

    // ===== UTILITY =====
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Démarre l'app au chargement du DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new ProCro();
    });
} else {
    const app = new ProCro();
}
