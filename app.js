// --- 1. Initialization and State ---
if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

let state = JSON.parse(localStorage.getItem('assetFolioDB')) || {
    profiles: [{ id: 'p_default', name: '本人' }],
    currentProfileId: 'p_default',
    accounts: [
        { id: 'acc1', name: 'メイン口座', icon: '🏦', profileId: 'p_default' }
    ],
    stocks: [
        { id: 's1', accountId: 'acc1', ticker: 'AAPL', purchasePrice: 180, currentPrice: 0, shares: 10, currency: 'USD' },
        { id: 's2', accountId: 'acc1', ticker: '7203.T', purchasePrice: 3000, currentPrice: 0, shares: 100, currency: 'JPY' }
    ],
    lastUpdated: null,
    settings: { exchangeRate: 150, privacyMode: false }
};

// --- Profile Migration & Helpers ---
if (!state.profiles) {
    state.profiles = [{ id: 'p_default', name: '本人' }];
    state.currentProfileId = 'p_default';
}
if (!state.currentProfileId) {
    state.currentProfileId = state.profiles[0].id;
}
state.accounts.forEach(acc => {
    if (!acc.profileId) acc.profileId = 'p_default';
});

function getProfileAccounts(profileId = state.currentProfileId) {
    return state.accounts.filter(a => a.profileId === profileId);
}

function getProfileStocks(profileId = state.currentProfileId) {
    const accIds = state.accounts.filter(a => a.profileId === profileId).map(a => a.id);
    return state.stocks.filter(s => accIds.includes(s.accountId));
}

let allocationChart = null;
let chartType = 'ticker';
let editingAccountId = null;
let editingStockId = null;

// --- 2. Core Functions ---

function mergeDuplicateAccounts() {
    const nameMap = {}; // name -> primaryId
    const duplicates = []; // list of ids to be merged into primary

    state.accounts.forEach(acc => {
        const key = `${acc.profileId || 'p_default'}_${acc.name}`;
        if (!nameMap[key]) {
            nameMap[key] = acc.id;
        } else {
            duplicates.push({ oldId: acc.id, newId: nameMap[key] });
        }
    });

    if (duplicates.length > 0) {
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
    }

    migrateStocks();
    saveData();
}

function migrateStocks() {
    let changed = false;
    state.stocks.forEach(s => {
        const oldTicker = s.ticker;
        
        // Enforce uppercase
        s.ticker = s.ticker.toUpperCase();
        
        // Fix 4-digit Japanese tickers missing .T
        if (/^\d{4}$/.test(s.ticker)) {
            s.ticker += '.T';
        }

        if (s.ticker !== oldTicker) {
            // If name was default ticker, update it too
            if (!s.name || s.name === oldTicker || s.name === oldTicker.toUpperCase()) {
                s.name = s.ticker;
            }
            changed = true;
        }
    });
    if (changed) {
        saveData();
    }
}

function saveData() {
    localStorage.setItem('assetFolioDB', JSON.stringify(state));
}

function updateUI() {
    saveData();
    populateProfileSwitcher();
    renderProfileList();
    calculateTotalAssets();
    renderAccountList();
    renderStockList();
    renderChart();
    populateAccountSelect();
    
    // Update settings UI
    const rateInput = document.getElementById('setting-exchange-rate');
    if (rateInput) rateInput.value = state.settings.exchangeRate;

    const privacyToggle = document.getElementById('setting-privacy-mode');
    if (privacyToggle) privacyToggle.checked = state.settings.privacyMode;

    if (state.settings.privacyMode) {
        document.body.classList.add('privacy-mode');
    } else {
        document.body.classList.remove('privacy-mode');
    }

    // Update last updated text
    const updateEl = document.getElementById('last-updated');
    if (updateEl) {
        updateEl.textContent = state.lastUpdated ? new Date(state.lastUpdated).toLocaleTimeString() + ' 更新' : '未更新';
    }
}

