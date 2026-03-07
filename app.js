// --- 1. Initialization and State ---
if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

let state = JSON.parse(localStorage.getItem('assetFolioDB')) || {
    accounts: [
        { id: 'acc1', name: 'メイン口座', icon: '🏦' }
    ],
    stocks: [
        { id: 's1', accountId: 'acc1', ticker: 'AAPL', purchasePrice: 180, currentPrice: 0, shares: 10, currency: 'USD' },
        { id: 's2', accountId: 'acc1', ticker: '7203.T', purchasePrice: 3000, currentPrice: 0, shares: 100, currency: 'JPY' }
    ],
    lastUpdated: null,
    settings: { exchangeRate: 150 }
};

let allocationChart = null;
let chartType = 'ticker';

// --- 2. Core Functions ---

function mergeDuplicateAccounts() {
    const nameMap = {}; // name -> primaryId
    const duplicates = []; // list of ids to be merged into primary

    state.accounts.forEach(acc => {
        if (!nameMap[acc.name]) {
            nameMap[acc.name] = acc.id;
        } else {
            duplicates.push({ oldId: acc.id, newId: nameMap[acc.name] });
        }
    });

    if (duplicates.length === 0) return;

    // Remove duplicates from accounts
    const duplicateIds = duplicates.map(d => d.oldId);
    state.accounts = state.accounts.filter(acc => !duplicateIds.includes(acc.id));

    // Update stocks to point to primary account ID
    state.stocks.forEach(s => {
        const dup = duplicates.find(d => d.oldId === s.accountId);
        if (dup) {
            s.accountId = dup.newId;
        }
    });

    saveData();
}

function saveData() {
    localStorage.setItem('assetFolioDB', JSON.stringify(state));
}

function updateUI() {
    saveData();
    calculateTotalAssets();
    renderAccountList();
    renderStockList();
    renderChart();
    populateAccountSelect();
    
    // Update settings UI
    const rateInput = document.getElementById('setting-exchange-rate');
    if (rateInput) rateInput.value = state.settings.exchangeRate;

    // Update last updated text
    const updateEl = document.getElementById('last-updated');
    if (updateEl) {
        updateEl.textContent = state.lastUpdated ? new Date(state.lastUpdated).toLocaleTimeString() + ' 更新' : '未更新';
    }
}

function calculateTotalAssets() {
    let total = 0;
    state.stocks.forEach(s => {
        const price = s.currentPrice || s.purchasePrice;
        const val = price * s.shares;
        total += (s.currency === 'USD' ? val * state.settings.exchangeRate : val);
    });

    const totalEl = document.querySelector('#totalJPY .amount-value');
    if (totalEl) totalEl.textContent = Math.floor(total).toLocaleString();
}

// --- 3. Rendering ---

function renderChart() {
    const canvas = document.getElementById('allocationChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dataMap = {};
    let grandTotal = 0;

    state.stocks.forEach(s => {
        const acc = state.accounts.find(a => a.id === s.accountId);
        const label = chartType === 'ticker' ? s.ticker : (acc ? acc.name : 'Unknown');
        const price = s.currentPrice || s.purchasePrice;
        const val = price * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
        
        dataMap[label] = (dataMap[label] || 0) + val;
        grandTotal += val;
    });

    if (allocationChart) allocationChart.destroy();
    if (grandTotal === 0) return;

    allocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(dataMap),
            datasets: [{
                data: Object.values(dataMap),
                backgroundColor: ['#bf0000', '#eb0a0a', '#ffffff', '#333333', '#666666'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { display: false },
                datalabels: {
                    color: '#ffffff',
                    font: { weight: 'bold', size: 10 },
                    formatter: (value) => {
                        const pct = (value / grandTotal * 100).toFixed(1);
                        return pct > 5 ? `${pct}%` : '';
                    }
                }
            }
        }
    });
}

function renderAccountList() {
    const listEl = document.getElementById('accountList');
    if (!listEl) return;
    listEl.innerHTML = '';

    state.accounts.forEach(acc => {
        let accTotal = 0;
        state.stocks.filter(s => s.accountId === acc.id).forEach(s => {
            const val = s.purchasePrice * s.shares;
            accTotal += (s.currency === 'USD' ? val * state.settings.exchangeRate : val);
        });

        const div = document.createElement('div');
        div.className = 'account-card';
        div.innerHTML = `
            <div class="acc-info">
                <span class="acc-icon">${acc.icon || '🏦'}</span>
                <span class="acc-name">${acc.name}</span>
            </div>
            <div class="acc-actions">
                <div class="acc-amount">¥${Math.floor(accTotal).toLocaleString()}</div>
                <button class="btn-delete-x" onclick="deleteAccount('${acc.id}')">×</button>
            </div>
        `;
        listEl.appendChild(div);
    });
}

function renderStockList() {
    const listEl = document.getElementById('stockList');
    if (!listEl) return;
    listEl.innerHTML = '';

    state.stocks.forEach(s => {
        const acc = state.accounts.find(a => a.id === s.accountId);
        const price = s.currentPrice || s.purchasePrice;
        const total = price * s.shares;
        const totalJPY = s.currency === 'USD' ? total * state.settings.exchangeRate : total;
        
        const change = s.currentPrice ? (s.currentPrice - s.purchasePrice) * s.shares : 0;
        const changePct = s.currentPrice ? ((s.currentPrice / s.purchasePrice - 1) * 100).toFixed(2) : 0;
        const changeColor = change > 0 ? '#4caf50' : (change < 0 ? '#ff4d4d' : 'inherit');

        const div = document.createElement('div');
        div.className = 'stock-item';
        div.innerHTML = `
            <div class="stock-main">
                <span class="stock-t">${s.ticker}</span>
                <span class="stock-acc">${acc ? acc.name : 'Unknown'}</span>
            </div>
            <div class="stock-info">
                <div class="stock-v">¥${Math.floor(totalJPY).toLocaleString()}</div>
                <div class="stock-p" style="color: ${changeColor}">
                    ${s.currentPrice ? `¥${Math.floor(s.currentPrice).toLocaleString()} (${changePct}%)` : `@${s.currency === 'USD' ? '$' : '¥'}${s.purchasePrice}`}
                </div>
            </div>
            <button class="btn-delete-small" onclick="deleteStock('${s.id}')" style="grid-column: span 2; margin-top: 5px; background: none; border: none; color: #ff4d4d; cursor: pointer; text-align: left; font-size: 0.7rem; opacity: 0.6;">削除する</button>
        `;
        listEl.appendChild(div);
    });
}

