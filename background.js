// 后台脚本 - 定时任务、Cookie缓存管理和IndexedDB日志

// ==================== 配置常量 ====================
const JIT_CONFIG = {
    PAGE_SIZE: 100,
    MAX_RETRY: 3,
    QUERY_URL: "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery",
    OPEN_JIT_URL: "https://agentseller.temu.com/visage-agent-seller/product/skc/batchOpenJit"
};

const CONFIRM_CONFIG = {
    PAGE_SIZE: 50,
    MAX_RETRY: 3,
    SEARCH_URL: "https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier",
    SUBMIT_URL: "https://agentseller.temu.com/bg-brando-mms/goods/batchSupplierConfirm"
};

const REPLENISH_CONFIG = {
    PAGE_SIZE: 100,
    MAX_RETRY: 3,
    QUERY_URL: "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery",
    UPDATE_URL: "https://agentseller.temu.com/darwin-mms/api/kiana/foredawn/sales/stock/updateMmsSkuSalesStock"
};

const LOG_RETENTION_DAYS = 30;
const DB_NAME = 'TemuToolLogs';
const DB_VERSION = 1;
const STORE_NAME = 'logs';

// ==================== IndexedDB 日志管理 ====================
let db = null;
let recentLogsCache = [];

async function openDatabase() {
    if (db) return db;
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { db = request.result; resolve(db); };
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('date', 'date', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

function getTodayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function addLog(message) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    
    // 更新最近日志缓存
    recentLogsCache.push(logMessage);
    if (recentLogsCache.length > 100) recentLogsCache.shift();
    
    // 发送日志到sidepanel（添加catch处理Promise rejection）
    chrome.runtime.sendMessage({ action: 'logUpdate', log: logMessage }).catch(() => {});
    
    try {
        const database = await openDatabase();
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.add({ message: logMessage, date: getTodayDateString(), timestamp: now.getTime() });
    } catch (error) {
        console.error('保存日志失败:', error);
    }
}

async function getRecentLogs() {
    if (recentLogsCache.length > 0) return recentLogsCache;
    try {
        const database = await openDatabase();
        return new Promise((resolve) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('timestamp');
            const request = index.openCursor(null, 'prev');
            const logs = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && logs.length < 100) {
                    logs.unshift(cursor.value.message);
                    cursor.continue();
                } else {
                    recentLogsCache = logs;
                    resolve(logs);
                }
            };
            request.onerror = () => resolve([]);
        });
    } catch (error) {
        console.error('获取日志失败:', error);
        return [];
    }
}

async function exportAllLogs() {
    try {
        const database = await openDatabase();
        return new Promise((resolve) => {
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('timestamp');
            
            // 导出近3天的日志
            const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
            const range = IDBKeyRange.lowerBound(threeDaysAgo);
            const request = index.openCursor(range);
            const logs = [];
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    logs.push(cursor.value.message);
                    cursor.continue();
                } else {
                    resolve(logs.join('\n'));
                }
            };
            request.onerror = () => resolve('');
        });
    } catch (error) {
        return '';
    }
}

async function cleanOldLogs() {
    try {
        const database = await openDatabase();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - LOG_RETENTION_DAYS);
        const cutoffTimestamp = cutoffDate.getTime();
        
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const range = IDBKeyRange.upperBound(cutoffTimestamp);
        const request = index.openCursor(range);
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
    } catch (error) {
        console.error('清理旧日志失败:', error);
    }
}

// ==================== Cookie缓存管理 ====================
async function cacheCookies(mallid, sellerTemp, shopName, expiresAt = null) {
    // 如果提供了过期时间，使用cookie的过期时间；否则默认24小时
    const expireTime = expiresAt || (Date.now() + 24 * 60 * 60 * 1000);
    await chrome.storage.local.set({ cookieCache: { mallid, sellerTemp, shopName, timestamp: Date.now(), expiresAt: expireTime } });
    addLog(`[缓存] 已缓存Cookie: ${shopName}`);
}