function populateProfileSwitcher() {
    const switcher = document.getElementById('profile-switcher');
    if (!switcher) return;
    switcher.innerHTML = state.profiles.map(p => 
        `<option value="${p.id}" ${p.id === state.currentProfileId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
}

function renderProfileList() {
    const listEl = document.getElementById('profile-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    state.profiles.forEach(p => {
        const div = document.createElement('div');
        div.className = 'profile-item';
        div.innerHTML = `
            <div class="profile-item-main">
                <input type="text" class="profile-name-input" value="${p.name}" onchange="renameProfile('${p.id}', this.value)">
            </div>
            <div class="profile-actions" style="display: flex; gap: 8px; align-items: center;">
                <button class="btn-icon-copy" onclick="copyProfile('${p.id}')" title="コピー" style="background: none; border: none; cursor: pointer; font-size: 1.1rem; opacity: 0.7;">👯</button>
                ${state.profiles.length > 1 ? `<button class="btn-icon-delete" onclick="deleteProfile('${p.id}')" style="background: none; border: none; cursor: pointer; opacity: 0.6;">🗑️</button>` : ''}
            </div>
        `;
        listEl.appendChild(div);
    });
}

function switchProfile(id) {
    state.currentProfileId = id;
    updateUI();
    showToast(`${state.profiles.find(p => p.id === id).name} に切り替えました`);
}

function addProfile() {
    const input = document.getElementById('new-profile-name');
    const name = input.value.trim();
    if (!name) return showToast('名前を入力してください');
    
    const newProfile = { id: 'p_' + Date.now(), name };
    state.profiles.push(newProfile);
    input.value = '';
    updateUI();
    showToast('プロファイルを追加しました');
}

function renameProfile(id, newName) {
    const p = state.profiles.find(p => p.id === id);
    if (p && newName.trim()) {
        p.name = newName.trim();
        saveData();
        populateProfileSwitcher();
    }
}

function copyProfile(id) {
    const sourceProfile = state.profiles.find(p => p.id === id);
    if (!sourceProfile) return;

    // 1. Create new profile
    const newProfile = {
        id: 'p_' + Date.now(),
        name: sourceProfile.name + ' (コピー)'
    };
    state.profiles.push(newProfile);

    // 2. Clone accounts
    const sourceAccounts = state.accounts.filter(a => a.profileId === id);
    sourceAccounts.forEach(oldAcc => {
        const newAccId = 'acc_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        const newAcc = { ...oldAcc, id: newAccId, profileId: newProfile.id };
        state.accounts.push(newAcc);

        // 3. Clone stocks for this account
        const sourceStocks = state.stocks.filter(s => s.accountId === oldAcc.id);
        sourceStocks.forEach(oldStock => {
            const newStockId = 's_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            const newStock = { ...oldStock, id: newStockId, accountId: newAccId };
            state.stocks.push(newStock);
        });
    });

    updateUI();
    showToast(`${sourceProfile.name} をコピーしました`);
}

function deleteProfile(id) {
    if (state.profiles.length <= 1) return;
    if (!confirm('このプロファイルを削除しますか？関連するデータも全て削除されます。')) return;
    
    // Scoped reset first
    resetProfile(id, false);
    
    state.profiles = state.profiles.filter(p => p.id !== id);
    if (state.currentProfileId === id) {
        state.currentProfileId = state.profiles[0].id;
    }
    updateUI();
}

function resetProfile(id = state.currentProfileId, ask = true) {
    if (ask && !confirm('現在のプロファイルの全データを消去しますか？この操作は取り消せません。')) return;
    
    const accs = state.accounts.filter(a => a.profileId === id);
    const accIds = accs.map(a => a.id);
    
    state.stocks = state.stocks.filter(s => !accIds.includes(s.accountId));
    state.accounts = state.accounts.filter(a => a.profileId !== id);
    
    updateUI();
    if (ask) showToast('データをリセットしました');
    saveData();
}

function getStockDisplayNames(s) {
    if (!s) return { primary: 'Unknown', secondary: '' };
    // Numeric ticker (usually Japanese stocks like 7203.T)
    const isNumeric = /^\d/.test(s.ticker);
    if (isNumeric) {
        return { primary: s.name || s.ticker, secondary: s.ticker };
    } else {
        // Alphabetical ticker (usually Foreign stocks like AAPL)
        // If name exists and is different from ticker, use ticker as primary
        return { primary: s.ticker, secondary: (s.name && s.name !== s.ticker) ? s.name : '' };
    }
}

function calculateTotalAssets() {
    let total = 0;
    const stocks = getProfileStocks();
    const accounts = getProfileAccounts();

    // Sum Stocks
    stocks.forEach(s => {
        const price = s.currentPrice || s.purchasePrice;
        const val = price * s.shares;
        total += (s.currency === 'USD' ? val * state.settings.exchangeRate : val);
    });

    // Sum Cash
    accounts.forEach(acc => {
        total += (Number(acc.cashJPY) || 0);
        total += (Number(acc.cashUSD) || 0) * state.settings.exchangeRate;
    });

    const totalEl = document.querySelector('#totalJPY .amount-value');
    if (totalEl) totalEl.innerHTML = `<span class="privacy-blur">${Math.floor(total).toLocaleString()}</span>`;
}

// --- 3. Rendering ---

function renderChart() {
    const canvas = document.getElementById('allocationChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dataMap = {};
    let grandTotal = 0;

    const stocks = getProfileStocks();
    const accounts = getProfileAccounts();

    if (chartType === 'assetClass') {
        // Group by Asset Class
        stocks.forEach(s => {
            const label = s.assetClass || (s.ticker.includes('.T') ? '日本株' : '外国株');
            const price = s.currentPrice || s.purchasePrice;
            const val = price * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
            dataMap[label] = (dataMap[label] || 0) + val;
            grandTotal += val;
        });
        // Add Cash
        let cashVal = 0;
        accounts.forEach(acc => {
            cashVal += (Number(acc.cashJPY) || 0) + (Number(acc.cashUSD) || 0) * state.settings.exchangeRate;
        });
        if (cashVal > 0) {
            dataMap['現金'] = (dataMap['現金'] || 0) + cashVal;
            grandTotal += cashVal;
        }
    } else {
        stocks.forEach(s => {
            const acc = accounts.find(a => a.id === s.accountId);
            const names = getStockDisplayNames(s);
            const label = chartType === 'ticker' ? names.primary : (acc ? acc.name : 'Unknown');
            const price = s.currentPrice || s.purchasePrice;
            const val = price * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
            
            dataMap[label] = (dataMap[label] || 0) + val;
            grandTotal += val;
        });
    }

    if (allocationChart) allocationChart.destroy();
    
    // Clear list
    const listEl = document.getElementById('allocationListData');
    if (listEl) listEl.innerHTML = '';

    if (grandTotal === 0) return;

    // Grouping Logic
    const fullList = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
    const processedList = [];
    let othersValue = 0;

    fullList.forEach((entry, index) => {
        const [label, val] = entry;
        const pct = (val / grandTotal) * 100;

        // Group into "Other" if:
        // 1. Position is 15th or later (index >= 14)
        // 2. Percentage is 2.0% or less
        if (index >= 14 || pct <= 2.0) {
            othersValue += val;
        } else {
            processedList.push({ label, val, pct });
        }
    });

    if (othersValue > 0) {
        processedList.push({ 
            label: 'その他', 
            val: othersValue, 
            pct: (othersValue / grandTotal) * 100 
        });
    }

    const labels = processedList.map(item => item.label);
    const values = processedList.map(item => item.val);
    
    // 15 Premium Colors (Mix of Crimson/Red variants and neutral tones)
    const colors = [
        '#bf0000', '#eb0a0a', '#ff3333', '#8b0000', '#5e0000', 
        '#ffffff', '#f0f0f0', '#dcdcdc', '#c0c0c0', '#a9a9a9', 
        '#808080', '#696969', '#555555', '#333333', '#1a1a1a'
    ];

    // Render List
    if (listEl) {
        processedList.forEach((item, i) => {
            const color = colors[i % colors.length];
            const listItem = document.createElement('div');
            listItem.className = 'chart-list-item';
            listItem.onclick = () => showDrillDown(item.label);
            listItem.innerHTML = `
                <div class="cli-label">
                    <span class="cli-dot" style="background: ${color}"></span>
                    <span class="cli-name">${item.label}</span>
                </div>
                <div class="cli-value">
                    <span class="privacy-blur">¥${Math.floor(item.val).toLocaleString()}</span>
                    <span class="cli-pct">${item.pct.toFixed(1)}%</span>
                </div>
            `;
            listEl.appendChild(listItem);
        });
    }

    allocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const label = labels[index];
                    showDrillDown(label);
                }
            },
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

    const currentAccounts = getProfileAccounts();
    const currentStocks = getProfileStocks();

    currentAccounts.forEach(acc => {
        const accStocks = currentStocks.filter(s => s.accountId === acc.id);
        const accTotal = accStocks.reduce((sum, s) => {
            const p = s.currentPrice || s.purchasePrice;
            const v = p * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
            return sum + v;
        }, 0);
        const div = document.createElement('div');
        div.className = 'account-card';
        div.innerHTML = `
            <div class="acc-info">
                <span class="acc-icon">${acc.icon || '🏦'}</span>
                <div class="acc-name-stack">
                    <span class="acc-name">${acc.name}</span>
                    ${(acc.cashJPY || acc.cashUSD) ? `
                        <div class="acc-cash-line">
                            現金: ${acc.cashJPY ? `¥${Math.floor(acc.cashJPY).toLocaleString()} ` : ''}${acc.cashUSD ? `$${acc.cashUSD.toLocaleString()}` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="acc-actions">
                <div class="acc-amount"><span class="privacy-blur">¥${Math.floor(accTotal).toLocaleString()}</span></div>
                <div class="acc-btns">
                    <button class="btn-icon-edit" onclick="openEditAccountModal('${acc.id}')">✏️</button>
                    <button class="btn-delete-x" onclick="deleteAccount('${acc.id}')">🗑️</button>
                </div>
            </div>
        `;
        listEl.appendChild(div);
    });
}