// --- 4. Actions ---

function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screenId}`).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`nav-${screenId}`).classList.add('active');
}

function switchChart(type) {
    chartType = type;
    document.querySelectorAll('.chart-tab').forEach(btn => {
        btn.classList.toggle('active', (type === 'ticker' && btn.innerText.includes('銘柄')) || (type === 'account' && btn.innerText.includes('口座')));
    });
    renderChart();
}

function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function hideModal(id) { document.getElementById(id).style.display = 'none'; }

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Override alerts with toasts
function addAccount() {
    const name = document.getElementById('acc-name').value;
    const icon = document.getElementById('acc-icon').value || '🏦';
    if (!name) return showToast('口座名を入力してください');

    // Check for duplicates
    const existing = state.accounts.find(a => a.name === name);
    if (existing) {
        showToast('同名の口座が既に存在するため、既存の口座に追加されます');
        hideModal('modal-add-account');
        document.getElementById('acc-name').value = '';
        return;
    }

    const newAcc = { id: 'acc_' + Date.now(), name, icon };
    state.accounts.push(newAcc);
    updateUI();
    hideModal('modal-add-account');
    document.getElementById('acc-name').value = '';
    showToast('口座を追加しました');
}

function addStock() {
    const accId = document.getElementById('stock-acc-id').value;
    const ticker = document.getElementById('stock-ticker').value;
    const price = Number(document.getElementById('stock-price').value);
    const shares = Number(document.getElementById('stock-shares').value);
    const currency = document.getElementById('stock-currency').value;

    if (!ticker || !price || !shares) return showToast('全ての項目を入力してください');

    const newStock = { id: 's_' + Date.now(), accountId: accId, ticker, purchasePrice: price, currentPrice: 0, shares, currency };
    state.stocks.push(newStock);
    updateUI();
    hideModal('modal-add-stock');
    document.getElementById('stock-ticker').value = '';
    document.getElementById('stock-price').value = '';
    document.getElementById('stock-shares').value = '';
    showToast('銘柄を追加しました');
    fetchAllData(); // Try to fetch price for the new stock
}

function deleteStock(id) {
    if (!confirm('銘柄を削除しますか？')) return;
    state.stocks = state.stocks.filter(s => s.id !== id);
    updateUI();
    showToast('銘柄を削除しました');
}

function deleteAccount(id) {
    if (state.stocks.some(s => s.accountId === id)) {
        return showToast('この口座には銘柄が登録されているため削除できません');
    }
    if (!confirm('口座を削除しますか？')) return;
    state.accounts = state.accounts.filter(a => a.id !== id);
    updateUI();
    showToast('口座を削除しました');
}

function populateAccountSelect() {
    const select = document.getElementById('stock-acc-id');
    if (!select) return;
    select.innerHTML = '';
    state.accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = acc.name;
        select.appendChild(opt);
    });
}

function updateExchangeRate(val) {
    state.settings.exchangeRate = Number(val);
    updateUI();
}

// --- 5. Real-Time Data Fetching ---

async function fetchAllData() {
    const btn = document.getElementById('refresh-btn');
    if (btn) btn.classList.add('loading');
    
    try {
        await Promise.all([
            fetchExchangeRate(),
            fetchStockPrices()
        ]);
        state.lastUpdated = Date.now();
        showToast('データを更新しました');
    } catch (e) {
        console.error(e);
        showToast('データ更新に失敗しました');
    } finally {
        if (btn) btn.classList.remove('loading');
        updateUI();
    }
}

async function fetchExchangeRate() {
    try {
        const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=JPY');
        const data = await res.json();
        if (data && data.rates && data.rates.JPY) {
            state.settings.exchangeRate = data.rates.JPY;
        }
    } catch (e) {
        console.warn('FX fetch failed', e);
    }
}

async function fetchStockPrices() {
    const tickers = [...new Set(state.stocks.map(s => s.ticker))];
    if (tickers.length === 0) return;

    for (const symbol of tickers) {
        // v8/chart API through corsproxy.io (more reliable than v7/quote via allorigins)
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;

        try {
            const res = await fetch(proxyUrl);
            const data = await res.json();
            
            if (data && data.chart && data.chart.result && data.chart.result[0]) {
                const meta = data.chart.result[0].meta;
                const price = meta.regularMarketPrice;
                
                if (price) {
                    state.stocks.forEach(s => {
                        if (s.ticker === symbol) {
                            s.currentPrice = price;
                        }
                    });
                }
            }
        } catch (e) {
            console.warn(`Stock fetch failed for ${symbol}`, e);
        }
    }
}

function resetData() {
    if (!confirm('全てのデータを削除して初期化しますか？')) return;
    state = { accounts: [], stocks: [], settings: { exchangeRate: 150 } };
    updateUI();
}

// --- 5. Initial Load ---
window.onload = async () => {
    mergeDuplicateAccounts();
    updateUI();
    // Start automated fetch on load
    await fetchAllData();
};
