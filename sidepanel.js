document.addEventListener('DOMContentLoaded', function() {
    const statusDiv = document.getElementById('status');
    const cardHeader = document.getElementById('cardHeader');
    const cardContent = document.getElementById('cardContent');
    const arrow = document.getElementById('arrow');
    const shopNameDisplay = document.getElementById('shopNameDisplay');
    const mallidValue = document.getElementById('mallidValue');
    const sellerTempValue = document.getElementById('sellerTempValue');
    const expiryValue = document.getElementById('expiryValue');
    const copyMallidBtn = document.getElementById('copyMallidBtn');
    const copySellerTempBtn = document.getElementById('copySellerTempBtn');
    const logContent = document.getElementById('logContent');
    const exportLogBtn = document.getElementById('exportLogBtn');
    
    // 功能按钮
    const normalBtn = document.getElementById('normalBtn');
    const complianceBtn = document.getElementById('complianceBtn');
    const pricingBtn = document.getElementById('pricingBtn');
    const campaignBtn = document.getElementById('campaignBtn');
    const advertisingBtn = document.getElementById('advertisingBtn');
    
    // 配置卡片
    const normalConfigCard = document.getElementById('normalConfigCard');
    const complianceConfigCard = document.getElementById('complianceConfigCard');
    const pricingConfigCard = document.getElementById('pricingConfigCard');
    const campaignConfigCard = document.getElementById('campaignConfigCard');
    const advertisingConfigCard = document.getElementById('advertisingConfigCard');
    
    let activeConfigCard = null;
    let currentCookies = [];
    let sellerTempCookie = null;
    let mallidCookie = null;
    let countdownInterval = null;
    let logMessages = [];
    let isTaskRunning = false;
    let scheduledBtnDebounceTimer = null;
    
    // 进度条管理
    let currentProgress = 0;
    let scheduledCountdownInterval = null;
    
    function updateButtonProgress(button, progress) {
        currentProgress = progress;
        button.style.setProperty('--progress', progress + '%');
        if (progress > 0) {
            button.classList.add('has-progress');
            const progressSpan = button.querySelector('.action-btn-progress');
            if (progressSpan) progressSpan.textContent = Math.round(progress) + '%';
        } else {
            button.classList.remove('has-progress');
            const progressSpan = button.querySelector('.action-btn-progress');
            if (progressSpan) progressSpan.textContent = '';
        }
    }
    
    function resetButtonProgress(button) {
        updateButtonProgress(button, 0);
    }
    
    // 格式化时间显示
    function formatTime(date) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    
    function formatCountdown(ms) {
        if (ms <= 0) return '00:00:00';
        const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
        const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
        const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }
    
    // 更新常规按钮信息显示
    function updateNormalBtnInfo() {
        chrome.storage.local.get(['normalTaskLastTime', 'scheduledTaskEnabled', 'scheduledNextTime'], (result) => {
            const lastTime = result.normalTaskLastTime;
            const isScheduled = result.scheduledTaskEnabled;
            const nextTime = result.scheduledNextTime;
            
            // 更新时间显示
            const timeEl = document.getElementById('normalBtnTime');
            if (timeEl) {
                if (lastTime) {
                    timeEl.textContent = `上次${formatTime(new Date(lastTime))}`;
                } else {
                    timeEl.textContent = '';
                }
            }
            
            if (isScheduled && nextTime) {
                startScheduledCountdown(nextTime);
            }
        });
    }
    
    // 启动定时任务倒计时
    function startScheduledCountdown(nextTime) {
        if (scheduledCountdownInterval) clearInterval(scheduledCountdownInterval);
        
        function updateCountdown() {
            const now = Date.now();
            const remaining = nextTime - now;
            if (remaining <= 0) {
                clearInterval(scheduledCountdownInterval);
            }
        }
        updateCountdown();
        scheduledCountdownInterval = setInterval(updateCountdown, 1000);
    }
    
    // 保存任务完成时间
    function saveTaskCompleteTime() {
        chrome.storage.local.set({ normalTaskLastTime: Date.now() });
        updateNormalBtnInfo();
    }
    
    // 页面加载时更新按钮信息
    setTimeout(updateNormalBtnInfo, 100);
    
    // 日志功能
    function addLog(message) {
        const now = new Date();
        const timestamp = now.toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        logMessages.push(logMessage);
        const logLine = document.createElement('div');
        logLine.textContent = logMessage;
        logContent.appendChild(logLine);
        logContent.scrollTop = logContent.scrollHeight;
        // 同时发送到后台保存到IndexedDB
        chrome.runtime.sendMessage({ action: 'addLog', message: logMessage });
    }
    
    // 从后台加载最近日志
    async function loadLogsFromBackground() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getRecentLogs' });
            if (response && response.logs && response.logs.length > 0) {
                response.logs.forEach(log => {
                    logMessages.push(log);
                    const logLine = document.createElement('div');
                    logLine.textContent = log;
                    logContent.appendChild(logLine);
                });
                logContent.scrollTop = logContent.scrollHeight;
            }
        } catch (error) {
            console.error('加载日志失败:', error);
        }
    }
    
    loadLogsFromBackground();
    
    // 监听后台消息（日志和进度）
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'logUpdate' && message.log) {
            // 添加后台日志到界面
            const logLine = document.createElement('div');
            logLine.textContent = message.log;
            logContent.appendChild(logLine);
            logContent.scrollTop = logContent.scrollHeight;
            logMessages.push(message.log);
        }
        if (message.action === 'progressUpdate' && typeof message.progress === 'number') {
            // 更新常规按钮进度条
            const normalBtn = document.getElementById('normalBtn');
            if (normalBtn) {
                updateButtonProgress(normalBtn, message.progress);
            }
        }
        return false;
    });
    
    // 导出日志
    exportLogBtn.addEventListener('click', async function() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'exportLogs' });
            if (response && response.logText) {
                const blob = new Blob([response.logText], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `运行日志_${new Date().toISOString().slice(0,10)}.log`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                addLog('日志已导出');
            } else {
                addLog('没有日志可导出');
            }
        } catch (error) {
            addLog('导出日志失败: ' + error.message);
        }
    });
    
    // 设置服务日志回调
    if (typeof JitService !== 'undefined') JitService.setLogCallback(addLog);
    if (typeof ConfirmService !== 'undefined') ConfirmService.setLogCallback(addLog);
    if (typeof ReplenishService !== 'undefined') ReplenishService.setLogCallback(addLog);
    
    // 缓存Cookie到后台（带过期时间）
    async function cacheCookiesToBackground(mallid, sellerTemp, shopName, expiresAt = null) {
        try {
            await chrome.runtime.sendMessage({ action: 'cacheCookies', mallid, sellerTemp, shopName, expiresAt });
        } catch (error) {
            console.error('缓存Cookie失败:', error);
        }
    }
    
    // 折叠卡片展开/收起功能
    cardHeader.addEventListener('click', function() {
        if (cardContent.style.display === 'none' || cardContent.style.display === '') {
            cardContent.style.display = 'block';
            arrow.textContent = '▲';
        } else {
            cardContent.style.display = 'none';
            arrow.textContent = '▼';
        }
    });
    
    // 从当前活动标签页获取 URL
    async function getCurrentTabUrl() {
        try {
            const tabs = await chrome.tabs.query({active: true, currentWindow: true});
            if (tabs[0] && tabs[0].url) return tabs[0].url;
        } catch (error) {
            console.error('获取当前标签页失败:', error);
        }
        return '';
    }
    
    // 解析 URL 获取域名
    function getDomainFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch (error) {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return getDomainFromUrl('https://' + url);
            }
            return null;
        }
    }
    
    // 获取指定 URL 的 Cookie
    async function getCookiesForUrl(url) {
        try {
            const domain = getDomainFromUrl(url);
            if (!domain || domain !== 'agentseller.temu.com') return [];
            const cookies = await chrome.cookies.getAll({domain: domain});
            return cookies.filter(cookie => cookie.name === 'mallid' || cookie.name === 'seller_temp');
        } catch (error) {
            console.error('获取 Cookie 失败:', error);
            return [];
        }
    }
    
    // 获取广告Cookie（从ads.temu.com域名）
    async function getAdCookies() {
        try {
            const cookies = await chrome.cookies.getAll({domain: 'ads.temu.com'});
            const adCookieObj = {};
            for (const cookie of cookies) {
                adCookieObj[cookie.name] = cookie.value;
            }
            return adCookieObj;
        } catch (error) {
            console.error('获取广告Cookie失败:', error);
            return {};
        }
    }
    
    // 触发广告Cookie获取流程
    async function triggerAdCookieAcquisition() {
        try {
            addLog('[广告] 开始获取广告Cookie...');
            
            const tabs = await chrome.tabs.query({active: true, currentWindow: true});
            if (!tabs[0]) {
                addLog('[广告] 未找到当前标签页');
                return false;
            }
            
            const tabId = tabs[0].id;
            
            // 通过background script执行点击操作
            addLog('[广告] 正在执行点击操作...');
            const clickResult = await chrome.runtime.sendMessage({
                action: 'triggerAdCookieClick',
                tabId: tabId
            });
            
            if (!clickResult || !clickResult.success) {
                addLog(`[广告] 点击操作失败: ${clickResult?.error || '未知错误'}`);
                return false;
            }
            
            addLog('[广告] 点击操作完成，等待页面跳转...');
            
            // 等待5秒让页面跳转和cookie生成
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // 在15秒内循环获取cookie
            addLog('[广告] 开始获取Cookie...');
            const startTime = Date.now();
            const timeout = 15000;
            
            while (Date.now() - startTime < timeout) {
                const adCookies = await getAdCookies();
                if (adCookies.auth_token) {
                    addLog('[广告] 成功获取广告Cookie');
                    // 保存到storage，同时保存获取时间
                    await chrome.storage.local.set({ 
                        adCookies: adCookies,
                        adCookiesTimestamp: Date.now()
                    });
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            addLog('[广告] 获取广告Cookie超时（15秒内未获取到auth_token）');
            return false;
        } catch (error) {
            addLog(`[广告] 获取Cookie失败: ${error.message}`);
            console.error('广告Cookie获取错误详情:', error);
            return false;
        }
    }
    
    // 渲染 Cookie 信息
    function renderCookiesInfo() {
        if (mallidCookie) {
            mallidValue.textContent = mallidCookie.value;
        } else {
            mallidValue.textContent = '未找到';
        }
        
        if (sellerTempCookie) {
            let sellerTempValueText = sellerTempCookie.value;
            if (sellerTempValueText.length > 20) {
                sellerTempValueText = sellerTempValueText.substring(0, 20) + '...';
            }
            sellerTempValue.textContent = sellerTempValueText;
            
            if (sellerTempCookie.expirationDate) {
                const expiryDate = new Date(sellerTempCookie.expirationDate * 1000);
                expiryValue.textContent = expiryDate.toLocaleString();
            } else {
                expiryValue.textContent = '会话 Cookie';
            }
        } else {
            sellerTempValue.textContent = '未找到';
            expiryValue.textContent = '未找到';
        }
    }
    
    // 从缓存获取店铺名称
    function getCachedShopName() {
        try {
            const cached = localStorage.getItem('shopNameCache');
            if (cached) {
                const cacheData = JSON.parse(cached);
                if (Date.now() - cacheData.timestamp < 5 * 60 * 1000) {
                    return cacheData.shopName;
                }
            }
        } catch (error) {
            console.error('读取缓存失败:', error);
        }
        return null;
    }
    
    // 缓存店铺名称
    function cacheShopName(shopName) {
        try {
            localStorage.setItem('shopNameCache', JSON.stringify({ shopName, timestamp: Date.now() }));
        } catch (error) {
            console.error('缓存店铺名称失败:', error);
        }
    }
    
    // 异步获取店铺名称
    async function getShopName() {
        const cachedName = getCachedShopName();
        if (cachedName) {
            shopNameDisplay.textContent = cachedName;
            startCountdown();
            return;
        }
        
        try {
            if (!sellerTempCookie) {
                shopNameDisplay.textContent = '未找到 seller_temp cookie';
                return;
            }
            
            const headers = {
                "accept": "*/*",
                "content-type": "application/json",
                "user-agent": navigator.userAgent
            };
            headers["cookie"] = `seller_temp=${sellerTempCookie.value}`;
            
            const response = await fetch("https://agentseller.temu.com/api/seller/auth/userInfo", {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({})
            });
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const result = await response.json();
            const mallName = result.result?.mallList?.[0]?.mallName || '未找到店铺名称';
            shopNameDisplay.textContent = mallName;
            cacheShopName(mallName);
            
            if (mallidCookie && sellerTempCookie) {
                // 获取cookie过期时间
                const expiresAt = sellerTempCookie.expirationDate ? sellerTempCookie.expirationDate * 1000 : null;
                cacheCookiesToBackground(mallidCookie.value, sellerTempCookie.value, mallName, expiresAt);
            }
            startCountdown();
        } catch (error) {
            console.error('获取店铺名称失败:', error);
            shopNameDisplay.textContent = '获取店铺名称失败';
        }
    }
    
    // 启动倒计时
    function startCountdown() {
        if (countdownInterval) clearInterval(countdownInterval);
        
        if (sellerTempCookie && sellerTempCookie.expirationDate) {
            let countdownElement = document.getElementById('countdown');
            if (!countdownElement) {
                countdownElement = document.createElement('span');
                countdownElement.id = 'countdown';
                countdownElement.style.fontSize = '10px';
                countdownElement.style.color = '#999';
                countdownElement.style.marginLeft = '10px';
                shopNameDisplay.parentNode.appendChild(countdownElement);
            }
            
            function updateCountdown() {
                const timeLeft = sellerTempCookie.expirationDate * 1000 - Date.now();
                if (timeLeft <= 0) {
                    countdownElement.textContent = '(已过期)';
                    clearInterval(countdownInterval);
                    return;
                }
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
                countdownElement.textContent = `(${hours}h ${minutes}m ${seconds}s)`;
            }
            
            updateCountdown();
            countdownInterval = setInterval(updateCountdown, 1000);
        }
    }
    
    // 复制功能
    copyMallidBtn.addEventListener('click', function() {
        if (mallidCookie && mallidCookie.value) {
            navigator.clipboard.writeText(mallidCookie.value).then(() => console.log('已复制 mallid'));
        }
    });
    
    copySellerTempBtn.addEventListener('click', function() {
        if (sellerTempCookie && sellerTempCookie.value) {
            navigator.clipboard.writeText(sellerTempCookie.value).then(() => console.log('已复制 seller_temp'));
        }
    });
    
    // 显示配置卡片
    function showConfigCard(cardElement) {
        if (activeConfigCard && activeConfigCard !== cardElement) {
            activeConfigCard.style.display = 'none';
        }
        if (cardElement.style.display === 'block') {
            cardElement.style.display = 'none';
            activeConfigCard = null;
        } else {
            cardElement.style.display = 'block';
            activeConfigCard = cardElement;
        }
    }
    
    // 功能按钮点击事件
    normalBtn.addEventListener('click', function() {
        if (normalConfigCard.innerHTML.trim() === '<!-- 常规配置卡片内容将通过JavaScript动态填充 -->') {
            generateNormalConfigCard();
        }
        showConfigCard(normalConfigCard);
    });
    
    complianceBtn.addEventListener('click', function() {
        if (complianceConfigCard.innerHTML.trim() === '<!-- 合规配置卡片内容将通过JavaScript动态填充 -->') {
            generateComplianceConfigCard();
        }
        showConfigCard(complianceConfigCard);
    });
    
    pricingBtn.addEventListener('click', function() {
        if (pricingConfigCard.innerHTML.trim() === '<!-- 核价配置卡片内容将通过JavaScript动态填充 -->') {
            generatePricingConfigCard();
        }
        showConfigCard(pricingConfigCard);
    });
    
    campaignBtn.addEventListener('click', function() {
        if (campaignConfigCard.innerHTML.trim() === '<!-- 活动配置卡片内容将通过JavaScript动态填充 -->') {
            generateCampaignConfigCard();
        }
        showConfigCard(campaignConfigCard);
    });
    
    advertisingBtn.addEventListener('click', async function() {
        if (advertisingConfigCard.innerHTML.trim() === '<!-- 广告配置卡片内容将通过JavaScript动态填充 -->') {
            generateAdvertisingConfigCard();
        }
        
        // 检查广告Cookie是否存在或过期
        const stored = await chrome.storage.local.get(['adCookies', 'adCookiesTimestamp']);
        const adCookies = stored.adCookies || {};
        const timestamp = stored.adCookiesTimestamp || 0;
        const hasAuthToken = !!adCookies.auth_token;
        
        // Cookie过期时间设为24小时
        const cookieExpired = (Date.now() - timestamp) > (24 * 60 * 60 * 1000);
        
        if (!hasAuthToken || cookieExpired) {
            if (cookieExpired && hasAuthToken) {
                addLog('[广告] 广告Cookie已过期，正在重新获取...');
            }
            // 自动触发获取流程
            const success = await triggerAdCookieAcquisition();
            if (success) {
                // 刷新UI状态
                const updateStatus = document.getElementById('adCookieStatusValue');
                if (updateStatus) {
                    updateStatus.textContent = '已获取';
                    updateStatus.style.color = '#4CAF50';
                }
                // 启用所有控件
                const roasInput = document.getElementById('adRoasInput');
                const intervalSelect = document.getElementById('adIntervalSelect');
                const nowBtn = document.getElementById('adNowBtn');
                const scheduleBtn = document.getElementById('adScheduleBtn');
                if (roasInput) roasInput.disabled = false;
                if (intervalSelect) intervalSelect.disabled = false;
                if (nowBtn) nowBtn.disabled = false;
                if (scheduleBtn) scheduleBtn.disabled = false;
            }
        }
        
        showConfigCard(advertisingConfigCard);
    });
    
    // 生成常规配置卡片内容
    function generateNormalConfigCard() {
        normalConfigCard.innerHTML = `
            <div class="tabs">
                <div class="tab active" id="singleConfigTab">单次配置</div>
                <div class="tab" id="scheduledConfigTab">定时配置</div>
                <span class="advanced-link is-advanced" id="advancedSettingsLink" style="display: none;">⇆高级</span>
            </div>
            
            <div class="tab-content active" id="singleConfigContent">
                <div class="config-item">
                    <span class="config-item-label">JIT</span>
                    <div class="config-item-controls">
                        <div class="config-group">
                            <span class="control-label">过滤:</span>
                            <select class="select-box" id="jitFilterSelect">
                                <option value="all">全部商品</option>
                                <option value="first" disabled>仅首单商品</option>
                            </select>
                        </div>
                        <div class="switch-container">
                            <label class="switch">
                                <input type="checkbox" id="jitSwitch">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="config-item">
                    <span class="config-item-label">确认</span>
                    <div class="config-item-controls">
                        <div class="switch-container">
                            <label class="switch">
                                <input type="checkbox" id="confirmSwitch">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="config-item">
                    <span class="config-item-label">补货</span>
                    <div class="config-item-controls">
                        <div class="config-group">
                            <span class="control-label">库存:</span>
                            <input type="number" class="input-box" id="replenishStockInput" value="1000">
                        </div>
                        <div class="switch-container">
                            <label class="switch">
                                <input type="checkbox" id="replenishSwitch">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <button class="run-btn btn-run-now" id="runNowBtn" disabled>立即运行</button>
            </div>
            
            <div class="tab-content" id="scheduledConfigContent">
                <div class="config-item">
                    <span class="config-item-label">JIT</span>
                    <div class="config-item-controls">
                        <div class="config-group">
                            <span class="control-label">过滤:</span>
                            <select class="select-box" id="scheduledJitFilterSelect">
                                <option value="all">全部商品</option>
                                <option value="first" disabled>仅首单商品</option>
                            </select>
                        </div>
                        <div class="config-group">
                            <span class="control-label">定时:</span>
                            <select class="select-box" id="jitIntervalSelect">
                                <option value="0" selected>关闭</option>
                                <option value="1">1分钟</option>
                                <option value="30">30分钟</option>
                                <option value="60">1小时</option>
                                <option value="120">2小时</option>
                                <option value="180">3小时</option>
                                <option value="240">4小时</option>
                                <option value="720">12小时</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="config-item config-item-vertical" id="confirmConfigItem">
                    <div class="config-item-header">
                        <span class="config-item-label">确认</span>
                        <div class="config-item-controls">
                            <div class="config-group advanced-field" style="display: none;">
                                <span class="control-label">限制:</span>
                                <label class="switch">
                                    <input type="checkbox" id="confirmLimitSwitch">
                                    <span class="slider"></span>
                                </label>
                                <span class="control-label">  *限制每日确认数量</span>
                            </div>
                        </div>
                    </div>
                    <div class="config-item-extra advanced-field confirm-limit-field" style="display: none;">
                        <div class="config-group">
                            <span class="control-label">最多:</span>
                            <input type="number" class="input-box" id="maxConfirmInput" value="100">
                        </div>
                    </div>
                    <div class="config-item-extra">
                        <div class="config-group">
                            <span class="control-label">定时:</span>
                            <select class="select-box" id="confirmIntervalSelect">
                                <option value="0" selected>关闭</option>
                                <option value="1">1分钟</option>
                                <option value="30">30分钟</option>
                                <option value="60">1小时</option>
                                <option value="120">2小时</option>
                                <option value="180">3小时</option>
                                <option value="240">4小时</option>
                                <option value="720">12小时</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="config-item" id="replenishConfigItem">
                    <span class="config-item-label">补货</span>
                    <div class="config-item-controls">
                        <div class="config-group">
                            <span class="control-label">库存:</span>
                            <input type="number" class="input-box" id="scheduledReplenishStockInput" value="1000">
                        </div>
                        <div class="config-group advanced-field" style="display: none;">
                            <span class="control-label">阈值:</span>
                            <input type="number" class="input-box" id="replenishThresholdInput" value="0.95" step="0.01">
                        </div>
                        <div class="config-group">
                            <span class="control-label">定时:</span>
                            <select class="select-box" id="replenishIntervalSelect">
                                <option value="0" selected>关闭</option>
                                <option value="1">1分钟</option>
                                <option value="30">30分钟</option>
                                <option value="60">1小时</option>
                                <option value="120">2小时</option>
                                <option value="180">3小时</option>
                                <option value="240">4小时</option>
                                <option value="720">12小时</option>
                            </select>
                        </div>
                    </div>
                    <div class="sku-filter-container advanced-field" style="display: none;">
                        <div class="sku-filter-row">
                            <textarea class="sku-filter-textarea" id="skuFilterInput" placeholder=" 货号过滤&#10; 使用 51*、*abc、12*34 等规则进行过滤 &#10; 多个规则用空格或者回车分隔 &#10; 被过滤的规则不会被添加库存" rows="2"></textarea>
                            <div class="sku-filter-hint" id="skuFilterHint"></div>
                        </div>
                    
                    </div>
                </div>
                
                <button class="run-btn btn-start-scheduled" id="startScheduledBtn" disabled>启动定时</button>
            </div>
        `;
        setupNormalConfigCardEvents();
    }
    
    function setupNormalConfigCardEvents() {
        const singleConfigTab = document.getElementById('singleConfigTab');
        const scheduledConfigTab = document.getElementById('scheduledConfigTab');
        const singleConfigContent = document.getElementById('singleConfigContent');
        const scheduledConfigContent = document.getElementById('scheduledConfigContent');
        const advancedSettingsLink = document.getElementById('advancedSettingsLink');
        const advancedFields = document.querySelectorAll('.advanced-field');
        const jitSwitch = document.getElementById('jitSwitch');
        const confirmSwitch = document.getElementById('confirmSwitch');
        const replenishSwitch = document.getElementById('replenishSwitch');
        const runNowBtn = document.getElementById('runNowBtn');
        const startScheduledBtn = document.getElementById('startScheduledBtn');
        const jitIntervalSelect = document.getElementById('jitIntervalSelect');
        const confirmIntervalSelect = document.getElementById('confirmIntervalSelect');
        const replenishIntervalSelect = document.getElementById('replenishIntervalSelect');
        const confirmLimitSwitch = document.getElementById('confirmLimitSwitch');
        const confirmLimitFields = document.querySelectorAll('.confirm-limit-field');
        let isAdvancedMode = false;
        
        // 更新立即运行按钮状态 - 至少一个开关开启才可点击
        function updateRunNowBtnState() {
            const anyEnabled = jitSwitch.checked || confirmSwitch.checked || replenishSwitch.checked;
            runNowBtn.disabled = !anyEnabled || isTaskRunning;
        }
        
        // 更新启动定时按钮状态 - 至少一个间隔不为关闭才可点击，且货号规则有效
        function updateStartScheduledBtnState() {
            const jitEnabled = parseInt(jitIntervalSelect.value) > 0;
            const confirmEnabled = parseInt(confirmIntervalSelect.value) > 0;
            const replenishEnabled = parseInt(replenishIntervalSelect.value) > 0;
            const anyEnabled = jitEnabled || confirmEnabled || replenishEnabled;
            // 如果按钮是"停止定时"状态，保持可点击
            if (startScheduledBtn.textContent === '停止定时') {
                startScheduledBtn.disabled = false;
                startScheduledBtn.title = '';
            } else if (!skuFilterValid) {
                startScheduledBtn.disabled = true;
                startScheduledBtn.title = '输入的货号不符合规则';
            } else {
                startScheduledBtn.disabled = !anyEnabled;
                startScheduledBtn.title = '';
            }
        }
        
        // 确认数限制开关事件
        if (confirmLimitSwitch) {
            confirmLimitSwitch.addEventListener('change', function() {
                confirmLimitFields.forEach(f => {
                    f.style.display = confirmLimitSwitch.checked ? 'inline-flex' : 'none';
                });
            });
        }
        
        // 货号过滤校验相关
        const skuFilterInput = document.getElementById('skuFilterInput');
        const skuFilterHint = document.getElementById('skuFilterHint');
        let validSkuPatterns = []; // 存储有效的货号规则
        let skuFilterValid = true; // 货号是否有效
        
        // 校验单个货号规则
        function validateSkuPattern(pattern) {
            if (!pattern || pattern.trim() === '') return false;
            const trimmed = pattern.trim();
            // 只能有一个*号
            const starCount = (trimmed.match(/\*/g) || []).length;
            if (starCount > 1) return false;
            // 移除*后的长度至少3个字符
            const withoutStar = trimmed.replace(/\*/g, '');
            if (withoutStar.length < 3) return false;
            return true;
        }
        
        // 校验所有货号并更新UI
        function validateSkuFilter() {
            const text = skuFilterInput.value.trim();
            skuFilterInput.classList.remove('valid', 'partial', 'invalid');
            skuFilterHint.classList.remove('valid', 'partial', 'invalid');
            
            if (!text) {
                skuFilterHint.textContent = '';
                validSkuPatterns = [];
                skuFilterValid = true;
                updateStartScheduledBtnState();
                return;
            }
            
            // 按空格和换行分割
            const patterns = text.split(/[\s\n]+/).filter(p => p.trim() !== '');
            const validPatterns = [];
            const invalidPatterns = [];
            
            for (const p of patterns) {
                if (validateSkuPattern(p)) {
                    validPatterns.push(p.trim());
                } else {
                    invalidPatterns.push(p.trim());
                }
            }
            
            validSkuPatterns = validPatterns;
            
            if (invalidPatterns.length === 0 && validPatterns.length > 0) {
                // 全部正确
                skuFilterInput.classList.add('valid');
                skuFilterHint.classList.add('valid');
                skuFilterHint.textContent = `共 ${validPatterns.length} 个规则`;
                skuFilterValid = true;
            } else if (validPatterns.length > 0 && invalidPatterns.length > 0) {
                // 部分正确
                skuFilterInput.classList.add('partial');
                skuFilterHint.classList.add('partial');
                skuFilterHint.textContent = `${validPatterns.length} 个规则可用，${invalidPatterns.length} 个错误`;
                skuFilterValid = true; // 允许启动，只用有效规则
            } else {
                // 全部错误
                skuFilterInput.classList.add('invalid');
                skuFilterHint.classList.add('invalid');
                skuFilterHint.textContent = `${invalidPatterns.length} 个规则输入错误`;
                skuFilterValid = false;
            }
            
            updateStartScheduledBtnState();
        }
        
        // 限制输入字符：数字、字母、*、空格、回车
        if (skuFilterInput) {
            skuFilterInput.addEventListener('input', function(e) {
                const allowedPattern = /^[a-zA-Z0-9*\s\n]*$/;
                if (!allowedPattern.test(this.value)) {
                    this.value = this.value.replace(/[^a-zA-Z0-9*\s\n]/g, '');
                }
            });
            
            skuFilterInput.addEventListener('blur', validateSkuFilter);
            skuFilterInput.addEventListener('keydown', function(e) {
                // 允许的按键
                const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' '];
                if (allowedKeys.includes(e.key)) return;
                // 允许的字符
                if (/^[a-zA-Z0-9*]$/.test(e.key)) return;
                // 允许Ctrl组合键
                if (e.ctrlKey || e.metaKey) return;
                e.preventDefault();
            });
        }
        
        jitSwitch.addEventListener('change', updateRunNowBtnState);
        confirmSwitch.addEventListener('change', updateRunNowBtnState);
        replenishSwitch.addEventListener('change', updateRunNowBtnState);
        jitIntervalSelect.addEventListener('change', updateStartScheduledBtnState);
        confirmIntervalSelect.addEventListener('change', updateStartScheduledBtnState);
        replenishIntervalSelect.addEventListener('change', updateStartScheduledBtnState);
        
        updateRunNowBtnState();
        updateStartScheduledBtnState();
        
        singleConfigTab.addEventListener('click', function() {
            singleConfigTab.classList.add('active');
            scheduledConfigTab.classList.remove('active');
            singleConfigContent.classList.add('active');
            scheduledConfigContent.classList.remove('active');
            advancedSettingsLink.style.display = 'none';
        });
        
        scheduledConfigTab.addEventListener('click', function() {
            scheduledConfigTab.classList.add('active');
            singleConfigTab.classList.remove('active');
            scheduledConfigContent.classList.add('active');
            singleConfigContent.classList.remove('active');
            advancedSettingsLink.style.display = 'inline';
        });
        
        // 初始化advanced-link颜色
        advancedSettingsLink.classList.add('is-advanced');
        
        advancedSettingsLink.addEventListener('click', function() {
            isAdvancedMode = !isAdvancedMode;
            advancedFields.forEach(f => f.style.display = isAdvancedMode ? 'inline-flex' : 'none');
            advancedSettingsLink.textContent = isAdvancedMode ? '⇆普通' : '⇆高级';
            advancedSettingsLink.classList.toggle('is-advanced', !isAdvancedMode);
            advancedSettingsLink.classList.toggle('is-normal', isAdvancedMode);
            // 高级模式下，如果确认数限制开关关闭，隐藏相关字段
            if (isAdvancedMode && confirmLimitSwitch && !confirmLimitSwitch.checked) {
                confirmLimitFields.forEach(f => f.style.display = 'none');
            }
        });
        
        // 立即运行按钮点击事件
        runNowBtn.addEventListener('click', async function() {
            if (!mallidCookie || !sellerTempCookie) {
                addLog('错误: 未找到Cookie');
                return;
            }
            if (isTaskRunning) return;
            if (runNowBtn.disabled) return;
            
            isTaskRunning = true;
            runNowBtn.disabled = true;
            runNowBtn.textContent = '运行中...';
            
            // 收起配置卡片
            normalConfigCard.style.display = 'none';
            activeConfigCard = null;
            
            // 计算任务数量和占比
            const tasks = [];
            if (jitSwitch.checked) tasks.push('jit');
            if (confirmSwitch.checked) tasks.push('confirm');
            if (replenishSwitch.checked) tasks.push('replenish');
            const totalTasks = tasks.length;
            const taskWeight = totalTasks === 3 ? 33 : (totalTasks === 2 ? 48 : 99);
            
            // 使用对象跟踪每个任务的进度
            const taskProgress = { jit: 0, confirm: 0, replenish: 0 };
            
            function updateTotalProgress() {
                const total = taskProgress.jit + taskProgress.confirm + taskProgress.replenish;
                updateButtonProgress(normalBtn, Math.min(total, 99));
            }
            
            updateButtonProgress(normalBtn, 1);
            
            const mallid = mallidCookie.value;
            
            // 顺序执行任务以确保进度条正确显示
            if (jitSwitch.checked) {
                try {
                    addLog('=== 开始执行JIT任务 ===');
                    await JitService.executeOpenJit(mallid, '', document.getElementById('jitFilterSelect').value);
                    taskProgress.jit = taskWeight;
                    updateTotalProgress();
                    addLog('=== JIT任务完成 ===');
                } catch (e) {
                    addLog('JIT任务出错: ' + e.message);
                    taskProgress.jit = taskWeight;
                    updateTotalProgress();
                }
            }
            
            if (confirmSwitch.checked) {
                try {
                    addLog('=== 开始执行确认任务 ===');
                    await ConfirmService.executeConfirm(mallid, '');
                    taskProgress.confirm = taskWeight;
                    updateTotalProgress();
                    addLog('=== 确认任务完成 ===');
                } catch (e) {
                    addLog('确认任务出错: ' + e.message);
                    taskProgress.confirm = taskWeight;
                    updateTotalProgress();
                }
            }
            
            if (replenishSwitch.checked) {
                try {
                    addLog('=== 开始执行补货任务 ===');
                    const stock = parseInt(document.getElementById('replenishStockInput').value) || 1000;
                    await ReplenishService.executeReplenish(mallid, '', stock, 0.95, '');
                    taskProgress.replenish = taskWeight;
                    updateTotalProgress();
                    addLog('=== 补货任务完成 ===');
                } catch (e) {
                    addLog('补货任务出错: ' + e.message);
                    taskProgress.replenish = taskWeight;
                    updateTotalProgress();
                }
            }
            
            // 完成后显示100%
            updateButtonProgress(normalBtn, 100);
            addLog('=== 所有任务执行完成 ===');
            
            // 保存完成时间
            saveTaskCompleteTime();
            
            isTaskRunning = false;
            runNowBtn.textContent = '立即运行';
            updateRunNowBtnState();
        });
        
        // 启动定时按钮点击事件 - 带防抖
        startScheduledBtn.addEventListener('click', async function() {
            if (!mallidCookie || !sellerTempCookie) {
                addLog('错误: 未找到Cookie');
                return;
            }
            if (startScheduledBtn.disabled) return;
            
            // 防抖处理
            if (scheduledBtnDebounceTimer) {
                return;
            }
            scheduledBtnDebounceTimer = setTimeout(() => {
                scheduledBtnDebounceTimer = null;
            }, 1000);
            
            if (startScheduledBtn.textContent === '停止定时') {
                await chrome.runtime.sendMessage({ action: 'stopScheduledTasks' });
                startScheduledBtn.textContent = '启动定时';
                updateStartScheduledBtnState();
                // 清除定时任务状态
                chrome.storage.local.set({ scheduledTaskEnabled: false, scheduledNextTime: null });
                if (scheduledCountdownInterval) clearInterval(scheduledCountdownInterval);
                updateNormalBtnInfo();
                addLog('定时任务已停止');
                return;
            }
            
            // 收起配置卡片
            normalConfigCard.style.display = 'none';
            activeConfigCard = null;
            
            const jitInterval = parseInt(jitIntervalSelect.value);
            const confirmInterval = parseInt(confirmIntervalSelect.value);
            const replenishInterval = parseInt(replenishIntervalSelect.value);
            
            // 计算最小间隔作为下次执行时间
            const intervals = [jitInterval, confirmInterval, replenishInterval].filter(i => i > 0);
            const minInterval = Math.min(...intervals);
            const nextTime = Date.now() + minInterval * 60 * 1000;
            
            // 获取cookie过期时间
            const expiresAt = sellerTempCookie.expirationDate ? sellerTempCookie.expirationDate * 1000 : null;
            await cacheCookiesToBackground(mallidCookie.value, sellerTempCookie.value, getCachedShopName() || '未知', expiresAt);
            
            await chrome.runtime.sendMessage({
                action: 'startScheduledTasks',
                config: {
                    jitEnabled: jitInterval > 0,
                    confirmEnabled: confirmInterval > 0,
                    replenishEnabled: replenishInterval > 0,
                    jitFilterType: document.getElementById('scheduledJitFilterSelect').value,
                    jitInterval: jitInterval,
                    confirmInterval: confirmInterval,
                    replenishInterval: replenishInterval,
                    replenishStock: parseInt(document.getElementById('scheduledReplenishStockInput').value) || 1000,
                    replenishThreshold: isAdvancedMode ? parseFloat(document.getElementById('replenishThresholdInput').value) : 0.95,
                    skuFilter: isAdvancedMode ? validSkuPatterns.join(' ') : '',
                    maxConfirmCount: (isAdvancedMode && confirmLimitSwitch && confirmLimitSwitch.checked) ? parseInt(document.getElementById('maxConfirmInput').value) : null,
                    confirmLimitEnabled: isAdvancedMode && confirmLimitSwitch && confirmLimitSwitch.checked
                }
            });
            
            // 保存定时任务状态
            chrome.storage.local.set({ scheduledTaskEnabled: true, scheduledNextTime: nextTime });
            updateNormalBtnInfo();
            
            startScheduledBtn.textContent = '停止定时';
            addLog('后台定时任务已启动');
            if (jitInterval > 0) addLog(`JIT: 每${jitInterval}分钟执行`);
            if (confirmInterval > 0) addLog(`确认: 每${confirmInterval}分钟执行`);
            if (replenishInterval > 0) addLog(`补货: 每${replenishInterval}分钟执行`);
        });
        
        // 检查后台定时任务状态
        chrome.runtime.sendMessage({ action: 'getScheduledStatus' }).then(r => {
            if (r && r.enabled) {
                startScheduledBtn.textContent = '停止定时';
                startScheduledBtn.disabled = false;
            }
        }).catch(() => {});
    }
    
    function generateComplianceConfigCard() {
        complianceConfigCard.innerHTML = `
            <div class="compliance-search-container">
                <div class="compliance-search-row">
                    <input type="text" class="compliance-search-input" id="complianceSearchInput" placeholder="输入SPU 制作合规模板">
                    <button class="compliance-search-btn" id="complianceSearchBtn">搜索</button>
                </div>
            </div>
            <div class="compliance-result-container" id="complianceResultContainer" style="display: none;">
                <div class="compliance-cat-info">
                    <div class="compliance-cat-info-top">
                        <span class="compliance-leaf-cat" id="complianceLeafCat"></span>
                        <span class="compliance-product-ids" id="complianceProductIds"></span>
                    </div>
                    <div class="compliance-tasks-list" id="complianceTasksList"></div>
                </div>
                <div class="compliance-actions">
                    <button class="compliance-cancel-btn" id="complianceCancelBtn">取消</button>
                    <button class="compliance-save-btn" id="complianceSaveBtn">保存模板</button>
                </div>
            </div>
            <div class="compliance-loading" id="complianceLoading" style="display: none;">加载中...</div>
            <div class="compliance-error" id="complianceError" style="display: none;"></div>
            <div class="compliance-templates-section" id="complianceTemplatesSection">
                <div class="compliance-templates-title">---------------已保存的合规模板---------------</div>
                <div class="compliance-templates-list" id="complianceTemplatesList"></div>
            </div>
            <div class="auto-compliance-section" id="autoComplianceSection">
                <div class="auto-compliance-title">---------------自动合规配置---------------</div>
                <div class="auto-compliance-config">
                    <div class="auto-compliance-row">
                        <label class="auto-compliance-label">定时合规:</label>
                        <select class="auto-compliance-select" id="autoComplianceInterval">
                            <option value="0">未开启</option>
                            <option value="60000">1分钟(调试)</option>
                            <option value="1800000">30分钟</option>
                            <option value="3600000">1小时</option>
                            <option value="7200000">2小时</option>
                            <option value="10800000">3小时</option>
                        </select>
                    </div>
                    <div class="auto-compliance-buttons">
                        <button class="auto-compliance-btn" id="autoComplianceNowBtn">
                            <span class="auto-compliance-btn-text">立即合规</span>
                            <div class="auto-compliance-btn-progress" style="width: 0%;"></div>
                        </button>
                        <button class="auto-compliance-btn" id="autoComplianceScheduleBtn">
                            <span class="auto-compliance-btn-text">启动定时</span>
                            <div class="auto-compliance-btn-progress" style="width: 0%;"></div>
                        </button>
                    </div>
                    <div class="auto-compliance-info" id="autoComplianceInfo"></div>
                </div>
            </div>
        `;
        autoComplianceEventsInitialized = false;
        setupComplianceConfigCardEvents();
        loadSavedComplianceTemplates();
        setupAutoComplianceEvents();
    }
    
    function generatePricingConfigCard() {
        pricingConfigCard.innerHTML = `
            <div class="pricing-search-container">
                <div class="pricing-search-row">
                    <input type="text" class="pricing-search-input" id="pricingSearchInput" 
                           placeholder="输入商品SPU（多个SPU以空格分隔）">
                    <button class="pricing-search-btn" id="pricingSearchBtn">搜索</button>
                </div>
            </div>
            <div class="pricing-result-container" id="pricingResultContainer" style="display: none;">
                <div class="pricing-result-header">
                    <div class="pricing-cat-info">
                        <div class="pricing-cat-info-row">
                            <span class="pricing-leaf-cat" id="pricingLeafCat"></span>
                            <span class="pricing-product-ids" id="pricingProductIds"></span>
                        </div>
                        <span class="pricing-categories" id="pricingCategories"></span>
                    </div>
                    <div class="pricing-actions">
                        <button class="pricing-cancel-btn" id="pricingCancelBtn">取消</button>
                        <button class="pricing-save-btn" id="pricingSaveBtn">保存</button>
                    </div>
                </div>
                <div class="pricing-table-container">
                    <table class="pricing-table" id="pricingTable">
                        <thead>
                            <tr>
                                <th>规格</th>
                                <th>次数</th>
                                <th>策略(元)</th>
                                <th>接受价(元)</th>
                                <th>最低价(元)</th>
                            </tr>
                        </thead>
                        <tbody id="pricingTableBody">
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="pricing-loading" id="pricingLoading" style="display: none;">加载中...</div>
            <div class="pricing-error" id="pricingError" style="display: none;"></div>
            <div class="pricing-templates-section" id="pricingTemplatesSection">
                <div class="pricing-templates-title">---------------已保存的核价模板---------------</div>
                <div class="pricing-templates-list" id="pricingTemplatesList"></div>
            </div>
            <div class="auto-pricing-section" id="autoPricingSection">
                <div class="auto-pricing-title">---------------自动核价配置---------------</div>
                <div class="auto-pricing-config">
                    <div class="auto-pricing-row">
                        <label class="auto-pricing-label">定时核价:</label>
                        <select class="auto-pricing-select" id="autoPricingInterval">
                            <option value="0">未开启</option>
                            <option value="60000">1分钟(调试)</option>
                            <option value="1800000">30分钟</option>
                            <option value="3600000">1小时</option>
                            <option value="7200000">2小时</option>
                            <option value="10800000">3小时</option>
                        </select>
                    </div>
                    <div class="auto-pricing-buttons">
                        <button class="auto-pricing-btn" id="autoPricingNowBtn">
                            <span class="auto-pricing-btn-text">立即核价</span>
                            <div class="auto-pricing-btn-progress" style="width: 0%;"></div>
                        </button>
                        <button class="auto-pricing-btn" id="autoPricingScheduleBtn">
                            <span class="auto-pricing-btn-text">启动定时</span>
                            <div class="auto-pricing-btn-progress" style="width: 0%;"></div>
                        </button>
                    </div>
                    <div class="auto-pricing-info" id="autoPricingInfo"></div>
                </div>
            </div>
        `;
        autoPricingEventsInitialized = false;
        setupPricingConfigCardEvents();
        loadSavedPricingTemplates();
        setupAutoPricingEvents();
    }
    
    // 核价配置卡片事件设置
    function setupPricingConfigCardEvents() {
        const searchInput = document.getElementById('pricingSearchInput');
        const searchBtn = document.getElementById('pricingSearchBtn');
        const cancelBtn = document.getElementById('pricingCancelBtn');
        const saveBtn = document.getElementById('pricingSaveBtn');
        const resultContainer = document.getElementById('pricingResultContainer');
        const loadingEl = document.getElementById('pricingLoading');
        const errorEl = document.getElementById('pricingError');
        
        let currentTemplateList = [];
        let currentGroupIndex = 0;
        
        // 限制输入只能是数字和空格
        searchInput.addEventListener('input', function() {
            this.value = this.value.replace(/[^\d\s]/g, '');
        });
        
        // 搜索按钮点击事件
        searchBtn.addEventListener('click', async function() {
            const inputValue = searchInput.value.trim();
            if (!inputValue) {
                showError('请输入商品SPU');
                return;
            }
            
            const productIds = inputValue.split(/\s+/).filter(id => id).map(id => parseInt(id));
            if (productIds.length === 0) {
                showError('请输入有效的商品SPU');
                return;
            }
            
            if (productIds.length > 20) {
                showError('最多支持20个商品SPU');
                return;
            }
            
            hideError();
            loadingEl.style.display = 'block';
            resultContainer.style.display = 'none';
            
            try {
                const result = await fetchProductData(productIds);
                if (result.success) {
                    currentTemplateList = result.templateList;
                    currentGroupIndex = 0;
                    renderPricingTable(currentTemplateList, currentGroupIndex);
                    loadingEl.style.display = 'none';
                    resultContainer.style.display = 'block';
                } else {
                    loadingEl.style.display = 'none';
                    showError(result.error || '获取数据失败');
                }
            } catch (error) {
                loadingEl.style.display = 'none';
                showError('请求失败: ' + error.message);
            }
        });
        
        // 取消按钮
        cancelBtn.addEventListener('click', function() {
            resultContainer.style.display = 'none';
            currentTemplateList = [];
        });
        
        // 保存按钮
        saveBtn.addEventListener('click', async function() {
            const validation = validateAndCollectData();
            if (!validation.valid) {
                showError(validation.error);
                return;
            }
            
            // 更新当前组的template数据
            currentTemplateList[currentGroupIndex].template = validation.data;
            currentTemplateList[currentGroupIndex].isNew = true;
            currentTemplateList[currentGroupIndex].savedAt = Date.now();
            
            // 获取已保存的模板并合并
            const stored = await chrome.storage.local.get('pricingTemplateList');
            let savedList = stored.pricingTemplateList || [];
            
            // 检查是否已存在相同leafCat的模板，存在则更新
            const existingIndex = savedList.findIndex(t => 
                t.leafCat.catId === currentTemplateList[currentGroupIndex].leafCat.catId
            );
            if (existingIndex >= 0) {
                savedList[existingIndex] = currentTemplateList[currentGroupIndex];
            } else {
                savedList.push(currentTemplateList[currentGroupIndex]);
            }
            
            // 保存到缓存
            chrome.storage.local.set({ pricingTemplateList: savedList }, function() {
                addLog('[核价] 模板已保存');
                hideError();
                // 隐藏结果容器并清空搜索框
                resultContainer.style.display = 'none';
                searchInput.value = '';
                currentTemplateList = [];
                // 刷新模板列表
                loadSavedPricingTemplates(currentGroupIndex);
            });
        });
        
        function showError(msg) {
            errorEl.textContent = msg;
            errorEl.style.display = 'block';
        }
        
        function hideError() {
            errorEl.style.display = 'none';
        }
        
        // 获取商品数据
        async function fetchProductData(productIds) {
            if (!mallidCookie) {
                return { success: false, error: '未找到mallid Cookie' };
            }
            
            const url = 'https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery';
            const headers = {
                'accept': '*/*',
                'content-type': 'application/json',
                'mallid': mallidCookie.value
            };
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    credentials: 'include',
                    body: JSON.stringify({
                        productIds: productIds,
                        page: 1,
                        pageSize: 20
                    })
                });
                
                if (response.status === 403) {
                    return { success: false, error: 'Cookie已失效' };
                }
                
                const result = await response.json();
                if (!result.success) {
                    return { success: false, error: result.errorMsg || '请求失败' };
                }
                
                const goodsList = result.result?.pageItems || [];
                if (goodsList.length === 0) {
                    return { success: false, error: '未找到商品数据' };
                }
                
                // 按类目分组
                const grouped = {};
                for (const goods of goodsList) {
                    const leafCat = goods.leafCat || {};
                    const key = `${leafCat.catId || 0}_${leafCat.catName || ''}`;
                    
                    const categories = [];
                    const categoriesObj = goods.categories || {};
                    for (const catKey in categoriesObj) {
                        const catData = categoriesObj[catKey];
                        if (catData && typeof catData === 'object' && catData.catId && catData.catName) {
                            categories.push(catData.catName);
                        }
                    }
                    
                    const specs = [];
                    const skuSummaries = goods.productSkuSummaries || [];
                    for (const sku of skuSummaries) {
                        const specList = sku.productSkuSpecList || [];
                        for (const spec of specList) {
                            const specKey = `${spec.specId}_${spec.specName}`;
                            if (!specs.find(s => `${s.specId}_${s.specName}` === specKey)) {
                                specs.push({ specId: spec.specId, specName: spec.specName });
                            }
                        }
                    }
                    
                    if (!grouped[key]) {
                        grouped[key] = {
                            productId: [],
                            categories: new Set(categories),
                            leafCat: { catId: leafCat.catId || 0, catName: leafCat.catName || '' },
                            specs: specs
                        };
                    }
                    
                    grouped[key].productId.push(goods.productId);
                    categories.forEach(c => grouped[key].categories.add(c));
                    // 合并specs
                    for (const spec of specs) {
                        const specKey = `${spec.specId}_${spec.specName}`;
                        if (!grouped[key].specs.find(s => `${s.specId}_${s.specName}` === specKey)) {
                            grouped[key].specs.push(spec);
                        }
                    }
                }
                
                // 构建最终列表
                const templateList = Object.values(grouped).map(item => ({
                    productId: item.productId,
                    categories: Array.from(item.categories),
                    leafCat: item.leafCat,
                    template: item.specs.map(s => ({
                        specId: s.specId,
                        specName: s.specName,
                        times: '',
                        strategy: '',
                        acceptPrice: '',
                        minPrice: ''
                    }))
                }));
                
                return { success: true, templateList };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
        
        // 渲染表格
        function renderPricingTable(templateList, groupIndex) {
            if (templateList.length === 0) return;
            
            const group = templateList[groupIndex];
            const leafCatEl = document.getElementById('pricingLeafCat');
            const productIdsEl = document.getElementById('pricingProductIds');
            const categoriesEl = document.getElementById('pricingCategories');
            const tableBody = document.getElementById('pricingTableBody');
            
            leafCatEl.textContent = group.leafCat.catName || '未知类目';
            
            // 显示productId
            const productIds = group.productId || [];
            if (productIds.length > 1) {
                productIdsEl.textContent = '来源: ' + productIds[0] + '...';
                productIdsEl.title = productIds.join(', ');
            } else if (productIds.length === 1) {
                productIdsEl.textContent = '来源: ' + productIds[0];
                productIdsEl.title = '';
            } else {
                productIdsEl.textContent = '';
            }
            
            const categoriesText = group.categories.join(' > ');
            categoriesEl.textContent = categoriesText;
            categoriesEl.title = categoriesText;
            
            tableBody.innerHTML = '';
            
            for (let i = 0; i < group.template.length; i++) {
                const spec = group.template[i];
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="spec-name">${spec.specName}</td>
                    <td><input type="text" class="pricing-input pricing-times" data-index="${i}" value="${spec.times ? spec.times : '1'}"></td>
                    <td><input type="text" class="pricing-input pricing-strategy" data-index="${i}" value="${spec.strategy ? (spec.strategy / 100).toFixed(2) : ''}"></td>
                    <td><input type="text" class="pricing-input pricing-accept" data-index="${i}" value="${spec.acceptPrice ? (spec.acceptPrice / 100).toFixed(2) : ''}" ></td>
                    <td><input type="text" class="pricing-input pricing-min" data-index="${i}" value="${spec.minPrice ? (spec.minPrice / 100).toFixed(2) : ''}" ></td>
                `;
                tableBody.appendChild(row);
            }
            
            // 添加输入限制
            tableBody.querySelectorAll('.pricing-times').forEach(input => {
                input.addEventListener('input', function() {
                    this.value = this.value.replace(/[^\d]/g, '');
                });
            });
            
            tableBody.querySelectorAll('.pricing-strategy, .pricing-accept, .pricing-min').forEach(input => {
                input.addEventListener('input', function() {
                    this.value = this.value.replace(/[^\d.]/g, '');
                    // 只允许一个小数点
                    const parts = this.value.split('.');
                    if (parts.length > 2) {
                        this.value = parts[0] + '.' + parts.slice(1).join('');
                    }
                });
            });
        }
        
        // 验证并收集数据
        function validateAndCollectData() {
            const tableBody = document.getElementById('pricingTableBody');
            const rows = tableBody.querySelectorAll('tr');
            const data = [];
            
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const times = row.querySelector('.pricing-times').value.trim();
                const strategy = row.querySelector('.pricing-strategy').value.trim();
                const acceptPrice = row.querySelector('.pricing-accept').value.trim();
                const minPrice = row.querySelector('.pricing-min').value.trim();
                
                // 检查空值
                if (!times || !strategy || !acceptPrice || !minPrice) {
                    return { valid: false, error: `第${i + 1}行: 所有字段都不能为空` };
                }
                
                // 检查数值
                const timesNum = parseInt(times);
                const strategyNum = parseFloat(strategy);
                const acceptNum = parseFloat(acceptPrice);
                const minNum = parseFloat(minPrice);
                
                if (isNaN(timesNum) || timesNum <= 0) {
                    return { valid: false, error: `第${i + 1}行: 次数必须是大于0的整数` };
                }
                
                if (isNaN(strategyNum) || strategyNum <= 0) {
                    return { valid: false, error: `第${i + 1}行: 策略必须是大于0的数字` };
                }
                
                if (isNaN(acceptNum) || acceptNum <= 0) {
                    return { valid: false, error: `第${i + 1}行: 接受价必须是大于0的数字` };
                }
                
                if (isNaN(minNum) || minNum <= 0) {
                    return { valid: false, error: `第${i + 1}行: 最低价必须是大于0的数字` };
                }
                
                // 检查小数位数（最多3位）
                if (strategy.includes('.') && strategy.split('.')[1].length > 3) {
                    return { valid: false, error: `第${i + 1}行: 策略小数点后不能超过3位` };
                }
                if (acceptPrice.includes('.') && acceptPrice.split('.')[1].length > 3) {
                    return { valid: false, error: `第${i + 1}行: 接受价小数点后不能超过3位` };
                }
                if (minPrice.includes('.') && minPrice.split('.')[1].length > 3) {
                    return { valid: false, error: `第${i + 1}行: 最低价小数点后不能超过3位` };
                }
                
                const specData = currentTemplateList[currentGroupIndex].template[i];
                data.push({
                    specId: specData.specId,
                    specName: specData.specName,
                    times: timesNum,
                    strategy: Math.round(strategyNum * 100),
                    acceptPrice: Math.round(acceptNum * 100),
                    minPrice: Math.round(minNum * 100)
                });
            }
            
            return { valid: true, data };
        }
    }
    
    // 加载并显示已保存的模板
    function loadSavedTemplates(newSavedIndex = -1) {
        chrome.storage.local.get('pricingTemplateList', function(result) {
            const templatesList = document.getElementById('pricingTemplatesList');
            if (!templatesList) return;
            
            const savedTemplates = result.pricingTemplateList || [];
            templatesList.innerHTML = '';
            
            if (savedTemplates.length === 0) {
                templatesList.innerHTML = '<div class="no-templates">暂无保存的模板</div>';
                return;
            }
            
            savedTemplates.forEach((template, index) => {
                const isNew = template.isNew && (Date.now() - template.savedAt < 60000);
                const productIds = template.productId || [];
                const productIdDisplay = productIds.length > 1 
                    ? `来源: ${productIds[0]}...` 
                    : (productIds.length === 1 ? `来源: ${productIds[0]}` : '');
                const productIdTitle = productIds.length > 1 ? productIds.join(', ') : '';
                const categoriesText = (template.categories || []).join(' > ');
                
                const templateItem = document.createElement('div');
                templateItem.className = 'template-item';
                templateItem.dataset.index = index;
                
                templateItem.innerHTML = `
                    <div class="template-header" data-index="${index}">
                        <div class="template-header-top">
                            <div class="template-header-left">
                                <span class="template-expand-icon">▶</span>
                                <span class="template-leaf-cat">${template.leafCat.catName || '未知类目'}</span>
                                ${isNew ? '<span class="template-new-tag">new</span>' : ''}
                                <span class="template-product-ids" title="${productIdTitle}">${productIdDisplay}</span>
                            </div>
                        </div>
                        <div class="template-header-expanded" style="display: none;">
                            <span class="template-categories" title="${categoriesText}">${categoriesText}</span>
                            <div class="template-actions-header">
                                <button class="template-edit-btn" data-index="${index}">编辑</button>
                                <button class="template-delete-btn" data-index="${index}">删除</button>
                            </div>
                        </div>
                    </div>
                    <div class="template-content" style="display: none;">
                        <table class="pricing-table template-table">
                            <thead>
                                <tr>
                                    <th>规格</th>
                                    <th>次数</th>
                                    <th>策略(元)</th>
                                    <th>接受价(元)</th>
                                    <th>最低价(元)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(template.template || []).map((spec, specIndex) => `
                                    <tr>
                                        <td class="spec-name">${spec.specName}</td>
                                        <td><input type="text" class="pricing-input template-times" data-spec="${specIndex}" value="${spec.times || 1}" disabled></td>
                                        <td><input type="text" class="pricing-input template-strategy" data-spec="${specIndex}" value="${spec.strategy ? (spec.strategy / 100).toFixed(2) : ''}" disabled></td>
                                        <td><input type="text" class="pricing-input template-accept" data-spec="${specIndex}" value="${spec.acceptPrice ? (spec.acceptPrice / 100).toFixed(2) : ''}" disabled></td>
                                        <td><input type="text" class="pricing-input template-min" data-spec="${specIndex}" value="${spec.minPrice ? (spec.minPrice / 100).toFixed(2) : ''}" disabled></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        <div class="template-edit-actions" style="display: none;">
                            <button class="template-cancel-edit-btn" data-index="${index}">取消</button>
                            <button class="template-save-edit-btn" data-index="${index}">保存</button>
                        </div>
                    </div>
                `;
                
                templatesList.appendChild(templateItem);
                
                // 如果是新保存的，自动展开
                if (newSavedIndex === index || isNew) {
                    const content = templateItem.querySelector('.template-content');
                    const headerExpanded = templateItem.querySelector('.template-header-expanded');
                    const icon = templateItem.querySelector('.template-expand-icon');
                    content.style.display = 'block';
                    headerExpanded.style.display = 'flex';
                    icon.textContent = '▼';
                    templateItem.classList.add('expanded');
                }
            });
            
            // 绑定事件
            setupTemplateEvents();
        });
    }
    
    // 设置模板事件
    function setupTemplateEvents() {
        const templatesList = document.getElementById('pricingTemplatesList');
        if (!templatesList) return;
        
        // 展开/折叠
        templatesList.querySelectorAll('.template-header').forEach(header => {
            header.addEventListener('click', function(e) {
                if (e.target.classList.contains('template-edit-btn') || 
                    e.target.classList.contains('template-delete-btn')) return;
                
                const item = this.closest('.template-item');
                const content = item.querySelector('.template-content');
                const headerExpanded = item.querySelector('.template-header-expanded');
                const icon = item.querySelector('.template-expand-icon');
                
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    headerExpanded.style.display = 'flex';
                    icon.textContent = '▼';
                    item.classList.add('expanded');
                } else {
                    content.style.display = 'none';
                    headerExpanded.style.display = 'none';
                    icon.textContent = '▶';
                    item.classList.remove('expanded');
                }
            });
        });
        
        // 编辑按钮
        templatesList.querySelectorAll('.template-edit-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const index = parseInt(this.dataset.index);
                const item = this.closest('.template-item');
                const inputs = item.querySelectorAll('.pricing-input');
                const editActions = item.querySelector('.template-edit-actions');
                const actionsTop = item.querySelector('.template-actions-top');
                
                inputs.forEach(input => input.disabled = false);
                editActions.style.display = 'flex';
                actionsTop.style.display = 'none';
                
                // 添加输入限制
                item.querySelectorAll('.template-times').forEach(input => {
                    input.addEventListener('input', function() {
                        this.value = this.value.replace(/[^\d]/g, '');
                    });
                });
                
                item.querySelectorAll('.template-strategy, .template-accept, .template-min').forEach(input => {
                    input.addEventListener('input', function() {
                        this.value = this.value.replace(/[^\d.]/g, '');
                        const parts = this.value.split('.');
                        if (parts.length > 2) {
                            this.value = parts[0] + '.' + parts.slice(1).join('');
                        }
                    });
                });
            });
        });
        
        // 取消编辑
        templatesList.querySelectorAll('.template-cancel-edit-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                loadSavedTemplates();
            });
        });
        
        // 保存编辑
        templatesList.querySelectorAll('.template-save-edit-btn').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                const index = parseInt(this.dataset.index);
                const item = this.closest('.template-item');
                
                // 验证并收集数据
                const rows = item.querySelectorAll('tbody tr');
                const newTemplate = [];
                let hasError = false;
                
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const times = row.querySelector('.template-times').value.trim();
                    const strategy = row.querySelector('.template-strategy').value.trim();
                    const acceptPrice = row.querySelector('.template-accept').value.trim();
                    const minPrice = row.querySelector('.template-min').value.trim();
                    
                    if (!times || !strategy || !acceptPrice || !minPrice) {
                        alert(`第${i + 1}行: 所有字段都不能为空`);
                        hasError = true;
                        break;
                    }
                    
                    const timesNum = parseInt(times);
                    const strategyNum = parseFloat(strategy);
                    const acceptNum = parseFloat(acceptPrice);
                    const minNum = parseFloat(minPrice);
                    
                    if (isNaN(timesNum) || timesNum <= 0 || 
                        isNaN(strategyNum) || strategyNum <= 0 ||
                        isNaN(acceptNum) || acceptNum <= 0 ||
                        isNaN(minNum) || minNum <= 0) {
                        alert(`第${i + 1}行: 数值必须大于0`);
                        hasError = true;
                        break;
                    }
                    
                    const specIndex = parseInt(row.querySelector('.template-times').dataset.spec);
                    const stored = await chrome.storage.local.get('pricingTemplateList');
                    const specData = stored.pricingTemplateList[index].template[specIndex];
                    
                    newTemplate.push({
                        specId: specData.specId,
                        specName: specData.specName,
                        times: timesNum,
                        strategy: Math.round(strategyNum * 100),
                        acceptPrice: Math.round(acceptNum * 100),
                        minPrice: Math.round(minNum * 100)
                    });
                }
                
                if (hasError) return;
                
                // 保存更新
                const stored = await chrome.storage.local.get('pricingTemplateList');
                const savedList = stored.pricingTemplateList || [];
                savedList[index].template = newTemplate;
                savedList[index].isNew = false;
                
                chrome.storage.local.set({ pricingTemplateList: savedList }, function() {
                    addLog('[核价] 模板已更新');
                    loadSavedTemplates(index);
                });
            });
        });
        
        // 删除按钮
        templatesList.querySelectorAll('.template-delete-btn').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                if (!confirm('确定删除此模板？')) return;
                
                const index = parseInt(this.dataset.index);
                const stored = await chrome.storage.local.get('pricingTemplateList');
                const savedList = stored.pricingTemplateList || [];
                savedList.splice(index, 1);
                
                chrome.storage.local.set({ pricingTemplateList: savedList }, function() {
                    addLog('[核价] 模板已删除');
                    loadSavedTemplates();
                });
            });
        });
    }
    
    // 自动核价配置事件设置
    let autoPricingInterval = null;
    let autoPricingRunning = false;
    let autoPricingEventsInitialized = false;
    
    function setupAutoPricingEvents() {
        // 防止重复初始化
        if (autoPricingEventsInitialized) return;
        autoPricingEventsInitialized = false;
        
        const intervalSelect = document.getElementById('autoPricingInterval');
        const nowBtn = document.getElementById('autoPricingNowBtn');
        const scheduleBtn = document.getElementById('autoPricingScheduleBtn');
        const infoEl = document.getElementById('autoPricingInfo');
        
        if (!intervalSelect || !nowBtn || !scheduleBtn || !infoEl) return;
        
        // 设置PricingService的回调
        PricingService.setLogCallback((message) => {
            addLog(message);
        });
        
        PricingService.setProgressCallback((percent, message) => {
            updateAutoPricingProgress(nowBtn, percent, message);
        });
        
        // 从缓存加载配置
        chrome.storage.local.get('autoPricingConfig', function(result) {
            const config = result.autoPricingConfig || {};
            if (config.interval) {
                intervalSelect.value = config.interval;
            }
            if (config.enabled) {
                startAutoPricingSchedule();
            }
        });
        
        // 立即核价按钮
        nowBtn.addEventListener('click', async function() {
            if (autoPricingRunning) return;
            
            if (!mallidCookie || !sellerTempCookie) {
                addLog('[核价] Cookie不可用');
                return;
            }
            
            await executeAutoPricing();
        });
        
        // 定时核价按钮
        scheduleBtn.addEventListener('click', function() {
            const interval = parseInt(intervalSelect.value);
            
            if (interval === 0) {
                addLog('[核价] 请先选择定时间隔');
                return;
            }
            
            if (autoPricingInterval) {
                stopAutoPricingSchedule();
            } else {
                startAutoPricingSchedule();
            }
        });
        
        // 间隔选择改变
        intervalSelect.addEventListener('change', function() {
            const interval = parseInt(this.value);
            chrome.storage.local.set({ 
                autoPricingConfig: { 
                    interval: interval,
                    enabled: autoPricingInterval !== null
                }
            });
            
            if (autoPricingInterval && interval > 0) {
                stopAutoPricingSchedule();
                startAutoPricingSchedule();
            }
        });
    }
    
    // 执行自动核价
    async function executeAutoPricing() {
        if (autoPricingRunning) return;
        
        autoPricingRunning = true;
        const nowBtn = document.getElementById('autoPricingNowBtn');
        const infoEl = document.getElementById('autoPricingInfo');
        
        nowBtn.classList.add('running');
        updateAutoPricingProgress(nowBtn, 0, '准备中...');
        
        try {
            const mallid = mallidCookie.value;
            const sellerTemp = sellerTempCookie.value;
            
            const cachedCookies = await chrome.storage.local.get('cachedCookies');
            const shopName = cachedCookies.cachedCookies?.shopName || '未知店铺';
            
            const result = await PricingService.executePricingTask(mallid, sellerTemp, shopName);
            
            if (result.success && result.logs && result.logs.length > 0) {
                downloadPricingLog(shopName, result.logs);
            }
            
            updateAutoPricingProgress(nowBtn, 100, '完成');
            infoEl.textContent = `最后执行: ${new Date().toLocaleTimeString()}`;
            
            // 清除核价模板的new标签
            await clearPricingTemplatesNewTag();
        } catch (e) {
            addLog(`[核价] 执行失败: ${e.message}`);
            updateAutoPricingProgress(nowBtn, 0, '失败');
        } finally {
            autoPricingRunning = false;
            nowBtn.classList.remove('running');
            setTimeout(() => {
                updateAutoPricingProgress(nowBtn, 0, '');
            }, 2000);
        }
    }
    
    // 清除核价模板的new标签
    async function clearPricingTemplatesNewTag() {
        const stored = await chrome.storage.local.get('pricingTemplateList');
        const list = stored.pricingTemplateList || [];
        let hasNew = false;
        list.forEach(t => {
            if (t.isNew) {
                t.isNew = false;
                hasNew = true;
            }
        });
        if (hasNew) {
            await chrome.storage.local.set({ pricingTemplateList: list });
            loadSavedTemplates(); // 刷新UI
        }
    }
    
    // 启动定时核价
    function startAutoPricingSchedule() {
        const intervalSelect = document.getElementById('autoPricingInterval');
        const scheduleBtn = document.getElementById('autoPricingScheduleBtn');
        const infoEl = document.getElementById('autoPricingInfo');
        
        const interval = parseInt(intervalSelect.value);
        
        if (interval === 0) {
            addLog('[核价] 请先选择定时间隔');
            return;
        }
        
        scheduleBtn.classList.add('active');
        scheduleBtn.querySelector('.auto-pricing-btn-text').textContent = '停止定时';
        
        autoPricingInterval = setInterval(async () => {
            if (!autoPricingRunning && mallidCookie && sellerTempCookie) {
                await executeAutoPricing();
            }
        }, interval);
        
        chrome.storage.local.set({ 
            autoPricingConfig: { 
                interval: interval,
                enabled: true
            }
        });
        
        addLog(`[核价] 定时核价已启动，间隔: ${getIntervalText(interval)}`);
        infoEl.textContent = `定时间隔: ${getIntervalText(interval)}`;
    }
    
    // 停止定时核价
    function stopAutoPricingSchedule() {
        const scheduleBtn = document.getElementById('autoPricingScheduleBtn');
        const infoEl = document.getElementById('autoPricingInfo');
        
        if (autoPricingInterval) {
            clearInterval(autoPricingInterval);
            autoPricingInterval = null;
        }
        
        scheduleBtn.classList.remove('active');
        scheduleBtn.querySelector('.auto-pricing-btn-text').textContent = '启动定时';
        
        chrome.storage.local.set({ 
            autoPricingConfig: { 
                interval: parseInt(document.getElementById('autoPricingInterval').value),
                enabled: false
            }
        });
        
        addLog('[核价] 定时核价已停止');
        infoEl.textContent = '';
    }
    
    // 更新核价进度
    function updateAutoPricingProgress(btnEl, percent, message) {
        if (!btnEl) return;
        
        const progressBar = btnEl.querySelector('.auto-pricing-btn-progress');
        const textEl = btnEl.querySelector('.auto-pricing-btn-text');
        
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
        
        if (textEl && message) {
            textEl.textContent = message;
        } else if (textEl && !message) {
            textEl.textContent = '立即核价';
        }
    }
    
    // 获取间隔文本
    function getIntervalText(interval) {
        const minutes = interval / 60000;
        if (minutes < 60) {
            return `${minutes}分钟`;
        } else {
            return `${minutes / 60}小时`;
        }
    }
    
    // 下载核价日志
    function downloadPricingLog(shopName, logs) {
        if (!logs || logs.length === 0) return;
        
        const now = new Date();
        const dateTimeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const filename = `${shopName}_${dateTimeStr}核价日志.log`;
        
        const logContent = logs.join('\n');
        const blob = new Blob(['\ufeff' + logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        
        addLog(`[核价] 日志已导出: ${filename}`);
    }
    
    // 合规配置卡片事件设置
    function setupComplianceConfigCardEvents() {
        const searchInput = document.getElementById('complianceSearchInput');
        const searchBtn = document.getElementById('complianceSearchBtn');
        const cancelBtn = document.getElementById('complianceCancelBtn');
        const saveBtn = document.getElementById('complianceSaveBtn');
        const resultContainer = document.getElementById('complianceResultContainer');
        const loadingEl = document.getElementById('complianceLoading');
        const errorEl = document.getElementById('complianceError');
        
        let currentComplianceTemplate = null;
        
        // 搜索按钮点击
        searchBtn.addEventListener('click', async function() {
            const spuInput = searchInput.value.trim();
            if (!spuInput) {
                errorEl.textContent = '请输入SPU ID';
                errorEl.style.display = 'block';
                return;
            }
            
            const spuId = parseInt(spuInput);
            if (isNaN(spuId)) {
                errorEl.textContent = 'SPU ID格式错误';
                errorEl.style.display = 'block';
                return;
            }
            
            if (!mallidCookie || !sellerTempCookie) {
                errorEl.textContent = 'Cookie不可用';
                errorEl.style.display = 'block';
                return;
            }
            
            loadingEl.style.display = 'block';
            errorEl.style.display = 'none';
            resultContainer.style.display = 'none';
            
            try {
                const result = await ComplianceService.getComplianceTemplateFromSpu(
                    spuId, 
                    mallidCookie.value, 
                    sellerTempCookie.value
                );
                
                loadingEl.style.display = 'none';
                
                if (result.success) {
                    currentComplianceTemplate = result.data;
                    renderComplianceTemplate(result.data);
                    resultContainer.style.display = 'block';
                } else {
                    errorEl.textContent = result.message || '获取模板失败';
                    errorEl.style.display = 'block';
                }
            } catch (e) {
                loadingEl.style.display = 'none';
                errorEl.textContent = e.message;
                errorEl.style.display = 'block';
            }
        });
        
        // 取消按钮
        cancelBtn.addEventListener('click', function() {
            resultContainer.style.display = 'none';
            searchInput.value = '';
            currentComplianceTemplate = null;
        });
        
        // 保存按钮
        saveBtn.addEventListener('click', async function() {
            if (!currentComplianceTemplate) return;
            
            const stored = await chrome.storage.local.get('complianceTemplateList');
            const savedList = stored.complianceTemplateList || [];
            
            // 检查是否已存在相同cat_id的模板
            const existingIndex = savedList.findIndex(t => t.cat_id === currentComplianceTemplate.cat_id);
            
            if (existingIndex >= 0) {
                // 更新现有模板
                savedList[existingIndex] = {
                    ...currentComplianceTemplate,
                    savedAt: Date.now(),
                    isNew: true
                };
            } else {
                // 添加新模板
                savedList.push({
                    ...currentComplianceTemplate,
                    savedAt: Date.now(),
                    isNew: true
                });
            }
            
            chrome.storage.local.set({ complianceTemplateList: savedList }, function() {
                addLog('[合规] 模板已保存');
                resultContainer.style.display = 'none';
                searchInput.value = '';
                currentComplianceTemplate = null;
                loadSavedComplianceTemplates();
            });
        });
    }
    
    // 渲染合规模板
    function renderComplianceTemplate(template) {
        const leafCatEl = document.getElementById('complianceLeafCat');
        const productIdsEl = document.getElementById('complianceProductIds');
        const tasksListEl = document.getElementById('complianceTasksList');
        
        leafCatEl.textContent = `类目ID: ${template.cat_id}`;
        productIdsEl.textContent = `来源: ${template.input_spu.join(', ')}`;
        
        // 渲染任务列表
        const templateList = template.template_list || [];
        const realPictureList = template.real_picture_info_list || [];
        
        let tasksHtml = '<div class="compliance-tasks-grid">';
        
        for (const task of templateList) {
            const isEnabled = task.task_status === 3;
            const icon = isEnabled ? '☑' : '□';
            const taskName = task.task_name || `任务${task.task_type}`;
            tasksHtml += `<span class="compliance-task-item ${isEnabled ? 'enabled' : 'disabled'}">${icon} ${taskName}</span>`;
        }
        
        // 添加实拍图状态
        if (realPictureList.length > 0) {
            tasksHtml += `<span class="compliance-task-item enabled">☑ 实拍图(${realPictureList.length}张)</span>`;
        }
        
        tasksHtml += '</div>';
        tasksListEl.innerHTML = tasksHtml;
    }
    
    // 加载已保存的合规模板
    async function loadSavedComplianceTemplates() {
        const templatesList = document.getElementById('complianceTemplatesList');
        if (!templatesList) return;
        
        const stored = await chrome.storage.local.get('complianceTemplateList');
        const savedList = stored.complianceTemplateList || [];
        
        if (savedList.length === 0) {
            templatesList.innerHTML = '<div class="no-templates">暂无保存的模板</div>';
            return;
        }
        
        let html = '';
        for (let i = 0; i < savedList.length; i++) {
            const template = savedList[i];
            const templateList = template.template_list || [];
            const realPictureList = template.real_picture_info_list || [];
            const enabledTasks = templateList.filter(t => t.task_status === 3);
            
            html += `
                <div class="compliance-template-item" data-index="${i}">
                    <div class="compliance-template-header">
                        <div class="compliance-template-header-left">
                            <span class="compliance-template-expand-icon">▶</span>
                            <span class="compliance-template-cat">类目: ${template.cat_id}</span>
                            ${template.isNew ? '<span class="compliance-template-new-tag">new</span>' : ''}
                            <span class="compliance-template-product-ids">来源: ${template.input_spu.join(', ')}</span>
                        </div>
                        <div class="compliance-template-actions">
                            <button class="compliance-template-delete-btn" data-index="${i}">删除</button>
                        </div>
                    </div>
                    <div class="compliance-template-content" style="display: none;">
                        <div class="compliance-tasks-grid">`;
            
            for (const task of enabledTasks) {
                const taskName = task.task_name || `任务${task.task_type}`;
                html += `<span class="compliance-task-item enabled">☑ ${taskName}</span>`;
            }
            
            if (realPictureList.length > 0) {
                html += `<span class="compliance-task-item enabled">☑ 实拍图(${realPictureList.length}张)</span>`;
            }
            
            html += `
                        </div>
                    </div>
                </div>
            `;
        }
        
        templatesList.innerHTML = html;
        setupComplianceTemplateEvents();
        
        // 清除new标记
        setTimeout(async () => {
            const stored = await chrome.storage.local.get('complianceTemplateList');
            const list = stored.complianceTemplateList || [];
            let hasNew = false;
            list.forEach(t => {
                if (t.isNew) {
                    t.isNew = false;
                    hasNew = true;
                }
            });
            if (hasNew) {
                chrome.storage.local.set({ complianceTemplateList: list });
            }
        }, 5000);
    }
    
    // 合规模板事件设置
    function setupComplianceTemplateEvents() {
        const templatesList = document.getElementById('complianceTemplatesList');
        if (!templatesList) return;
        
        // 展开/折叠
        templatesList.querySelectorAll('.compliance-template-header').forEach(header => {
            header.addEventListener('click', function(e) {
                if (e.target.classList.contains('compliance-template-delete-btn')) return;
                
                const item = this.closest('.compliance-template-item');
                const content = item.querySelector('.compliance-template-content');
                const icon = item.querySelector('.compliance-template-expand-icon');
                
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    icon.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    icon.textContent = '▶';
                }
            });
        });
        
        // 删除按钮
        templatesList.querySelectorAll('.compliance-template-delete-btn').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                if (!confirm('确定删除此模板？')) return;
                
                const index = parseInt(this.dataset.index);
                const stored = await chrome.storage.local.get('complianceTemplateList');
                const savedList = stored.complianceTemplateList || [];
                savedList.splice(index, 1);
                
                chrome.storage.local.set({ complianceTemplateList: savedList }, function() {
                    addLog('[合规] 模板已删除');
                    loadSavedComplianceTemplates();
                });
            });
        });
    }
    
    // 自动合规配置事件设置
    let autoComplianceInterval = null;
    let autoComplianceRunning = false;
    let autoComplianceEventsInitialized = false;
    
    function setupAutoComplianceEvents() {
        // 防止重复初始化
        if (autoComplianceEventsInitialized) return;
        autoComplianceEventsInitialized = false;
        
        const intervalSelect = document.getElementById('autoComplianceInterval');
        const nowBtn = document.getElementById('autoComplianceNowBtn');
        const scheduleBtn = document.getElementById('autoComplianceScheduleBtn');
        const infoEl = document.getElementById('autoComplianceInfo');
        
        if (!intervalSelect || !nowBtn || !scheduleBtn || !infoEl) return;
        
        // 设置ComplianceService的回调
        ComplianceService.setLogCallback((message) => {
            addLog(message);
        });
        
        ComplianceService.setProgressCallback((percent, message) => {
            updateAutoComplianceProgress(nowBtn, percent, message);
        });
        
        // 从缓存加载配置
        chrome.storage.local.get('autoComplianceConfig', function(result) {
            const config = result.autoComplianceConfig || {};
            if (config.interval) {
                intervalSelect.value = config.interval;
            }
            if (config.enabled) {
                startAutoComplianceSchedule();
            }
        });
        
        // 立即合规按钮
        nowBtn.addEventListener('click', async function() {
            if (autoComplianceRunning) return;
            
            if (!mallidCookie || !sellerTempCookie) {
                addLog('[合规] Cookie不可用');
                return;
            }
            
            await executeAutoCompliance();
        });
        
        // 定时合规按钮
        scheduleBtn.addEventListener('click', function() {
            const interval = parseInt(intervalSelect.value);
            
            if (interval === 0) {
                addLog('[合规] 请先选择定时间隔');
                return;
            }
            
            if (autoComplianceInterval) {
                stopAutoComplianceSchedule();
            } else {
                startAutoComplianceSchedule();
            }
        });
        
        // 间隔选择改变
        intervalSelect.addEventListener('change', function() {
            const interval = parseInt(this.value);
            chrome.storage.local.set({ 
                autoComplianceConfig: { 
                    interval: interval,
                    enabled: autoComplianceInterval !== null
                }
            });
            
            if (autoComplianceInterval && interval > 0) {
                stopAutoComplianceSchedule();
                startAutoComplianceSchedule();
            }
        });
    }
    
    // 执行自动合规
    async function executeAutoCompliance() {
        if (autoComplianceRunning) return;
        
        autoComplianceRunning = true;
        const nowBtn = document.getElementById('autoComplianceNowBtn');
        const infoEl = document.getElementById('autoComplianceInfo');
        
        nowBtn.classList.add('running');
        updateAutoComplianceProgress(nowBtn, 0, '准备中...');
        
        try {
            const mallid = mallidCookie.value;
            const sellerTemp = sellerTempCookie.value;
            
            const cachedCookies = await chrome.storage.local.get('cachedCookies');
            const shopName = cachedCookies.cachedCookies?.shopName || '未知店铺';
            
            const result = await ComplianceService.executeComplianceTask(mallid, sellerTemp, shopName);
            
            if (result.success && result.logs && result.logs.length > 0) {
                downloadComplianceLog(shopName, result.logs);
            }
            
            updateAutoComplianceProgress(nowBtn, 100, '完成');
            infoEl.textContent = `最后执行: ${new Date().toLocaleTimeString()}`;
            
            // 清除合规模板的new标签
            await clearComplianceTemplatesNewTag();
        } catch (e) {
            addLog(`[合规] 执行失败: ${e.message}`);
            updateAutoComplianceProgress(nowBtn, 0, '失败');
        } finally {
            autoComplianceRunning = false;
            nowBtn.classList.remove('running');
            setTimeout(() => {
                updateAutoComplianceProgress(nowBtn, 0, '');
            }, 2000);
        }
    }
    
    // 清除合规模板的new标签
    async function clearComplianceTemplatesNewTag() {
        const stored = await chrome.storage.local.get('complianceTemplateList');
        const list = stored.complianceTemplateList || [];
        let hasNew = false;
        list.forEach(t => {
            if (t.isNew) {
                t.isNew = false;
                hasNew = true;
            }
        });
        if (hasNew) {
            await chrome.storage.local.set({ complianceTemplateList: list });
            loadSavedComplianceTemplates(); // 刷新UI
        }
    }
    
    // 启动定时合规
    function startAutoComplianceSchedule() {
        const intervalSelect = document.getElementById('autoComplianceInterval');
        const scheduleBtn = document.getElementById('autoComplianceScheduleBtn');
        const infoEl = document.getElementById('autoComplianceInfo');
        
        const interval = parseInt(intervalSelect.value);
        
        if (interval === 0) {
            addLog('[合规] 请先选择定时间隔');
            return;
        }
        
        scheduleBtn.classList.add('active');
        scheduleBtn.querySelector('.auto-compliance-btn-text').textContent = '停止定时';
        
        autoComplianceInterval = setInterval(async () => {
            if (!autoComplianceRunning && mallidCookie && sellerTempCookie) {
                await executeAutoCompliance();
            }
        }, interval);
        
        chrome.storage.local.set({ 
            autoComplianceConfig: { 
                interval: interval,
                enabled: true
            }
        });
        
        addLog(`[合规] 定时合规已启动，间隔: ${getIntervalText(interval)}`);
        infoEl.textContent = `定时间隔: ${getIntervalText(interval)}`;
    }
    
    // 停止定时合规
    function stopAutoComplianceSchedule() {
        const scheduleBtn = document.getElementById('autoComplianceScheduleBtn');
        const infoEl = document.getElementById('autoComplianceInfo');
        
        if (autoComplianceInterval) {
            clearInterval(autoComplianceInterval);
            autoComplianceInterval = null;
        }
        
        scheduleBtn.classList.remove('active');
        scheduleBtn.querySelector('.auto-compliance-btn-text').textContent = '启动定时';
        
        chrome.storage.local.set({ 
            autoComplianceConfig: { 
                interval: parseInt(document.getElementById('autoComplianceInterval').value),
                enabled: false
            }
        });
        
        addLog('[合规] 定时合规已停止');
        infoEl.textContent = '';
    }
    
    // 更新合规进度
    function updateAutoComplianceProgress(btnEl, percent, message) {
        if (!btnEl) return;
        
        const progressBar = btnEl.querySelector('.auto-compliance-btn-progress');
        const textEl = btnEl.querySelector('.auto-compliance-btn-text');
        
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
        
        if (textEl && message) {
            textEl.textContent = message;
        } else if (textEl && !message) {
            textEl.textContent = '立即合规';
        }
    }
    
    // 下载合规日志
    function downloadComplianceLog(shopName, logs) {
        if (!logs || logs.length === 0) return;
        
        const now = new Date();
        const dateTimeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const filename = `${shopName}_${dateTimeStr}合规日志.log`;
        
        const logContent = logs.join('\n');
        const blob = new Blob(['\ufeff' + logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        
        addLog(`[合规] 日志已导出: ${filename}`);
    }
    
    function generateCampaignConfigCard() {
        campaignConfigCard.innerHTML = `
            <div class="activity-search-container">
                <div class="activity-search-row">
                    <input type="text" class="activity-search-input" id="activitySearchInput" placeholder="输入SPU 制作活动模板">
                    <button class="activity-search-btn" id="activitySearchBtn">搜索</button>
                </div>
            </div>
            <div class="activity-result-container" id="activityResultContainer" style="display: none;">
                <div class="activity-product-info">
                    <div class="activity-product-header">
                        <span class="activity-cat-name" id="activityCatName"></span>
                        <span class="activity-product-id" id="activityProductId"></span>
                    </div>
                    <div class="activity-categories" id="activityCategories"></div>
                </div>
                <div class="activity-sku-list" id="activitySkuList"></div>
                <div class="activity-actions">
                    <button class="activity-cancel-btn" id="activityCancelBtn">取消</button>
                    <button class="activity-save-btn" id="activitySaveBtn">保存模板</button>
                </div>
            </div>
            <div class="activity-loading" id="activityLoading" style="display: none;">加载中...</div>
            <div class="activity-error" id="activityError" style="display: none;"></div>
            <div class="activity-templates-section" id="activityTemplatesSection">
                <div class="activity-templates-title">---------------已保存的活动模板---------------</div>
                <div class="activity-templates-list" id="activityTemplatesList"></div>
            </div>
            <div class="auto-activity-section" id="autoActivitySection">
                <div class="auto-activity-title">---------------自动报名配置---------------</div>
                <div class="auto-activity-config">
                    <div class="auto-activity-row">
                        <label class="auto-activity-label">定时报名:</label>
                        <select class="auto-activity-select" id="autoActivityInterval">
                            <option value="0">未开启</option>
                            <option value="60000">1分钟</option>
                            <option value="10800000">3小时</option>
                            <option value="21600000">6小时</option>
                            <option value="43200000">12小时</option>
                        </select>
                    </div>
                    <div class="auto-activity-buttons">
                        <button class="auto-activity-btn" id="autoActivityNowBtn">
                            <span class="auto-activity-btn-text">立即报名</span>
                            <div class="auto-activity-btn-progress" style="width: 0%;"></div>
                        </button>
                        <button class="auto-activity-btn" id="autoActivityScheduleBtn">
                            <span class="auto-activity-btn-text">启动定时</span>
                            <div class="auto-activity-btn-progress" style="width: 0%;"></div>
                        </button>
                    </div>
                    <div class="auto-activity-info" id="autoActivityInfo"></div>
                </div>
            </div>
        `;
        autoActivityEventsInitialized = false;
        setupCampaignConfigCardEvents();
        loadSavedActivityTemplates();
        setupAutoActivityEvents();
    }
    
    // 活动配置卡片事件设置
    let currentActivityTemplate = null;
    let currentActivityList = [];
    
    function setupActivityConfigCardEvents() {
        const searchInput = document.getElementById('activitySearchInput');
        const searchBtn = document.getElementById('activitySearchBtn');
        const cancelBtn = document.getElementById('activityCancelBtn');
        const saveBtn = document.getElementById('activitySaveBtn');
        const resultContainer = document.getElementById('activityResultContainer');
        const loadingEl = document.getElementById('activityLoading');
        const errorEl = document.getElementById('activityError');
        
        // 搜索按钮点击
        searchBtn.addEventListener('click', async function() {
            const spuInput = searchInput.value.trim();
            if (!spuInput) {
                errorEl.textContent = '请输入SPU ID';
                errorEl.style.display = 'block';
                return;
            }
            
            const spuId = parseInt(spuInput);
            if (isNaN(spuId)) {
                errorEl.textContent = 'SPU ID格式错误';
                errorEl.style.display = 'block';
                return;
            }
            
            if (!mallidCookie || !sellerTempCookie) {
                errorEl.textContent = 'Cookie不可用';
                errorEl.style.display = 'block';
                return;
            }
            
            loadingEl.style.display = 'block';
            errorEl.style.display = 'none';
            resultContainer.style.display = 'none';
            
            try {
                // 先获取活动列表
                const activityResult = await ActivityService.queryAllActivities(
                    mallidCookie.value,
                    sellerTempCookie.value
                );
                
                if (!activityResult.success) {
                    loadingEl.style.display = 'none';
                    errorEl.textContent = activityResult.message || '获取活动列表失败';
                    errorEl.style.display = 'block';
                    return;
                }
                
                currentActivityList = activityResult.data;
                
                // 查询SPU的可报活动
                const result = await ActivityService.querySpuActivities(
                    spuId,
                    mallidCookie.value,
                    sellerTempCookie.value
                );
                
                loadingEl.style.display = 'none';
                
                if (result.success && result.data.length > 0) {
                    currentActivityTemplate = {
                        spuId: spuId,
                        products: result.data,
                        allActivityIds: activityResult.allActivityIds,
                        activityList: activityResult.data
                    };
                    renderActivityTemplate(result.data[0], activityResult.data, activityResult.allActivityIds);
                    resultContainer.style.display = 'block';
                } else {
                    errorEl.textContent = result.message || '未找到可报活动';
                    errorEl.style.display = 'block';
                }
            } catch (e) {
                loadingEl.style.display = 'none';
                errorEl.textContent = e.message;
                errorEl.style.display = 'block';
            }
        });
        
        // 取消按钮
        cancelBtn.addEventListener('click', function() {
            resultContainer.style.display = 'none';
            searchInput.value = '';
            currentActivityTemplate = null;
        });
        
        // 保存按钮
        saveBtn.addEventListener('click', async function() {
            if (!currentActivityTemplate) return;
            
            // 收集SKU配置
            const skuData = collectActivitySkuData();
            if (!skuData || skuData.length === 0) {
                addLog('[活动] 请填写活动价格和库存');
                return;
            }
            
            const product = currentActivityTemplate.products[0];
            
            // 构建模板
            const template = {
                spuId: currentActivityTemplate.spuId,
                catId: product?.leafCat?.catId || 0,
                catName: product?.leafCat?.catName || `SPU ${currentActivityTemplate.spuId}`,
                categories: product?.categories || [],
                skuData: skuData,
                savedAt: Date.now()
            };
            
            const stored = await chrome.storage.local.get('activityTemplateList');
            const savedList = stored.activityTemplateList || [];
            
            // 检查是否已存在相同spuId的模板
            const existingIndex = savedList.findIndex(t => t.spuId === template.spuId);
            
            if (existingIndex >= 0) {
                savedList[existingIndex] = template;
            } else {
                savedList.push(template);
            }
            
            chrome.storage.local.set({ activityTemplateList: savedList }, function() {
                addLog('[活动] 模板已保存');
                resultContainer.style.display = 'none';
                searchInput.value = '';
                currentActivityTemplate = null;
                loadSavedActivityTemplates();
            });
        });
    }
    
    // 渲染活动模板 (新布局: 每个规格独立活动选择)
    function renderActivityTemplate(product, activityList, allActivityIds) {
        const catNameEl = document.getElementById('activityCatName');
        const productIdEl = document.getElementById('activityProductId');
        const categoriesEl = document.getElementById('activityCategories');
        const skuListEl = document.getElementById('activitySkuList');
        
        // 显示类目和SPU
        const catName = product.leafCat?.catName || '未知类目';
        catNameEl.textContent = `类目: ${catName}`;
        productIdEl.textContent = `SPU: ${product.productId}`;
        
        // 显示categories (字体略小)
        const categoriesText = (product.categories || []).join(' > ');
        categoriesEl.textContent = categoriesText;
        categoriesEl.title = categoriesText;
        
        // 渲染SKU列表 (使用skuData，参考Python代码)
        let skuHtml = '';
        let skuIndex = 0;
        
        // 遍历skuData (从goodsInfo解析得到)
        for (const sku of (product.skuData || [])) {
            const skuId = sku.specId.join('_');
            const specName = sku.specName || 'SKU ' + skuId;
            
            skuHtml += `
                <div class="activity-sku-item" data-sku-id="${skuId}" data-sku-index="${skuIndex}" data-spec-id="${JSON.stringify(sku.specId)}">
                    <div class="activity-sku-header">
                        <span class="activity-sku-size">${specName}</span>
                    </div>
                    <div class="activity-sku-row">
                        <div class="activity-sku-field">
                            <label>活动价格:</label>
                            <input type="text" class="activity-price-input" placeholder="元" data-sku-id="${skuId}">
                        </div>
                        <div class="activity-sku-field">
                            <label>活动库存:</label>
                            <input type="text" class="activity-stock-input" placeholder="数量" data-sku-id="${skuId}">
                        </div>
                    </div>
                    <div class="activity-sku-row">
                        <div class="activity-sku-field">
                            <label>报名活动:</label>
                            <div class="activity-select-dropdown" data-sku-id="${skuId}">
                                <div class="activity-select-trigger">
                                    <input type="checkbox" class="activity-all-checkbox" data-sku-id="${skuId}" checked>
                                    <span class="activity-select-text">全部活动</span>
                                    <span class="activity-select-arrow">▼</span>
                                </div>
                                <div class="activity-select-panel" style="display: none;">
                                    ${renderActivityCheckboxes(activityList, skuId, true)}
                                </div>
                            </div>
                        </div>
                        <button type="button" class="activity-sync-btn" data-sku-id="${skuId}">同步至其他规格</button>
                    </div>
                </div>
            `;
            skuIndex++;
        }
        skuListEl.innerHTML = skuHtml;
        
        // 绑定活动选择事件
        setupActivitySelectEvents();
        
        // 绑定同步按钮事件
        setupActivitySyncEvents();
    }
    
    // 同步至其他规格按钮事件
    function setupActivitySyncEvents() {
        const syncBtns = document.querySelectorAll('.activity-sync-btn');
        syncBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                const sourceSkuId = this.dataset.skuId;
                const sourceItem = document.querySelector(`.activity-sku-item[data-sku-id="${sourceSkuId}"]`);
                if (!sourceItem) return;
                
                // 获取源规格的数据
                const sourcePrice = sourceItem.querySelector('.activity-price-input').value;
                const sourceStock = sourceItem.querySelector('.activity-stock-input').value;
                const sourceAllCheckbox = sourceItem.querySelector('.activity-all-checkbox');
                const isAllActivity = sourceAllCheckbox.checked;
                const sourceActivityCheckboxes = sourceItem.querySelectorAll('.activity-item-checkbox');
                const selectedActivityIds = [];
                sourceActivityCheckboxes.forEach(cb => {
                    if (cb.checked) {
                        selectedActivityIds.push(cb.dataset.activityId);
                    }
                });
                
                // 同步到其他规格
                const allSkuItems = document.querySelectorAll('.activity-sku-item');
                allSkuItems.forEach(item => {
                    if (item.dataset.skuId === sourceSkuId) return; // 跳过源规格
                    
                    // 同步价格和库存
                    item.querySelector('.activity-price-input').value = sourcePrice;
                    item.querySelector('.activity-stock-input').value = sourceStock;
                    
                    // 同步活动选择
                    const targetAllCheckbox = item.querySelector('.activity-all-checkbox');
                    targetAllCheckbox.checked = isAllActivity;
                    
                    const targetActivityCheckboxes = item.querySelectorAll('.activity-item-checkbox');
                    targetActivityCheckboxes.forEach(cb => {
                        if (isAllActivity) {
                            cb.checked = true;
                        } else {
                            cb.checked = selectedActivityIds.includes(cb.dataset.activityId);
                        }
                    });
                    
                    // 更新显示文本
                    const targetSelectText = item.querySelector('.activity-select-text');
                    if (isAllActivity) {
                        targetSelectText.textContent = '全部活动';
                    } else {
                        const checkedCount = item.querySelectorAll('.activity-item-checkbox:checked').length;
                        targetSelectText.textContent = checkedCount + '个活动';
                    }
                });
                
                addLog('[活动] 已同步至其他规格');
            });
        });
    }
    
    // 渲染活动复选框列表
    function renderActivityCheckboxes(activityList, skuId, allChecked) {
        let html = '';
        for (const activity of activityList) {
            const activityId = activity.activityThematicId || activity.activityType;
            const displayName = activity.activityThematicName 
                ? `${activity.activityName} - ${activity.activityThematicName}`
                : activity.activityName;
            
            html += `
                <label class="activity-checkbox-item" title="${displayName}">
                    <input type="checkbox" class="activity-item-checkbox" data-activity-id="${activityId}" data-sku-id="${skuId}" ${allChecked ? 'checked' : ''}>
                    <span class="activity-name">${displayName}</span>
                    <span class="activity-discount">${activity.discountThreshold}折</span>
                </label>
            `;
        }
        return html;
    }
    
    // 绑定活动选择事件
    function setupActivitySelectEvents() {
        // 点击展开/收起活动选择面板
        document.querySelectorAll('.activity-select-trigger').forEach(trigger => {
            trigger.addEventListener('click', function(e) {
                if (e.target.classList.contains('activity-all-checkbox')) return;
                
                const dropdown = this.closest('.activity-select-dropdown');
                const panel = dropdown.querySelector('.activity-select-panel');
                const isOpen = panel.style.display !== 'none';
                
                // 关闭其他打开的面板
                document.querySelectorAll('.activity-select-panel').forEach(p => {
                    p.style.display = 'none';
                });
                
                panel.style.display = isOpen ? 'none' : 'block';
            });
        });
        
        // 全选复选框事件
        document.querySelectorAll('.activity-all-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                const skuId = this.dataset.skuId;
                const dropdown = this.closest('.activity-select-dropdown');
                const itemCheckboxes = dropdown.querySelectorAll('.activity-item-checkbox');
                const textEl = dropdown.querySelector('.activity-select-text');
                
                itemCheckboxes.forEach(cb => cb.checked = this.checked);
                
                if (this.checked) {
                    textEl.textContent = '全部活动';
                } else {
                    textEl.textContent = '0个活动';
                }
            });
        });
        
        // 单个活动复选框事件
        document.querySelectorAll('.activity-item-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                const dropdown = this.closest('.activity-select-dropdown');
                const allCheckbox = dropdown.querySelector('.activity-all-checkbox');
                const itemCheckboxes = dropdown.querySelectorAll('.activity-item-checkbox');
                const textEl = dropdown.querySelector('.activity-select-text');
                
                const checkedCount = dropdown.querySelectorAll('.activity-item-checkbox:checked').length;
                const totalCount = itemCheckboxes.length;
                
                allCheckbox.checked = checkedCount === totalCount;
                
                if (checkedCount === totalCount) {
                    textEl.textContent = '全部活动';
                } else {
                    textEl.textContent = `${checkedCount}个活动`;
                }
            });
        });
        
        // 库存输入框只允许数字
        document.querySelectorAll('.activity-stock-input').forEach(input => {
            input.addEventListener('input', function() {
                this.value = this.value.replace(/[^\d]/g, '');
            });
        });
        
        // 价格输入框只允许数字和小数点
        document.querySelectorAll('.activity-price-input').forEach(input => {
            input.addEventListener('input', function() {
                this.value = this.value.replace(/[^\d.]/g, '');
                // 只保留一个小数点
                const parts = this.value.split('.');
                if (parts.length > 2) {
                    this.value = parts[0] + '.' + parts.slice(1).join('');
                }
            });
        });
        
        // 点击其他地方关闭活动选择面板
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.activity-select-dropdown')) {
                document.querySelectorAll('.activity-select-panel').forEach(p => {
                    p.style.display = 'none';
                });
            }
        });
    }
    
    // 收集SKU配置数据 (价格元转分)
    function collectActivitySkuData() {
        const skuItems = document.querySelectorAll('.activity-sku-item');
        const skuData = [];
        
        skuItems.forEach(item => {
            const specName = item.querySelector('.activity-sku-size').textContent;
            const priceInput = item.querySelector('.activity-price-input');
            const stockInput = item.querySelector('.activity-stock-input');
            const dropdown = item.querySelector('.activity-select-dropdown');
            const allCheckbox = dropdown.querySelector('.activity-all-checkbox');
            const itemCheckboxes = dropdown.querySelectorAll('.activity-item-checkbox:checked');
            
            // 从dataset中获取specId数组
            let specId = [];
            try {
                specId = JSON.parse(item.dataset.specId || '[]');
            } catch (e) {
                specId = [parseInt(item.dataset.skuId)];
            }
            
            const priceYuan = parseFloat(priceInput.value);
            const stock = parseInt(stockInput.value);
            
            if (!isNaN(priceYuan) && priceYuan > 0) {
                // 收集选中的活动ID
                const selectedActivityIds = [];
                itemCheckboxes.forEach(cb => {
                    selectedActivityIds.push(cb.dataset.activityId);
                });
                
                skuData.push({
                    specId: specId,
                    specName: specName,
                    activityPrice: Math.round(priceYuan * 100), // 元转分
                    activityStock: isNaN(stock) ? 0 : stock,
                    all_activity: allCheckbox.checked,
                    all_activity_ids: allCheckbox.checked ? currentActivityTemplate.allActivityIds : selectedActivityIds
                });
            }
        });
        
        return skuData;
    }
    
    // 加载已保存的活动模板
    async function loadSavedActivityTemplates(expandIndex = -1) {
        const templatesList = document.getElementById('activityTemplatesList');
        if (!templatesList) return;
        
        const stored = await chrome.storage.local.get('activityTemplateList');
        const savedList = stored.activityTemplateList || [];
        
        if (savedList.length === 0) {
            templatesList.innerHTML = '<div class="no-templates">暂无保存的模板</div>';
            return;
        }
        
        let html = '';
        for (let i = 0; i < savedList.length; i++) {
            const template = savedList[i];
            const skuData = template.skuData || [];
            const isExpanded = i === expandIndex;
            const categoriesText = (template.categories || []).join(' > ');
            
            // 计算活动选择显示文本
            const firstSku = skuData[0];
            const activityText = firstSku?.all_activity ? '全部活动' : 
                (firstSku?.all_activity_ids?.length || 0) + '个活动';
            
            html += `
                <div class="activity-template-item" data-index="${i}">
                    <div class="activity-template-header">
                        <div class="activity-template-header-left">
                            <span class="activity-template-expand-icon">${isExpanded ? '▼' : '▶'}</span>
                            <span class="activity-template-cat">类目: ${template.catName || 'SPU ' + template.spuId}</span>
                        </div>
                        <div class="activity-template-actions">
                            <button class="activity-template-edit-btn" data-index="${i}">编辑</button>
                            <button class="activity-template-delete-btn" data-index="${i}">删除</button>
                        </div>
                    </div>
                    <div class="activity-template-content" style="display: ${isExpanded ? 'block' : 'none'};">
                        <div class="activity-template-info">
                            <span class="activity-template-spu">SPU: ${template.spuId}</span>
                            <span class="activity-template-categories" title="${categoriesText}">${categoriesText}</span>
                        </div>
                        <div class="activity-template-sku-grid">`;
            
            for (const sku of skuData) {
                const priceYuan = (sku.activityPrice / 100).toFixed(2);
                const skuActivityText = sku.all_activity ? '全部活动' : 
                    (sku.all_activity_ids?.length || 0) + '个活动';
                
                html += `
                    <div class="activity-template-sku-item">
                        <span class="sku-spec">${sku.specName}</span>
                        <span class="sku-price">价格: ${priceYuan}元</span>
                        <span class="sku-stock">库存: ${sku.activityStock}</span>
                        <span class="sku-activity">活动: ${skuActivityText}</span>
                    </div>
                `;
            }
            
            html += `
                        </div>
                    </div>
                </div>
            `;
        }
        
        templatesList.innerHTML = html;
        setupActivityTemplateEvents();
    }
    
    // 活动模板事件设置
    function setupActivityTemplateEvents() {
        const templatesList = document.getElementById('activityTemplatesList');
        if (!templatesList) return;
        
        // 展开/折叠
        templatesList.querySelectorAll('.activity-template-header').forEach(header => {
            header.addEventListener('click', function(e) {
                if (e.target.classList.contains('activity-template-edit-btn') || 
                    e.target.classList.contains('activity-template-delete-btn')) return;
                
                const item = this.closest('.activity-template-item');
                const content = item.querySelector('.activity-template-content');
                const icon = item.querySelector('.activity-template-expand-icon');
                
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    icon.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    icon.textContent = '▶';
                }
            });
        });
        
        // 编辑按钮
        templatesList.querySelectorAll('.activity-template-edit-btn').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                const index = parseInt(this.dataset.index);
                await editActivityTemplate(index);
            });
        });
        
        // 删除按钮
        templatesList.querySelectorAll('.activity-template-delete-btn').forEach(btn => {
            btn.addEventListener('click', async function(e) {
                e.stopPropagation();
                if (!confirm('确定删除此模板？')) return;
                
                const index = parseInt(this.dataset.index);
                const stored = await chrome.storage.local.get('activityTemplateList');
                const savedList = stored.activityTemplateList || [];
                savedList.splice(index, 1);
                
                chrome.storage.local.set({ activityTemplateList: savedList }, function() {
                    addLog('[活动] 模板已删除');
                    loadSavedActivityTemplates();
                });
            });
        });
    }
    
    // 编辑活动模板 (新布局: 每个规格独立活动选择)
    async function editActivityTemplate(index) {
        const stored = await chrome.storage.local.get('activityTemplateList');
        const savedList = stored.activityTemplateList || [];
        const template = savedList[index];
        
        if (!template) return;
        
        const resultContainer = document.getElementById('activityResultContainer');
        const skuListEl = document.getElementById('activitySkuList');
        const catNameEl = document.getElementById('activityCatName');
        const productIdEl = document.getElementById('activityProductId');
        const categoriesEl = document.getElementById('activityCategories');
        
        // 显示类目和SPU
        catNameEl.textContent = `类目: ${template.catName || '未知类目'} (编辑中)`;
        productIdEl.textContent = `SPU: ${template.spuId}`;
        
        // 显示categories
        const categoriesText = (template.categories || []).join(' > ');
        categoriesEl.textContent = categoriesText;
        categoriesEl.title = categoriesText;
        
        // 获取最新活动列表
        let activityList = [];
        let allActivityIds = [];
        if (mallidCookie && sellerTempCookie) {
            const activityResult = await ActivityService.queryAllActivities(
                mallidCookie.value,
                sellerTempCookie.value
            );
            
            if (activityResult.success) {
                activityList = activityResult.data;
                allActivityIds = activityResult.allActivityIds;
            }
        }
        
        // 渲染SKU编辑表单 (每个规格独立活动选择)
        let skuHtml = '';
        let skuIndex = 0;
        for (const sku of (template.skuData || [])) {
            const skuId = (sku.specId || []).join('_');
            const priceYuan = (sku.activityPrice / 100).toFixed(2);
            const isAllActivity = sku.all_activity !== false;
            const selectedIds = sku.all_activity_ids || [];
            const activityText = isAllActivity ? '全部活动' : selectedIds.length + '个活动';
            
            skuHtml += `
                <div class="activity-sku-item" data-sku-id="${skuId}" data-sku-index="${skuIndex}" data-spec-id="${JSON.stringify(sku.specId || [])}">
                    <div class="activity-sku-header">
                        <span class="activity-sku-size">${sku.specName}</span>
                    </div>
                    <div class="activity-sku-row">
                        <div class="activity-sku-field">
                            <label>活动价格:</label>
                            <input type="text" class="activity-price-input" placeholder="元" value="${priceYuan}" data-sku-id="${skuId}">
                        </div>
                        <div class="activity-sku-field">
                            <label>活动库存:</label>
                            <input type="text" class="activity-stock-input" placeholder="数量" value="${sku.activityStock || ''}" data-sku-id="${skuId}">
                        </div>
                    </div>
                    <div class="activity-sku-row">
                        <div class="activity-sku-field">
                            <label>报名活动:</label>
                            <div class="activity-select-dropdown" data-sku-id="${skuId}">
                                <div class="activity-select-trigger">
                                    <input type="checkbox" class="activity-all-checkbox" data-sku-id="${skuId}" ${isAllActivity ? 'checked' : ''}>
                                    <span class="activity-select-text">${activityText}</span>
                                    <span class="activity-select-arrow">▼</span>
                                </div>
                                <div class="activity-select-panel" style="display: none;">
                                    ${renderActivityCheckboxesForEdit(activityList, skuId, isAllActivity, selectedIds)}
                                </div>
                            </div>
                        </div>
                        <button type="button" class="activity-sync-btn" data-sku-id="${skuId}">同步至其他规格</button>
                    </div>
                </div>
            `;
            skuIndex++;
        }
        skuListEl.innerHTML = skuHtml;
        
        // 绑定活动选择事件
        setupActivitySelectEvents();
        
        // 绑定同步按钮事件
        setupActivitySyncEvents();
        
        currentActivityTemplate = {
            spuId: template.spuId,
            products: [{ 
                productId: template.spuId, 
                leafCat: { catId: template.catId, catName: template.catName },
                categories: template.categories 
            }],
            allActivityIds: allActivityIds,
            activityList: activityList,
            editIndex: index
        };
        
        resultContainer.style.display = 'block';
        
        // 修改保存按钮行为
        const saveBtn = document.getElementById('activitySaveBtn');
        saveBtn.textContent = '更新模板';
        
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        
        newSaveBtn.addEventListener('click', async function() {
            const skuData = collectActivitySkuData();
            if (!skuData || skuData.length === 0) {
                addLog('[活动] 请填写活动价格和库存');
                return;
            }
            
            template.skuData = skuData;
            template.savedAt = Date.now();
            
            savedList[index] = template;
            
            chrome.storage.local.set({ activityTemplateList: savedList }, function() {
                addLog('[活动] 模板已更新');
                resultContainer.style.display = 'none';
                loadSavedActivityTemplates(index);
                
                // 恢复保存按钮
                newSaveBtn.textContent = '保存模板';
            });
        });
    }
    
    // 渲染编辑时的活动复选框列表
    function renderActivityCheckboxesForEdit(activityList, skuId, isAllActivity, selectedIds) {
        let html = '';
        for (const activity of activityList) {
            const activityId = activity.activityThematicId || activity.activityType;
            const displayName = activity.activityThematicName 
                ? `${activity.activityName} - ${activity.activityThematicName}`
                : activity.activityName;
            
            // 如果是全选则全部勾选，否则检查是否在选中列表中
            const isChecked = isAllActivity || selectedIds.includes(String(activityId)) || selectedIds.includes(activityId);
            
            html += `
                <label class="activity-checkbox-item" title="${displayName}">
                    <input type="checkbox" class="activity-item-checkbox" data-activity-id="${activityId}" data-sku-id="${skuId}" ${isChecked ? 'checked' : ''}>
                    <span class="activity-name">${displayName}</span>
                    <span class="activity-discount">${activity.discountThreshold}折</span>
                </label>
            `;
        }
        return html;
    }
    
    // 自动活动配置事件设置
    let autoActivityInterval = null;
    let autoActivityRunning = false;
    let autoActivityEventsInitialized = false;
    
    function setupAutoActivityEvents() {
        // 防止重复初始化
        if (autoActivityEventsInitialized) return;
        autoActivityEventsInitialized = true;
        
        const intervalSelect = document.getElementById('autoActivityInterval');
        const nowBtn = document.getElementById('autoActivityNowBtn');
        const scheduleBtn = document.getElementById('autoActivityScheduleBtn');
        const infoEl = document.getElementById('autoActivityInfo');
        
        if (!intervalSelect || !nowBtn || !scheduleBtn || !infoEl) return;
        
        // 设置ActivityService的回调
        ActivityService.setLogCallback((message) => {
            addLog(message);
        });
        
        ActivityService.setProgressCallback((percent, message) => {
            updateAutoActivityProgress(nowBtn, percent, message);
        });
        
        // 从缓存加载配置
        chrome.storage.local.get('autoActivityConfig', function(result) {
            const config = result.autoActivityConfig || {};
            if (config.interval) {
                intervalSelect.value = config.interval;
            }
            if (config.enabled) {
                startAutoActivitySchedule();
            }
        });
        
        // 立即报名按钮
        nowBtn.addEventListener('click', async function() {
            if (autoActivityRunning) return;
            
            if (!mallidCookie || !sellerTempCookie) {
                addLog('[活动] Cookie不可用');
                return;
            }
            
            await executeAutoActivity();
        });
        
        // 定时报名按钮
        scheduleBtn.addEventListener('click', function() {
            const interval = parseInt(intervalSelect.value);
            
            if (interval === 0) {
                addLog('[活动] 请先选择定时间隔');
                return;
            }
            
            if (autoActivityInterval) {
                stopAutoActivitySchedule();
            } else {
                startAutoActivitySchedule();
            }
        });
        
        // 间隔选择改变
        intervalSelect.addEventListener('change', function() {
            const interval = parseInt(this.value);
            chrome.storage.local.set({ 
                autoActivityConfig: { 
                    interval: interval,
                    enabled: autoActivityInterval !== null
                }
            });
            
            if (autoActivityInterval && interval > 0) {
                stopAutoActivitySchedule();
                startAutoActivitySchedule();
            }
        });
    }
    
    // 执行自动活动报名
    async function executeAutoActivity() {
        if (autoActivityRunning) return;
        
        autoActivityRunning = true;
        const nowBtn = document.getElementById('autoActivityNowBtn');
        const infoEl = document.getElementById('autoActivityInfo');
        
        nowBtn.classList.add('running');
        updateAutoActivityProgress(nowBtn, 0, '准备中...');
        
        try {
            const mallid = mallidCookie.value;
            const sellerTemp = sellerTempCookie.value;
            
            const cachedCookies = await chrome.storage.local.get('cachedCookies');
            const shopName = cachedCookies.cachedCookies?.shopName || '未知店铺';
            
            const result = await ActivityService.executeActivityTask(mallid, sellerTemp, shopName);
            
            if (result.success && result.logs && result.logs.length > 0) {
                downloadActivityLog(shopName, result.logs);
            }
            
            updateAutoActivityProgress(nowBtn, 100, '完成');
            infoEl.textContent = `最后执行: ${new Date().toLocaleTimeString()}`;
            
            // 清除活动模板的new标签
            await clearActivityTemplatesNewTag();
        } catch (e) {
            addLog(`[活动] 执行失败: ${e.message}`);
            updateAutoActivityProgress(nowBtn, 0, '失败');
        } finally {
            autoActivityRunning = false;
            nowBtn.classList.remove('running');
            setTimeout(() => {
                updateAutoActivityProgress(nowBtn, 0, '');
            }, 2000);
        }
    }
    
    // 清除活动模板的new标签
    async function clearActivityTemplatesNewTag() {
        const stored = await chrome.storage.local.get('activityTemplateList');
        const list = stored.activityTemplateList || [];
        let hasNew = false;
        list.forEach(t => {
            if (t.isNew) {
                t.isNew = false;
                hasNew = true;
            }
        });
        if (hasNew) {
            await chrome.storage.local.set({ activityTemplateList: list });
            loadSavedActivityTemplates();
        }
    }
    
    // 启动定时活动报名
    function startAutoActivitySchedule() {
        const intervalSelect = document.getElementById('autoActivityInterval');
        const scheduleBtn = document.getElementById('autoActivityScheduleBtn');
        const infoEl = document.getElementById('autoActivityInfo');
        
        const interval = parseInt(intervalSelect.value);
        
        if (interval === 0) {
            addLog('[活动] 请先选择定时间隔');
            return;
        }
        
        scheduleBtn.classList.add('active');
        scheduleBtn.querySelector('.auto-activity-btn-text').textContent = '停止定时';
        
        autoActivityInterval = setInterval(async () => {
            if (!autoActivityRunning && mallidCookie && sellerTempCookie) {
                await executeAutoActivity();
            }
        }, interval);
        
        chrome.storage.local.set({ 
            autoActivityConfig: { 
                interval: interval,
                enabled: true
            }
        });
        
        addLog(`[活动] 定时报名已启动，间隔: ${getIntervalText(interval)}`);
        infoEl.textContent = `定时间隔: ${getIntervalText(interval)}`;
    }
    
    // 停止定时活动报名
    function stopAutoActivitySchedule() {
        const scheduleBtn = document.getElementById('autoActivityScheduleBtn');
        const infoEl = document.getElementById('autoActivityInfo');
        
        if (autoActivityInterval) {
            clearInterval(autoActivityInterval);
            autoActivityInterval = null;
        }
        
        scheduleBtn.classList.remove('active');
        scheduleBtn.querySelector('.auto-activity-btn-text').textContent = '启动定时';
        
        chrome.storage.local.set({ 
            autoActivityConfig: { 
                interval: parseInt(document.getElementById('autoActivityInterval').value),
                enabled: false
            }
        });
        
        addLog('[活动] 定时报名已停止');
        infoEl.textContent = '';
    }
    
    // 更新活动进度
    function updateAutoActivityProgress(btnEl, percent, message) {
        if (!btnEl) return;
        
        const progressBar = btnEl.querySelector('.auto-activity-btn-progress');
        const textEl = btnEl.querySelector('.auto-activity-btn-text');
        
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
        
        if (textEl && message) {
            textEl.textContent = message;
        } else if (textEl && !message) {
            textEl.textContent = '立即报名';
        }
    }
    
    // 下载活动日志
    function downloadActivityLog(shopName, logs) {
        if (!logs || logs.length === 0) return;
        
        const now = new Date();
        const dateTimeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const filename = `${shopName}_${dateTimeStr}活动报名日志.log`;
        
        const logContent = logs.join('\n');
        const blob = new Blob(['\ufeff' + logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        
        addLog(`[活动] 日志已导出: ${filename}`);
    }
    
    function generateAdvertisingConfigCard() {
        advertisingConfigCard.innerHTML = `
            <div class="ad-config-container">
                <div class="ad-cookie-status" id="adCookieStatus">
                    <span class="ad-cookie-status-text">auth_token: <span id="adCookieStatusValue">未获取</span></span>
                </div>
                <div class="ad-config-section">
                    <div class="ad-config-row">
                        <label class="ad-config-label">全店ROAS:</label>
                        <input type="text" class="ad-roas-input" id="adRoasInput" value="7.0" maxlength="4" disabled>
                    </div>
                    <div class="ad-config-row">
                        <label class="ad-config-label">定时开通:</label>
                        <select class="ad-interval-select" id="adIntervalSelect" disabled>
                            <option value="0">未开启</option>
                            <option value="60000">1分钟</option>
                            <option value="3600000">1小时</option>
                            <option value="10800000">3小时</option>
                            <option value="21600000">6小时</option>
                        </select>
                    </div>
                    <div class="ad-config-buttons">
                        <button class="ad-config-btn" id="adNowBtn" disabled>
                            <span class="ad-config-btn-text">立即开通</span>
                            <div class="ad-config-btn-progress" style="width: 0%;"></div>
                        </button>
                        <button class="ad-config-btn" id="adScheduleBtn" disabled>
                            <span class="ad-config-btn-text">启动定时</span>
                            <div class="ad-config-btn-progress" style="width: 0%;"></div>
                        </button>
                    </div>
                    <div class="ad-config-info" id="adConfigInfo"></div>
                </div>
            </div>
        `;
        autoAdEventsInitialized = false;
        setupAdConfigEvents();
    }
    
    // 广告配置事件设置
    let autoAdInterval = null;
    let autoAdRunning = false;
    let autoAdEventsInitialized = false;
    
    function setupAdConfigEvents() {
        if (autoAdEventsInitialized) return;
        autoAdEventsInitialized = true;
        
        const adCookieStatusValue = document.getElementById('adCookieStatusValue');
        const roasInput = document.getElementById('adRoasInput');
        const intervalSelect = document.getElementById('adIntervalSelect');
        const nowBtn = document.getElementById('adNowBtn');
        const scheduleBtn = document.getElementById('adScheduleBtn');
        const infoEl = document.getElementById('adConfigInfo');
        
        if (!roasInput || !intervalSelect || !nowBtn || !scheduleBtn || !infoEl) return;
        
        // 设置AdService的回调
        AdService.setLogCallback((message) => {
            addLog(message);
        });
        
        AdService.setProgressCallback((percent, message) => {
            updateAdProgress(nowBtn, percent, message);
        });
        
        // 限制ROAS输入框只能输入数字和小数点
        roasInput.addEventListener('input', function(e) {
            let value = e.target.value;
            value = value.replace(/[^0-9.]/g, '');
            const parts = value.split('.');
            if (parts.length > 2) {
                value = parts[0] + '.' + parts.slice(1).join('');
            }
            if (value.length > 4) {
                value = value.substring(0, 4);
            }
            e.target.value = value;
        });
        
        // 检查并更新Cookie状态和倒计时
        async function updateAdCookieStatus() {
            const stored = await chrome.storage.local.get(['adCookies', 'adCookiesTimestamp']);
            const adCookies = stored.adCookies || {};
            const timestamp = stored.adCookiesTimestamp || 0;
            const hasAuthToken = !!adCookies.auth_token;
            
            if (hasAuthToken && timestamp) {
                // Cookie过期时间：24小时
                const expiryTime = timestamp + (24 * 60 * 60 * 1000);
                const remaining = expiryTime - Date.now();
                
                if (remaining > 0) {
                    const hours = Math.floor(remaining / (60 * 60 * 1000));
                    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
                    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
                    
                    adCookieStatusValue.textContent = `${hours}小时${minutes}分${seconds}秒`;
                    adCookieStatusValue.style.color = '#4CAF50';
                    roasInput.disabled = false;
                    intervalSelect.disabled = false;
                    nowBtn.disabled = false;
                    scheduleBtn.disabled = false;
                } else {
                    adCookieStatusValue.textContent = '已过期';
                    adCookieStatusValue.style.color = '#ff9800';
                    roasInput.disabled = true;
                    intervalSelect.disabled = true;
                    nowBtn.disabled = true;
                    scheduleBtn.disabled = true;
                }
            } else {
                adCookieStatusValue.textContent = '未获取';
                adCookieStatusValue.style.color = '#f44336';
                roasInput.disabled = true;
                intervalSelect.disabled = true;
                nowBtn.disabled = true;
                scheduleBtn.disabled = true;
            }
        }
        
        updateAdCookieStatus();
        
        // 每秒更新倒计时
        setInterval(updateAdCookieStatus, 1000);
        
        // 从缓存加载ROAS配置
        chrome.storage.local.get('adRoasConfig', function(result) {
            const config = result.adRoasConfig || {};
            if (config.roas) {
                roasInput.value = config.roas;
            }
            if (config.interval) {
                intervalSelect.value = config.interval;
            }
            if (config.enabled) {
                startAutoAdSchedule();
            }
        });
        
        // 保存ROAS配置
        roasInput.addEventListener('change', function() {
            chrome.storage.local.get('adRoasConfig', function(result) {
                const config = result.adRoasConfig || {};
                config.roas = roasInput.value;
                chrome.storage.local.set({ adRoasConfig: config });
            });
        });
        
        // 立即开通按钮
        nowBtn.addEventListener('click', async function() {
            if (autoAdRunning) return;
            
            if (!mallidCookie || !sellerTempCookie) {
                addLog('[广告] Cookie不可用');
                return;
            }
            
            const roas = roasInput.value.trim();
            if (!roas) {
                addLog('[广告] 请输入ROAS值');
                return;
            }
            
            await executeAutoAd();
        });
        
        // 定时开通按钮
        scheduleBtn.addEventListener('click', function() {
            const interval = parseInt(intervalSelect.value);
            
            if (interval === 0) {
                addLog('[广告] 请先选择定时间隔');
                return;
            }
            
            if (autoAdInterval) {
                stopAutoAdSchedule();
            } else {
                chrome.storage.local.get('adRoasConfig', function(result) {
                    const config = result.adRoasConfig || {};
                    config.interval = interval;
                    config.enabled = true;
                    chrome.storage.local.set({ adRoasConfig: config });
                });
                startAutoAdSchedule();
            }
        });
        
        // 定时间隔改变
        intervalSelect.addEventListener('change', function() {
            if (autoAdInterval) {
                stopAutoAdSchedule();
                chrome.storage.local.get('adRoasConfig', function(result) {
                    const config = result.adRoasConfig || {};
                    config.interval = parseInt(intervalSelect.value);
                    config.enabled = false;
                    chrome.storage.local.set({ adRoasConfig: config });
                });
            }
        });
    }
    
    // 执行自动广告开通
    async function executeAutoAd() {
        if (autoAdRunning) return;
        
        autoAdRunning = true;
        const nowBtn = document.getElementById('adNowBtn');
        const infoEl = document.getElementById('adConfigInfo');
        
        nowBtn.classList.add('running');
        updateAdProgress(nowBtn, 0, '准备中...');
        
        try {
            const mallid = mallidCookie.value;
            const sellerTemp = sellerTempCookie.value;
            const roasInput = document.getElementById('adRoasInput');
            const roas = roasInput.value.trim();
            
            const cachedCookies = await chrome.storage.local.get(['cachedCookies', 'adCookies']);
            const shopName = cachedCookies.cachedCookies?.shopName || '未知店铺';
            const adCookies = cachedCookies.adCookies || {};
            
            const result = await AdService.executeAdTask(adCookies, roas, shopName);
            
            if (result.success && result.logs && result.logs.length > 0) {
                downloadAdLog(shopName, result.logs);
            }
            
            updateAdProgress(nowBtn, 100, '完成');
            infoEl.textContent = `最后执行: ${new Date().toLocaleTimeString()}`;
        } catch (e) {
            addLog(`[广告] 执行失败: ${e.message}`);
            updateAdProgress(nowBtn, 0, '失败');
        } finally {
            autoAdRunning = false;
            nowBtn.classList.remove('running');
            setTimeout(() => {
                updateAdProgress(nowBtn, 0, '');
            }, 2000);
        }
    }
    
    // 启动自动广告定时任务
    function startAutoAdSchedule() {
        const intervalSelect = document.getElementById('adIntervalSelect');
        const scheduleBtn = document.getElementById('adScheduleBtn');
        const infoEl = document.getElementById('adConfigInfo');
        
        if (!intervalSelect || !scheduleBtn || !infoEl) return;
        
        const interval = parseInt(intervalSelect.value);
        if (interval === 0) return;
        
        autoAdInterval = setInterval(async () => {
            if (!autoAdRunning) {
                await executeAutoAd();
            }
        }, interval);
        
        scheduleBtn.textContent = '停止定时';
        scheduleBtn.classList.add('active');
        infoEl.textContent = `定时任务已启动 (每${interval / 60000}分钟)`;
        addLog(`[广告] 定时任务已启动，间隔: ${interval / 60000}分钟`);
    }
    
    // 停止自动广告定时任务
    function stopAutoAdSchedule() {
        if (autoAdInterval) {
            clearInterval(autoAdInterval);
            autoAdInterval = null;
        }
        
        const scheduleBtn = document.getElementById('adScheduleBtn');
        const infoEl = document.getElementById('adConfigInfo');
        
        if (scheduleBtn) {
            scheduleBtn.textContent = '启动定时';
            scheduleBtn.classList.remove('active');
        }
        
        if (infoEl) {
            infoEl.textContent = '定时任务已停止';
        }
        
        chrome.storage.local.get('adRoasConfig', function(result) {
            const config = result.adRoasConfig || {};
            config.enabled = false;
            chrome.storage.local.set({ adRoasConfig: config });
        });
        
        addLog('[广告] 定时任务已停止');
    }
    
    // 更新广告进度
    function updateAdProgress(button, percent, message) {
        if (!button) return;
        
        const progressEl = button.querySelector('.ad-config-btn-progress');
        const textEl = button.querySelector('.ad-config-btn-text');
        
        if (progressEl) {
            progressEl.style.width = percent + '%';
        }
        
        if (textEl && message) {
            textEl.textContent = message;
        } else if (textEl && !message) {
            textEl.textContent = '立即开通';
        }
    }
    
    // 下载广告日志
    function downloadAdLog(shopName, logs) {
        if (!logs || logs.length === 0) return;
        
        const now = new Date();
        const dateTimeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const filename = `${shopName}_${dateTimeStr}广告日志.log`;
        
        const logContent = logs.join('\n');
        const blob = new Blob(['\ufeff' + logContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        
        addLog(`[广告] 日志已导出: ${filename}`);
    }
    
    // 渲染 Cookie 列表
    function renderCookies(cookies) {
        currentCookies = cookies;
        
        if (cookies.length === 0) {
            shopNameDisplay.textContent = '未找到 Cookie 或域名不匹配';
            return;
        }
        
        mallidCookie = cookies.find(cookie => cookie.name === 'mallid') || null;
        sellerTempCookie = cookies.find(cookie => cookie.name === 'seller_temp') || null;
        
        renderCookiesInfo();
        getShopName();
    }
    
    // 自动获取当前标签页的 Cookie
    async function autoGetCookies() {
        const currentUrl = await getCurrentTabUrl();
        if (currentUrl) {
            const cookies = await getCookiesForUrl(currentUrl);
            renderCookies(cookies);
        }
    }
    
    autoGetCookies();
});