function renderStockList() {
    const listEl = document.getElementById('stockList');
    if (!listEl) return;
    listEl.innerHTML = '';

    const currentStocks = getProfileStocks();
    const currentAccounts = getProfileAccounts();

    // Sort stocks by total value descending
    const sortedStocks = [...currentStocks].sort((a, b) => {
        const valA = (a.currentPrice || a.purchasePrice) * a.shares * (a.currency === 'USD' ? state.settings.exchangeRate : 1);
        const valB = (b.currentPrice || b.purchasePrice) * b.shares * (b.currency === 'USD' ? state.settings.exchangeRate : 1);
        return valB - valA;
    });

    sortedStocks.forEach(s => {
        const acc = currentAccounts.find(a => a.id === s.accountId);
        const names = getStockDisplayNames(s);
        const assetClass = s.assetClass || (s.ticker.includes('.T') ? '日本株' : '外国株');
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
                <div class="stock-t-row">
                    <span class="stock-t">${names.primary}</span>
                    <span class="badge-asset-class">${assetClass}</span>
                </div>
                <span class="stock-tick">${names.secondary}${names.secondary ? ' | ' : ''}${acc ? acc.name : 'Unknown'}</span>
            </div>
            <div class="stock-info">
                <div class="stock-v"><span class="privacy-blur">¥${Math.floor(totalJPY).toLocaleString()}</span></div>
                <div class="stock-p" style="color: ${changeColor}">
                    ${s.currentPrice ? `¥${Math.floor(s.currentPrice).toLocaleString()} (${changePct}%)` : `@${s.currency === 'USD' ? '$' : '¥'}${s.purchasePrice}`}
                </div>
            </div>
            <div class="acc-btns" style="grid-column: span 2; margin-top: 8px;">
                <button class="btn-icon-edit" onclick="openEditStockModal('${s.id}')" style="font-size: 0.8rem; opacity: 0.7;">✏️ 編集</button>
                <button class="btn-delete-x" onclick="deleteStock('${s.id}')" style="font-size: 0.8rem; opacity: 0.7; margin-left: auto;">🗑️ 削除</button>
            </div>
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
        const triggers = {
            'ticker': ['銘柄'],
            'assetClass': ['資産'],
            'account': ['口座']
        };
        const match = triggers[type].some(t => btn.innerText.includes(t));
        btn.classList.toggle('active', match);
    });
    renderChart();
}