async function getCachedCookies() {
    const result = await chrome.storage.local.get(['cookieCache']);
    if (result.cookieCache) {
        // 使用cookie的过期时间进行判断
        const expiresAt = result.cookieCache.expiresAt || (result.cookieCache.timestamp + 24 * 60 * 60 * 1000);
        if (Date.now() < expiresAt) {
            return result.cookieCache;
        }
    }
    return null;
}

// ==================== HTTP请求辅助函数 ====================
function getHeaders(mallid) {
    return {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "mallid": mallid,
        "user-agent": navigator.userAgent
    };
}

// ==================== JIT服务 ====================
async function executeJitTask(mallid, filterType = 'all') {
    addLog('[JIT] 开始执行开通JIT任务...');
    try {
        const firstPageData = { isJitForMms: false, skcSiteStatus: 1, page: 1, pageSize: 1 };
        if (filterType === 'first') firstPageData.isFirstOrder = true;
        
        const firstResponse = await fetch(JIT_CONFIG.QUERY_URL, {
            method: 'POST', headers: getHeaders(mallid), credentials: 'include',
            body: JSON.stringify(firstPageData)
        });
        
        if (firstResponse.status === 403) {
            addLog('[JIT] COOKIE已失效'); return { success: false, error: 'COOKIE已失效' };
        }
        
        const firstResult = await firstResponse.json();
        if (!firstResult.success) { addLog('[JIT] 获取数量失败'); return { success: false, error: '获取数量失败' }; }
        
        const total = firstResult.result?.total || 0;
        addLog(`[JIT] 可开JIT商品数: ${total}`);
        if (total === 0) { addLog('[JIT] 无需开通JIT'); return { success: true, successCount: 0, total: 0 }; }
        
        const maxPage = Math.ceil(total / JIT_CONFIG.PAGE_SIZE);
        let successCount = 0;
        
        for (let page = 1; page <= maxPage; page++) {
            addLog(`[JIT] 处理第 ${page}/${maxPage} 页...`);
            const payload = { isJitForMms: false, skcSiteStatus: 1, page, pageSize: JIT_CONFIG.PAGE_SIZE };
            if (filterType === 'first') payload.isFirstOrder = true;
            
            const response = await fetch(JIT_CONFIG.QUERY_URL, {
                method: 'POST', headers: getHeaders(mallid), credentials: 'include',
                body: JSON.stringify(payload)
            });
            if (!response.ok) continue;
            
            const result = await response.json();
            if (!result.success) continue;
            
            const jitTaskList = (result.result?.pageItems || [])
                .filter(item => item.productSkcId)
                .map(item => ({ productSkcId: item.productSkcId }));
            if (jitTaskList.length === 0) continue;
            
            const openResponse = await fetch(JIT_CONFIG.OPEN_JIT_URL, {
                method: 'POST', headers: getHeaders(mallid), credentials: 'include',
                body: JSON.stringify({ list: jitTaskList })
            });
            if (openResponse.ok) {
                const openResult = await openResponse.json();
                if (openResult.success) {
                    successCount += jitTaskList.length - (openResult.result?.handleProductFailedMsgList?.length || 0);
                }
            }
        }
        addLog(`[JIT] 成功开通 ${successCount}/${total}`);
        return { success: true, successCount, total };
    } catch (error) {
        addLog(`[JIT] 出错: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// ==================== 确认商品服务 ====================
async function executeConfirmTask(mallid, maxConfirmCount = null) {
    addLog('[确认] 开始执行确认商品任务...');
    try {
        const firstResponse = await fetch(CONFIRM_CONFIG.SEARCH_URL, {
            method: 'POST', headers: getHeaders(mallid), credentials: 'include',
            body: JSON.stringify({ pageSize: 1, pageNum: 1, supplierTodoTypeList: [6] })
        });
        
        if (firstResponse.status === 403) { addLog('[确认] COOKIE已失效'); return { success: false, error: 'COOKIE已失效' }; }
        
        const firstResult = await firstResponse.json();
        if (!firstResult.success) { addLog('[确认] 获取数量失败'); return { success: false, error: '获取数量失败' }; }
        
        let total = firstResult.result?.total || 0;
        addLog(`[确认] 待确认商品数: ${total}`);
        if (total === 0) { addLog('[确认] 无需确认'); return { success: true, successCount: 0, total: 0 }; }
        
        if (maxConfirmCount && maxConfirmCount > 0 && total > maxConfirmCount) {
            addLog(`[确认] 限制最大确认数为 ${maxConfirmCount}`);
            total = maxConfirmCount;
        }
        
        const maxPage = Math.ceil(total / CONFIRM_CONFIG.PAGE_SIZE);
        let successCount = 0, processedCount = 0;
        
        for (let page = 1; page <= maxPage; page++) {
            addLog(`[确认] 处理第 ${page}/${maxPage} 页...`);
            const response = await fetch(CONFIRM_CONFIG.SEARCH_URL, {
                method: 'POST', headers: getHeaders(mallid), credentials: 'include',
                body: JSON.stringify({ pageSize: CONFIRM_CONFIG.PAGE_SIZE, pageNum: page, supplierTodoTypeList: [6] })
            });
            if (!response.ok) continue;
            
            const result = await response.json();
            if (!result.success) continue;
            
            let confirmTaskList = (result.result?.dataList || [])
                .filter(item => item.goodsId).map(item => ({ goodsId: item.goodsId }));
            
            if (maxConfirmCount && maxConfirmCount > 0) {
                const remaining = maxConfirmCount - processedCount;
                if (remaining <= 0) { addLog(`[确认] 已达最大确认数`); break; }
                if (confirmTaskList.length > remaining) confirmTaskList = confirmTaskList.slice(0, remaining);
            }
            if (confirmTaskList.length === 0) continue;
            
            const submitResponse = await fetch(CONFIRM_CONFIG.SUBMIT_URL, {
                method: 'POST', headers: getHeaders(mallid), credentials: 'include',
                body: JSON.stringify({ supplierConfirmReqList: confirmTaskList })
            });
            if (submitResponse.ok) {
                const submitResult = await submitResponse.json();
                if (submitResult.success) {
                    successCount += confirmTaskList.length - (submitResult.result?.failedDetails?.length || 0);
                    processedCount += confirmTaskList.length;
                }
            }
        }
        addLog(`[确认] 成功确认 ${successCount}/${total}`);
        return { success: true, successCount, total };
    } catch (error) {
        addLog(`[确认] 出错: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// ==================== 补货服务 ====================
function parseSkuFilter(filterText) {
    if (!filterText || filterText.trim() === '') return null;
    return filterText.split(/[\s\n]+/).filter(p => p.trim() !== '') || null;
}

function matchSkuFilter(outerGoodsId, patterns) {
    if (!patterns || patterns.length === 0) return true;
    if (!outerGoodsId) return false;
    for (const pattern of patterns) {
        if (pattern.includes('*')) {
            if (new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i').test(outerGoodsId)) return true;
        } else if (outerGoodsId.toLowerCase() === pattern.toLowerCase()) return true;
    }
    return false;
}

async function executeReplenishTask(mallid, setStock = 1000, stockLimit = 0.95, skuFilter = '') {
    addLog('[补货] 开始执行补货任务...');
    addLog(`[补货] 库存: ${setStock}, 阈值: ${stockLimit * 100}%`);
    const patterns = parseSkuFilter(skuFilter);
    if (patterns) addLog(`[补货] 过滤: ${patterns.join(', ')}`);
    
    try {
        const firstResponse = await fetch(REPLENISH_CONFIG.QUERY_URL, {
            method: 'POST', headers: getHeaders(mallid), credentials: 'include',
            body: JSON.stringify({
                jitStockQuantitySection: { leftValue: 0, rightValue: Math.floor(stockLimit * setStock) },
                skcSiteStatus: 1, page: 1, pageSize: 1
            })
        });
        if (firstResponse.status === 403) { addLog('[补货] COOKIE已失效'); return { success: false, error: 'COOKIE已失效' }; }
        
        const firstResult = await firstResponse.json();
        if (!firstResult.success) { addLog('[补货] 获取数量失败'); return { success: false, error: '获取数量失败' }; }
        
        const total = firstResult.result?.total || 0;
        addLog(`[补货] 需补货: ${total}`);
        if (total === 0) { addLog('[补货] 无需补货'); return { success: true, successCount: 0, total: 0 }; }
        
        const maxPage = Math.ceil(total / REPLENISH_CONFIG.PAGE_SIZE);
        let successCount = 0, failCount = 0, processedPages = 0;
        
        for (let page = 1; page <= maxPage; page++) {
            processedPages++;
            addLog(`[补货] 处理第 ${processedPages}/${maxPage} 页...`);
            const response = await fetch(REPLENISH_CONFIG.QUERY_URL, {
                method: 'POST', headers: getHeaders(mallid), credentials: 'include',
                body: JSON.stringify({
                    jitStockQuantitySection: { leftValue: 0, rightValue: Math.floor(stockLimit * setStock) },
                    skcSiteStatus: 1, page, pageSize: REPLENISH_CONFIG.PAGE_SIZE
                })
            });
            if (!response.ok) continue;
            
            const result = await response.json();
            if (!result.success) continue;
            
            for (const item of (result.result?.pageItems || [])) {
                if (!item.productId || !item.productSkcId) continue;
                if (patterns && !matchSkuFilter(item.outerGoodsId || '', patterns)) continue;
                
                const skuChanges = (item.productSkuSummaries || [])
                    .filter(sku => sku.productSkuId && (setStock - parseInt(sku.virtualStock || 0)) !== 0)
                    .map(sku => ({ productSkuId: sku.productSkuId, virtualStockDiff: setStock - parseInt(sku.virtualStock || 0) }));
                if (skuChanges.length === 0) continue;
                
                const updateResponse = await fetch(REPLENISH_CONFIG.UPDATE_URL, {
                    method: 'POST', headers: getHeaders(mallid), credentials: 'include',
                    body: JSON.stringify({ productId: item.productId, productSkcId: item.productSkcId, skuVirtualStockChangeList: skuChanges })
                });
                if (updateResponse.ok && (await updateResponse.json()).errorCode === 1000000) successCount++;
                else failCount++;
            }
        }
        addLog(`[补货] 完成: 成功${successCount}, 失败${failCount}`);
        return { success: true, successCount, failCount, total };
    } catch (error) {
        addLog(`[补货] 出错: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// ==================== 定时任务管理 ====================
async function saveScheduledConfig(config) { await chrome.storage.local.set({ scheduledConfig: config }); }
async function getScheduledConfig() { return (await chrome.storage.local.get(['scheduledConfig'])).scheduledConfig || null; }
async function clearScheduledConfig() { await chrome.storage.local.remove(['scheduledConfig']); await chrome.alarms.clearAll(); }

// 发送进度更新到sidepanel（添加catch处理Promise rejection）
function sendProgressUpdate(progress) {
    chrome.runtime.sendMessage({ action: 'progressUpdate', progress }).catch(() => {});
}

async function runScheduledTasks() {
    const config = await getScheduledConfig();
    if (!config || !config.enabled) return;
    const cache = await getCachedCookies();
    if (!cache) { addLog('[定时] 无Cookie缓存'); return; }
    
    // 计算任务数量
    const tasks = [];
    if (config.jitEnabled) tasks.push('jit');
    if (config.confirmEnabled) tasks.push('confirm');
    if (config.replenishEnabled) tasks.push('replenish');
    const taskWeight = tasks.length === 3 ? 33 : (tasks.length === 2 ? 48 : 99);
    let currentProgress = 0;
    
    sendProgressUpdate(1);
    addLog('[定时] ========== 执行定时任务 ==========');
    
    if (config.jitEnabled) {
        await executeJitTask(cache.mallid, config.jitFilterType);
        currentProgress += taskWeight;
        sendProgressUpdate(currentProgress);
    }
    if (config.confirmEnabled) {
        await executeConfirmTask(cache.mallid, config.maxConfirmCount);
        currentProgress += taskWeight;
        sendProgressUpdate(currentProgress);
    }
    if (config.replenishEnabled) {
        await executeReplenishTask(cache.mallid, config.replenishStock || 1000, config.replenishThreshold || 0.95, config.skuFilter || '');
        currentProgress += taskWeight;
        sendProgressUpdate(currentProgress);
    }
    
    sendProgressUpdate(100);
    addLog('[定时] ========== 定时任务完成 ==========');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cleanOldLogs') { 
        cleanOldLogs(); 
        return; 
    }
    
    // All scheduled tasks (jitTask, confirmTask, replenishTask) are handled by their individual alarms
    // Each alarm executes its specific task independently
    const cache = await getCachedCookies();
    const config = await getScheduledConfig();
    if (!cache || !config) return;
    
    if (alarm.name === 'jitTask' && config.jitEnabled) {
        await executeJitTask(cache.mallid, config.jitFilterType);
    } else if (alarm.name === 'confirmTask' && config.confirmEnabled) {
        await executeConfirmTask(cache.mallid, config.maxConfirmCount);
    } else if (alarm.name === 'replenishTask' && config.replenishEnabled) {
        await executeReplenishTask(cache.mallid, config.replenishStock || 1000, config.replenishThreshold || 0.95, config.skuFilter || '');
    }
});

// ==================== 消息处理 ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'cacheCookies') {
        cacheCookies(message.mallid, message.sellerTemp, message.shopName, message.expiresAt).then(() => sendResponse({ success: true }));
        return true;
    }
    if (message.action === 'getCachedCookies') {
        getCachedCookies().then(cache => sendResponse({ cache }));
        return true;
    }
    if (message.action === 'startScheduledTasks') {
        const config = message.config;
        saveScheduledConfig({ ...config, enabled: true }).then(async () => {
            await chrome.alarms.clearAll();
            // 只有间隔>0才创建定时器
            if (config.jitEnabled && config.jitInterval > 0) {
                chrome.alarms.create('jitTask', { periodInMinutes: config.jitInterval });
            }
            if (config.confirmEnabled && config.confirmInterval > 0) {
                chrome.alarms.create('confirmTask', { periodInMinutes: config.confirmInterval });
            }
            if (config.replenishEnabled && config.replenishInterval > 0) {
                chrome.alarms.create('replenishTask', { periodInMinutes: config.replenishInterval });
            }
            // Don't call runScheduledTasks() here - let the alarms handle execution
            // This prevents duplicate execution at startup
            addLog('[定时] 定时任务已启动，等待首次执行');
            sendResponse({ success: true });
        });
        return true;
    }
    if (message.action === 'stopScheduledTasks') {
        clearScheduledConfig().then(() => { addLog('[定时] 已停止'); sendResponse({ success: true }); });
        return true;
    }
    if (message.action === 'getScheduledStatus') {
        getScheduledConfig().then(config => sendResponse({ enabled: config?.enabled || false, config }));
        return true;
    }
    if (message.action === 'getRecentLogs') {
        getRecentLogs().then(logs => sendResponse({ logs }));
        return true;
    }
    if (message.action === 'exportLogs') {
        exportAllLogs().then(logText => sendResponse({ logText }));
        return true;
    }
    if (message.action === 'addLog') {
        addLog(message.message.replace(/^\[.*?\]\s*/, ''));
        sendResponse({ success: true });
        return true;
    }
    if (message.action === 'triggerAdCookieClick') {
        // 处理广告Cookie获取的点击操作
        (async () => {
            try {
                const tabId = message.tabId;
                
                // 第一步：点击"商品推广"按钮
                const step1Result = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => {
                        const adBtn = document.querySelector('a[data-report-click-text="商品推广"]');
                        if (adBtn) {
                            adBtn.click();
                            return true;
                        }
                        return false;
                    }
                });
                
                if (!step1Result || !step1Result[0] || !step1Result[0].result) {
                    sendResponse({ success: false, error: '未找到商品推广按钮' });
                    return;
                }
                
                // 等待1秒
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // 第二步：点击确认按钮
                const step2Result = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => {
                        const confirmBtn = document.querySelector('button[data-tracking-id="qwJ5ySxqCGPc6OsF"]');
                        if (confirmBtn) {
                            confirmBtn.click();
                            return true;
                        }
                        return false;
                    }
                });
                
                if (!step2Result || !step2Result[0] || !step2Result[0].result) {
                    sendResponse({ success: false, error: '未找到确认按钮' });
                    return;
                }
                
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
});

// ==================== 点击扩展图标打开侧边栏 ====================
chrome.action.onClicked.addListener(async (tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

// ==================== 初始化 ====================
chrome.runtime.onInstalled.addListener(() => {
    addLog('[系统] 扩展已安装/更新');
    // 清理超过30天的旧日志
    cleanOldLogs();
});

// 每天清理一次旧日志
chrome.alarms.create('cleanOldLogs', { periodInMinutes: 1440 });

// ==================== 弹窗拦截器注入 ====================
// 拦截器代码（在页面主世界执行）
function popupInterceptorCode() {
    if (window.__TEMU_POPUP_INTERCEPTOR__) return;
    window.__TEMU_POPUP_INTERCEPTOR__ = true;
    
    const originalAppendChild = Element.prototype.appendChild;
    // const allowedClassPatterns = ['5-120-1', '5-118-0'];
    const allowedClassPatterns = ['MDL_mask_5-120-1 undefined', 'MDL_outerWrapper_5-120-1 MDL_alert_5-120-1 MDL_showCloseIcon_5-120-1 undefined', 'MDL_mask_5-120-1 undefined', 'MDL_outerWrapper_5-120-1 MDL_alert_5-120-1 undefined'];
    let interceptCount = 0;

    Element.prototype.appendChild = function(element) {
        if (this === document.body && element && element.tagName === 'DIV') {
            const testId = element.getAttribute('data-testid');
            if (testId === 'beast-core-modal' || testId === 'beast-core-modal-mask') {
                const className = element.className || '';
                let isAllowed = false;
                for (const pattern of allowedClassPatterns) {
                    if (className.includes(pattern)) {
                        isAllowed = true;
                        break;
                    }
                }
                if (!isAllowed) {
                    console.log('[拦截器] 拦截弹窗 ' + testId + ' [' + (++interceptCount) + ']，class: "' + className + '"');
                    const placeholder = document.createElement('div');
                    placeholder.style.cssText = 'display:none!important;height:0!important;width:0!important;';
                    return originalAppendChild.call(this, placeholder);
                }
            }
        }
        return originalAppendChild.call(this, element);
    };
    
    console.log('[拦截器] ✅ 弹窗拦截器已启动，允许编号:', allowedClassPatterns);
}

// 目标域名
const INTERCEPTOR_DOMAINS = ['agentseller.temu.com', 'seller.kuajingmaihuo.com'];

// 注入拦截器到标签页
async function injectPopupInterceptor(tabId, url) {
    if (!url) return;
    try {
        const urlObj = new URL(url);
        if (INTERCEPTOR_DOMAINS.includes(urlObj.hostname)) {
            await chrome.scripting.executeScript({
                target: { tabId: tabId, allFrames: true },
                func: popupInterceptorCode,
                world: 'MAIN',
                injectImmediately: true
            });
        }
    } catch (e) {
        // 忽略无法注入的标签页（如chrome://页面）
    }
}

// 监听标签页更新，在页面加载时注入拦截器
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url) {
        injectPopupInterceptor(tabId, tab.url);
    }
});

// 监听标签页创建
chrome.tabs.onCreated.addListener((tab) => {
    if (tab.url) {
        injectPopupInterceptor(tab.id, tab.url);
    }
});

// 扩展启动时为所有已打开的目标标签页注入拦截器
chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
        if (tab.url) {
            injectPopupInterceptor(tab.id, tab.url);
        }
    }
});
