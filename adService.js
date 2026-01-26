const AdService = {
    AD_BASE_URL: "https://ads.temu.com/api/v1/coconut/ad",
    
    logCallback: null,
    progressCallback: null,
    adLogs: [],
    
    setLogCallback(callback) {
        this.logCallback = callback;
    },
    
    setProgressCallback(callback) {
        this.progressCallback = callback;
    },
    
    addLog(message) {
        if (this.logCallback) {
            this.logCallback(message);
        }
    },
    
    updateProgress(current, total, message = '') {
        if (this.progressCallback) {
            const percent = total > 0 ? (current / total) * 100 : 0;
            this.progressCallback(percent, message);
        }
    },
    
    getHeaders() {
        return {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json;charset=UTF-8",
            "user-agent": navigator.userAgent
        };
    },
    
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },
    
    async requestWithRetry(url, headers, body, maxRetries = 3) {
        let lastError = null;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: body,
                    credentials: 'include'
                });
                
                const data = await response.json();
                if (data.success) {
                    return data;
                }
                lastError = data.error_msg || data.errorMsg || '请求失败';
            } catch (e) {
                lastError = e.message;
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        if (lastError) {
            this.addLog(`[广告] 请求失败（重试${maxRetries}次后）: ${lastError}`);
        }
        return null;
    },
    
    async fetchGoodsPage(url, headers, page, pageSize, listId) {
        const payload = {
            page_number: page,
            page_size: pageSize,
            is_gray: true,
            list_id: listId
        };
        
        const responseData = await this.requestWithRetry(url, headers, JSON.stringify(payload));
        
        if (responseData) {
            const goodsInfoList = responseData.result?.goods_info_list || [];
            if (goodsInfoList.length > 0) {
                const filteredGoods = goodsInfoList
                    .filter(goods => {
                        if (!goods.goods_id) return false;
                        const grayReason = goods.gray_reason;
                        if (!grayReason || grayReason.length === 0) return true;
                        const type = grayReason[0]?.type || 0;
                        return type !== 2 && type !== 3;
                    })
                    .map(goods => goods.goods_id);
                return filteredGoods;
            }
        }
        return [];
    },
    
    async createAdsBatch(url, headers, goodsIdList, roas) {
        const reqsData = {
            create_ad_reqs: goodsIdList.map(goodsId => ({
                goods_id: goodsId,
                roas: roas,
                budget: -1
            }))
        };
        
        const responseData = await this.requestWithRetry(url, headers, JSON.stringify(reqsData));
        
        const batchFailMap = {};
        let batchSuccessCount = 0;
        
        if (responseData) {
            const failMap = responseData.result?.create_goods_fail_map || {};
            batchSuccessCount = responseData.result?.success_create_product_num || 0;
            
            for (const reason of Object.values(failMap)) {
                batchFailMap[reason] = (batchFailMap[reason] || 0) + 1;
            }
        }
        
        return { batchFailMap, batchSuccessCount };
    },
    
    async executeAdTask(adCookies, roas, shopName) {
        this.adLogs = [];
        
        try {
            if (!adCookies || !adCookies.auth_token) {
                this.addLog('[广告] 缺少广告Cookie，请先获取广告Cookie');
                return { success: false, message: '缺少广告Cookie' };
            }
            
            const roasValue = Math.floor(parseFloat(roas) * 10000);
            if (isNaN(roasValue) || roasValue <= 0) {
                this.addLog('[广告] ROAS值无效');
                return { success: false, message: 'ROAS值无效' };
            }
            
            this.addLog('[广告] 开始执行广告开通任务...');
            this.addLog(`[广告] ROAS设置: ${roas} (${roasValue})`);
            this.updateProgress(0, 100, '准备中...');
            
            const listId = this.generateUUID();
            const queryUrl = `${this.AD_BASE_URL}/query_mall_goods_list`;
            const createUrl = `${this.AD_BASE_URL}/create_ads/create`;
            
            const headers = this.getHeaders();
            const cookieString = Object.entries(adCookies)
                .map(([key, value]) => `${key}=${value}`)
                .join('; ');
            headers["cookie"] = cookieString;
            
            this.addLog('[广告] 查询商品总数...');
            const initialData = {
                page_number: 1,
                page_size: 1,
                is_gray: true,
                list_id: listId
            };
            
            const initialResponse = await this.requestWithRetry(queryUrl, headers, JSON.stringify(initialData));
            if (!initialResponse) {
                this.addLog('[广告] 获取商品总数失败');
                return { success: false, message: '获取商品总数失败' };
            }
            
            const total = initialResponse.total || 0;
            this.addLog(`[广告] 当前店铺有 ${total} 个商品`);
            
            const pageCount = Math.floor(total / 100 * 1.2);
            this.addLog(`[广告] 开始获取 ${pageCount} 页商品数据...`);
            
            let goodsIdList = [];
            const adCreationPromises = [];
            const failCountMap = {};
            let successCount = 0;
            let processedPages = 0;
            
            const batchSize = 50;
            const concurrentPages = 20;
            
            for (let startPage = 1; startPage <= pageCount; startPage += concurrentPages) {
                const endPage = Math.min(startPage + concurrentPages - 1, pageCount);
                const pagePromises = [];
                
                for (let page = startPage; page <= endPage; page++) {
                    pagePromises.push(
                        this.fetchGoodsPage(queryUrl, headers, page, 100, listId)
                    );
                }
                
                const pageResults = await Promise.all(pagePromises);
                
                for (const pageGoods of pageResults) {
                    if (pageGoods && pageGoods.length > 0) {
                        goodsIdList = goodsIdList.concat(pageGoods);
                    }
                    
                    while (goodsIdList.length >= batchSize) {
                        const batchGoods = goodsIdList.slice(0, batchSize);
                        goodsIdList = goodsIdList.slice(batchSize);
                        
                        const createPromise = this.createAdsBatch(createUrl, headers, batchGoods, roasValue)
                            .then(result => {
                                successCount += result.batchSuccessCount;
                                for (const [reason, count] of Object.entries(result.batchFailMap)) {
                                    failCountMap[reason] = (failCountMap[reason] || 0) + count;
                                }
                            });
                        adCreationPromises.push(createPromise);
                    }
                    
                    processedPages++;
                    this.updateProgress(processedPages, pageCount, `已处理 ${processedPages}/${pageCount} 页`);
                }
            }
            
            if (goodsIdList.length > 0) {
                this.addLog(`[广告] 处理最后一批商品，数量: ${goodsIdList.length}`);
                const result = await this.createAdsBatch(createUrl, headers, goodsIdList, roasValue);
                successCount += result.batchSuccessCount;
                for (const [reason, count] of Object.entries(result.batchFailMap)) {
                    failCountMap[reason] = (failCountMap[reason] || 0) + count;
                }
            }
            
            this.addLog('[广告] 等待所有广告创建任务完成...');
            await Promise.all(adCreationPromises);
            
            this.adLogs.push(`失败结果统计: ${JSON.stringify(failCountMap)}`);
            this.adLogs.push(`成功开通广告 ${successCount} 个`);
            
            this.addLog(`[广告] 任务完成，成功: ${successCount}`);
            if (Object.keys(failCountMap).length > 0) {
                this.addLog(`[广告] 失败统计: ${JSON.stringify(failCountMap)}`);
            }
            this.updateProgress(100, 100, '完成');
            
            return {
                success: true,
                successCount,
                failCountMap,
                logs: this.adLogs
            };
        } catch (e) {
            this.addLog(`[广告] 任务失败: ${e.message}`);
            this.updateProgress(0, 100, '失败');
            return { success: false, message: e.message, logs: this.adLogs };
        }
    }
};