// --- 5. Navigation & UI Controls ---

function openAddAccountModal() {
    editingAccountId = null;
    const modal = document.getElementById('modal-add-account');
    if (modal) {
        const title = modal.querySelector('h3');
        if (title) title.textContent = '口座を追加';
        document.getElementById('acc-name').value = '';
        document.getElementById('acc-icon').value = '';
        document.getElementById('acc-cash-jpy').value = '0';
        document.getElementById('acc-cash-usd').value = '0';
    }
    showModal('modal-add-account');
}

function openAddStockModal() {
    editingStockId = null;
    const modal = document.getElementById('modal-add-stock');
    if (modal) {
        const title = modal.querySelector('h3');
        if (title) title.textContent = '銘柄を追加';
        document.getElementById('stock-ticker').value = '';
        document.getElementById('stock-price').value = '';
        document.getElementById('stock-shares').value = '';
    }
    showModal('modal-add-stock');
}

function showModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
}
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
    const name = document.getElementById('acc-name').value.trim();
    const icon = document.getElementById('acc-icon').value.trim() || '🏦';
    const cashJPY = Number(document.getElementById('acc-cash-jpy').value) || 0;
    const cashUSD = Number(document.getElementById('acc-cash-usd').value) || 0;

    if (!name) return showToast('口座名を入力してください');

    if (editingAccountId) {
        const acc = state.accounts.find(a => a.id === editingAccountId);
        if (acc) {
            acc.name = name;
            acc.icon = icon;
            acc.cashJPY = cashJPY;
            acc.cashUSD = cashUSD;
            showToast('口座情報を更新しました');
        }
        editingAccountId = null;
    } else {
        const newAcc = { 
            id: 'acc_' + Date.now(), 
            name, icon, 
            profileId: state.currentProfileId,
            cashJPY, cashUSD
        };
        state.accounts.push(newAcc);
        showToast('口座を追加しました');
    }

    updateUI();
    hideModal('modal-add-account');
    document.getElementById('acc-name').value = '';
    document.getElementById('acc-icon').value = '';
    document.getElementById('acc-cash-jpy').value = '0';
    document.getElementById('acc-cash-usd').value = '0';
}

function openEditAccountModal(id) {
    const acc = state.accounts.find(a => a.id === id);
    if (!acc) return;
    
    editingAccountId = id;
    document.getElementById('acc-name').value = acc.name;
    document.getElementById('acc-icon').value = acc.icon || '🏦';
    document.getElementById('acc-cash-jpy').value = acc.cashJPY || 0;
    document.getElementById('acc-cash-usd').value = acc.cashUSD || 0;
    
    const modal = document.getElementById('modal-add-account');
    const title = modal.querySelector('h3');
    if (title) title.textContent = '口座を編集';
    
    showModal('modal-add-account');
}

function addStock() {
    const accId = document.getElementById('stock-acc-id').value;
    let ticker = document.getElementById('stock-ticker').value.trim();
    const price = Number(document.getElementById('stock-price').value);
    const shares = Number(document.getElementById('stock-shares').value);
    const currency = document.getElementById('stock-currency').value;
    const assetClass = document.getElementById('stock-asset-class').value;

    if (!accId) return showToast('先に口座を登録してください');
    if (!ticker || !price || !shares) return showToast('全ての項目を入力してください');

    if (editingStockId) {
        const stock = state.stocks.find(s => s.id === editingStockId);
        if (stock) {
            stock.accountId = accId;
            stock.ticker = ticker;
            stock.purchasePrice = price;
            stock.shares = shares;
            stock.currency = currency;
            stock.assetClass = assetClass;
            showToast('銘柄情報を更新しました');
        }
        editingStockId = null;
    } else {
        const newStock = { 
            id: 's_' + Date.now(), 
            accountId: accId, 
            ticker, 
            name: ticker, 
            purchasePrice: price, 
            currentPrice: 0, 
            shares, 
            currency,
            assetClass
        };
        state.stocks.push(newStock);
        showToast('銘柄を追加しました');
    }

    updateUI();
    hideModal('modal-add-stock');
    document.getElementById('stock-ticker').value = '';
    document.getElementById('stock-price').value = '';
    document.getElementById('stock-shares').value = '';
    fetchAllData();
}

function openEditStockModal(id) {
    const stock = state.stocks.find(s => s.id === id);
    if (!stock) return;
    
    editingStockId = id;
    document.getElementById('stock-acc-id').value = stock.accountId;
    document.getElementById('stock-ticker').value = stock.ticker;
    document.getElementById('stock-price').value = stock.purchasePrice;
    document.getElementById('stock-shares').value = stock.shares;
    document.getElementById('stock-currency').value = stock.currency;
    document.getElementById('stock-asset-class').value = stock.assetClass || (stock.ticker.includes('.T') ? '日本株' : '外国株');
    
    const modal = document.getElementById('modal-add-stock');
    const title = modal.querySelector('h3');
    if (title) title.textContent = '銘柄を編集';
    
    showModal('modal-add-stock');
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
    const currentAccounts = getProfileAccounts();
    currentAccounts.forEach(acc => {
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

function togglePrivacyMode(enabled) {
    state.settings.privacyMode = enabled;
    updateUI();
}

// --- 6. Drill-Down detail view ---

function showDrillDown(label) {
    const detailTitle = document.getElementById('detail-title');
    const detailBody = document.getElementById('detail-body');
    if (!detailTitle || !detailBody) return;

    detailBody.innerHTML = '';
    
    const currentStocks = getProfileStocks();
    const currentAccounts = getProfileAccounts();
    
    // Determine display title and data
    // Try to find stocks by ticker OR name
    const stocksByTicker = currentStocks.filter(s => s.ticker === label || s.name === label);
    const account = currentAccounts.find(a => a.name === label);

    if (stocksByTicker.length > 0) {
        const names = getStockDisplayNames(stocksByTicker[0]);
        detailTitle.innerHTML = `
            <div>${names.primary}</div>
            <div class="detail-subtitle">${names.secondary}</div>
        `;
    } else {
        detailTitle.textContent = label;
    }

    // Predicate: which view to show?
    const showTickerView = stocksByTicker.length > 0 && (chartType === 'ticker' || !account);
    const showAccountView = account && !showTickerView;
    const isOther = label === 'その他';
    const assetClasses = ['日本株', '外国株', '投資信託', '仮想通貨', '現金'];
    const isAssetClass = assetClasses.includes(label);

    if (isAssetClass) {
        if (label === '現金') {
            detailTitle.textContent = '現金内訳';
            const cashAccounts = currentAccounts.filter(a => a.cashJPY > 0 || a.cashUSD > 0);
            detailBody.innerHTML = `
                <div class="detail-stock-list">
                    ${cashAccounts.map(a => {
                        const v = (a.cashJPY || 0) + (a.cashUSD || 0) * state.settings.exchangeRate;
                        return `
                            <div class="stock-item" style="margin: 0">
                                <div class="stock-main">
                                    <span class="stock-t">${a.icon} ${a.name}</span>
                                </div>
                                <div class="stock-info">
                                    <div class="stock-v"><span class="privacy-blur">¥${Math.floor(v).toLocaleString()}</span></div>
                                    <div class="stock-p">
                                        ${a.cashJPY ? `¥${Math.floor(a.cashJPY).toLocaleString()}` : ''}
                                        ${a.cashJPY && a.cashUSD ? ' / ' : ''}
                                        ${a.cashUSD ? `$${a.cashUSD.toLocaleString()}` : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    ${cashAccounts.length === 0 ? '<p style="text-align:center; padding:20px; color:var(--text-sub)">現金データはありません</p>' : ''}
                </div>
            `;
        } else {
            detailTitle.textContent = `${label} 一覧`;
            const classStocks = currentStocks.filter(s => {
                const sClass = s.assetClass || (s.ticker.includes('.T') ? '日本株' : '外国株');
                return sClass === label;
            }).sort((a,b) => {
                const vA = (a.currentPrice || a.purchasePrice) * a.shares * (a.currency === 'USD' ? state.settings.exchangeRate : 1);
                const vB = (b.currentPrice || b.purchasePrice) * b.shares * (b.currency === 'USD' ? state.settings.exchangeRate : 1);
                return vB - vA;
            });

            detailBody.innerHTML = `
                <div class="detail-stock-list">
                    ${classStocks.map(s => {
                        const p = s.currentPrice || s.purchasePrice;
                        const v = p * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
                        const names = getStockDisplayNames(s);
                        return `
                            <div class="stock-item drill-downable" style="margin: 0" onclick="showDrillDown('${names.primary}')">
                                <div class="stock-main">
                                    <span class="stock-t">${names.primary}</span>
                                </div>
                                <div class="stock-info">
                                    <div class="stock-v"><span class="privacy-blur">¥${Math.floor(v).toLocaleString()}</span></div>
                                    <div class="stock-p">${s.shares}株 (${s.currency})</div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    ${classStocks.length === 0 ? '<p style="text-align:center; padding:20px; color:var(--text-sub)">該当する銘柄はありません</p>' : ''}
                </div>
            `;
        }
    } else if (isOther) {
        detailTitle.textContent = 'その他資産一覧';
        
        // Recalculate grouping to find which stocks are "Other"
        const dataMap = {};
        let grandTotal = 0;
        currentStocks.forEach(s => {
            const acc = currentAccounts.find(a => a.id === s.accountId);
            const names = getStockDisplayNames(s);
            const l = chartType === 'ticker' ? names.primary : (acc ? acc.name : 'Unknown');
            const price = s.currentPrice || s.purchasePrice;
            const val = price * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
            dataMap[l] = (dataMap[l] || 0) + val;
            grandTotal += val;
        });

        const sortedEntries = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
        const otherLabels = new Set();
        sortedEntries.forEach((entry, idx) => {
            const [l, val] = entry;
            const pct = (val / grandTotal) * 100;
            if (idx >= 14 || pct <= 2.0) {
                otherLabels.add(l);
            }
        });

        // Find all stocks matching these labels
        const otherStocks = currentStocks.filter(s => {
            const acc = currentAccounts.find(a => a.id === s.accountId);
            const names = getStockDisplayNames(s);
            const l = chartType === 'ticker' ? names.primary : (acc ? acc.name : 'Unknown');
            return otherLabels.has(l);
        }).sort((a,b) => {
            const vA = (a.currentPrice || a.purchasePrice) * a.shares * (a.currency === 'USD' ? state.settings.exchangeRate : 1);
            const vB = (b.currentPrice || b.purchasePrice) * b.shares * (b.currency === 'USD' ? state.settings.exchangeRate : 1);
            return vB - vA;
        });

        detailBody.innerHTML = `
            <div class="detail-stock-list">
                ${otherStocks.map(s => {
                    const p = s.currentPrice || s.purchasePrice;
                    const v = p * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
                    const names = getStockDisplayNames(s);
                    return `
                        <div class="stock-item drill-downable" style="margin: 0" onclick="showDrillDown('${names.primary}')">
                            <div class="stock-main">
                                <span class="stock-t">${names.primary}</span>
                            </div>
                            <div class="stock-info">
                                <div class="stock-v"><span class="privacy-blur">¥${Math.floor(v).toLocaleString()}</span></div>
                                <div class="stock-p">${s.shares}株 (${s.currency})</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } else if (showTickerView) {
        // Show Stock Detail (Sum stats)
        const stocks = stocksByTicker;
        if (stocks.length === 0) return;

        // Aggregate stats (could be across multiple accounts)
        let totalShares = 0;
        let avgCost = 0;
        let totalCost = 0;
        let totalVal = 0;
        let currency = stocks[0].currency;

        stocks.forEach(s => {
            totalShares += s.shares;
            totalCost += s.purchasePrice * s.shares;
            const current = s.currentPrice || s.purchasePrice;
            totalVal += current * s.shares;
        });
        avgCost = totalCost / totalShares;

        const hasCurrentPrice = stocks.some(s => s.currentPrice > 0);
        const diff = hasCurrentPrice ? totalVal - totalCost : 0;
        const diffPct = hasCurrentPrice ? ((totalVal / totalCost - 1) * 100).toFixed(2) : "---";
        const color = hasCurrentPrice ? (diff >= 0 ? '#4caf50' : '#ff4d4d') : 'var(--text-sub)';
        const displayDiff = hasCurrentPrice ? `¥${Math.floor(currency === 'USD' ? diff * state.settings.exchangeRate : diff).toLocaleString()}` : "---";
        const displayVal = hasCurrentPrice ? `¥${Math.floor(currency === 'USD' ? totalVal * state.settings.exchangeRate : totalVal).toLocaleString()}` : "---";
        const currentPriceSingle = stocks[0].currentPrice;
        const displayCurrent = currentPriceSingle > 0 ? `${currency === 'USD' ? '$' : '¥'}${currentPriceSingle.toLocaleString()}` : "---";

        detailBody.innerHTML = `
            <div class="detail-stat-grid">
                <div class="stat-card">
                    <div class="stat-label">評価額</div>
                    <div class="stat-value"><span class="privacy-blur">${displayVal}</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">損益</div>
                    <div class="stat-value" style="color: ${color}"><span class="privacy-blur">${displayDiff}</span> ${hasCurrentPrice ? `(${diffPct}%)` : ''}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">取得総額</div>
                    <div class="stat-value"><span class="privacy-blur">¥${Math.floor(currency === 'USD' ? totalCost * state.settings.exchangeRate : totalCost).toLocaleString()}</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">現在価格</div>
                    <div class="stat-value"><span class="privacy-blur">${displayCurrent}</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">保有数</div>
                    <div class="stat-value">${totalShares.toLocaleString()}株</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">取得単価</div>
                    <div class="stat-value"><span class="privacy-blur">${currency === 'USD' ? '$' : '¥'}${avgCost.toFixed(2)}</span></div>
                </div>
            </div>
            <div class="input-info" style="margin-top: -10px">※複数の口座に跨る場合は合算値を表示しています。</div>
        `;
    } else if (showAccountView) {
        // Show Account Detail (List stocks in this account)
        const accStocks = currentStocks.filter(s => s.accountId === account.id);
        detailTitle.textContent = `${account.icon} ${account.name}`;

        const accountStocks = currentStocks.filter(s => s.accountId === account.id);
        let accountTotal = 0;
        const accountDataMap = {};

        accountStocks.forEach(s => {
            const price = s.currentPrice || s.purchasePrice;
            const val = price * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
            accountTotal += val;
            accountDataMap[s.ticker] = (accountDataMap[s.ticker] || 0) + val;
        });

        // Grouping logic for Account Chart (Same as main chart)
        const sortedEntries = Object.entries(accountDataMap).sort((a,b) => b[1] - a[1]);
        const processedList = [];
        let othersVal = 0;
        sortedEntries.forEach((entry, idx) => {
            const [ticker, val] = entry;
            const pct = (val / accountTotal) * 100;
            if (idx >= 14 || pct <= 2.0) {
                othersVal += val;
            } else {
                processedList.push({ label: ticker, val, pct });
            }
        });
        if (othersVal > 0) {
            processedList.push({ label: 'その他', val: othersVal, pct: (othersVal / accountTotal) * 100 });
        }

        const colors = [
            '#bf0000', '#eb0a0a', '#ff3333', '#8b0000', '#5e0000', 
            '#ffffff', '#f0f0f0', '#dcdcdc', '#c0c0c0', '#a9a9a9', 
            '#808080', '#696969', '#555555', '#333333', '#1a1a1a'
        ];

        detailBody.innerHTML = `
            <div class="stat-card" style="margin-bottom: 20px;">
                <div class="stat-label">口座合計 (推定)</div>
                <div class="stat-value" style="font-size: 1.5rem"><span class="privacy-blur">¥${Math.floor(accountTotal).toLocaleString()}</span></div>
            </div>
            <div class="chart-layout" style="margin-bottom: 20px;">
                <div class="chart-container" style="height: 180px">
                    <canvas id="accountDetailChart"></canvas>
                </div>
                <div id="accountDetailList" class="chart-list-data"></div>
            </div>
            <div class="detail-stock-list">
                <h4 style="margin-bottom: 10px; font-size: 0.9rem; color: var(--text-sub);">銘柄一覧</h4>
                ${accountStocks.sort((a,b) => {
                    const vA = (a.currentPrice || a.purchasePrice) * a.shares * (a.currency === 'USD' ? state.settings.exchangeRate : 1);
                    const vB = (b.currentPrice || b.purchasePrice) * b.shares * (b.currency === 'USD' ? state.settings.exchangeRate : 1);
                    return vB - vA;
                }).map(s => {
                    const p = s.currentPrice || s.purchasePrice;
                    const v = p * s.shares * (s.currency === 'USD' ? state.settings.exchangeRate : 1);
                    const names = getStockDisplayNames(s);
                    return `
                        <div class="stock-item drill-downable" style="margin: 0" onclick="showDrillDown('${names.primary}')">
                            <div class="stock-main">
                                <span class="stock-t">${names.primary}</span>
                            </div>
                            <div class="stock-info">
                                <div class="stock-v"><span class="privacy-blur">¥${Math.floor(v).toLocaleString()}</span></div>
                                <div class="stock-p">${s.shares}株 (${s.currency})</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Render Chart for Account Detail
        const canvas = document.getElementById('accountDetailChart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: processedList.map(item => item.label),
                    datasets: [{
                        data: processedList.map(item => item.val),
                        backgroundColor: colors.slice(0, processedList.length),
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const label = processedList[index].label;
                            showDrillDown(label);
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        datalabels: { display: false }
                    }
                }
            });
        }

        // Render List for Account Chart
        const listEl = document.getElementById('accountDetailList');
        if (listEl) {
            processedList.forEach((item, i) => {
                const color = colors[i % colors.length];
                const div = document.createElement('div');
                div.className = 'chart-list-item';
                div.onclick = () => showDrillDown(item.label);
                div.innerHTML = `
                    <div class="cli-label">
                        <span class="cli-dot" style="background: ${color}"></span>
                        <span class="cli-name">${item.label}</span>
                    </div>
                    <div class="cli-value">
                        <span class="cli-pct">${item.pct.toFixed(1)}%</span>
                    </div>
                `;
                listEl.appendChild(div);
            });
        }
    } else {
        // "Others" or other cases
        detailBody.innerHTML = `<p style="color: var(--text-sub); text-align: center; padding: 20px;">詳細は個別銘柄または口座を選択してください。</p>`;
    }

    showModal('modal-detail');
}

async function fetchAllData() {
    const btn = document.getElementById('refresh-btn');
    if (btn) btn.classList.add('loading');
    
    try {
        migrateStocks();
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
                const companyName = meta.longName || meta.shortName;
                
                if (price || companyName) {
                    state.stocks.forEach(s => {
                        if (s.ticker === symbol) {
                            if (price) s.currentPrice = price;
                            // Only set name if not already set or if it's currently English
                            if (companyName && (!s.name || s.name === symbol)) s.name = companyName;
                        }
                    });
                }

                // If it's a Japanese stock, try to get the Japanese name via search API
                if (symbol.includes('.T') || /^\d{4}/.test(symbol)) {
                    try {
                        const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&lang=ja-JP&region=JP`;
                        const searchProxy = `https://corsproxy.io/?url=${encodeURIComponent(searchUrl)}`;
                        const sRes = await fetch(searchProxy);
                        const sData = await sRes.json();
                        if (sData && sData.quotes && sData.quotes[0]) {
                            const jpName = sData.quotes[0].longname || sData.quotes[0].shortname;
                            if (jpName) {
                                state.stocks.forEach(s => {
                                    if (s.ticker === symbol) s.name = jpName;
                                });
                            }
                        }
                    } catch (e) {
                        console.warn('JP Name fetch failed', e);
                    }
                }
            }
        } catch (e) {
            console.warn(`Stock fetch failed for ${symbol}`, e);
        }
    }
}

// GLOBAL TOUCH FIX FOR iPhone REVIEWS
function applyTouchFix() {
    const targets = 'button, .chart-tab, .drill-downable, .nav-item, .add-main-btn, .cli-label, .chart-list-item';
    document.querySelectorAll(targets).forEach(el => {
        el.ontouchstart = function(e) {
            this.click();
            e.preventDefault(); 
        };
    });
}

// --- 5. Initial Load ---
window.onload = async () => {
    mergeDuplicateAccounts();
    updateUI();
    // Start automated fetch on load
    await fetchAllData();
    applyTouchFix();
    
    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW register failed', err));
    }
};
