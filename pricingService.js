const PricingService = {
    PAGE_SIZE: 100,
    MAX_RETRIES: 3,
    RETRY_DELAY_BASE: 500,
    REQUEST_TIMEOUT: 30000,
    
    PRICE_SEARCH_URL: "https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier",
    PRICE_REVIEW_BATCH_URL: "https://agentseller.temu.com/api/kiana/mms/gmp/bg/magneto/api/price/re-price-review/click",
    
    logCallback: null,
    progressCallback: null,
    pricingLogs: [],
    
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
        console.log(message);
    },
    
    updateProgress(current, total, message = '') {
        if (this.progressCallback) {
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            this.progressCallback(percent, message);
        }
    },
    
    getHeaders(mallid) {
        return {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "mallid": mallid,
            "user-agent": navigator.userAgent
        };
    },
    
    // 生成价格日志内容
    createPriceLog(shopName, mallId, spuId, suggestPrice, acceptPrice, minPrice, currentTimes, action, success, message = "", sizeSpec = "", category = "", supplyPrice = null, adjustedPrice = null) {
        const now = new Date();
        const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const resultStr = success ? '操作成功' : (message ? `操作失败(${message})` : '操作失败');
        
        let logContent = `${timeStr} [类目: ${category || '-'}] [SPU:${spuId}] [规格尺寸: ${sizeSpec || '-'}] [官方报价：${suggestPrice.toFixed(2)}元] [模板同意价格：${acceptPrice.toFixed(2)}元] [模板最低价格：${minPrice.toFixed(2)}元]`;
        
        if (supplyPrice !== null) {
            logContent += ` [申报价格：${supplyPrice.toFixed(2)}元]`;
        }
        if (adjustedPrice !== null) {
            logContent += ` [调整价格：${adjustedPrice.toFixed(2)}元]`;
        }
        
        logContent += ` [核价次数：${currentTimes}次] [${action}] [${resultStr}]`;
        
        return logContent;
    },
    
    // 从商品列表中提取SKU核价数据
    extractSkuData(goodsList) {
        const allSkuData = [];
        
        for (const goodData of goodsList) {
            try {
                const spuId = goodData.productId;
                const leafCategoryId = goodData.leafCategoryId;
                const leafCategoryName = goodData.leafCategoryName || '';
                const skcList = goodData.skcList || [];
                
                if (skcList.length === 0) continue;
                
                const skcId = skcList[0].skcId;
                const priceReviewInfoList = skcList[0].supplierPriceReviewInfoList || [];
                
                for (const info of priceReviewInfoList) {
                    const productSkuList = info.productSkuList || [];
                    if (productSkuList.length === 0) continue;
                    
                    const sku = productSkuList[0];
                    if (sku.priceReviewStatus !== 1) continue;
                    
                    const propertyList = sku.productPropertyList || [];
                    const sizeSpec = propertyList.length > 0 ? propertyList[0].value : '';
                    
                    allSkuData.push({
                        spu: spuId,
                        skc: skcId,
                        sku: sku.skuId,
                        priceOrderId: info.priceOrderId,
                        supplyPrice: info.supplyPrice,
                        suggestSupplyPrice: info.suggestSupplyPrice,
                        sizeSpec: sizeSpec,
                        times: info.times || 0,
                        category: leafCategoryName,
                        catId: leafCategoryId
                    });
                }
            } catch (e) {
                console.error('提取SKU数据失败:', e);
                continue;
            }
        }
        
        return allSkuData;
    },
    
    // 匹配模板规则
    matchTemplateRule(skuData, templates) {
        const catId = skuData.catId;
        const sizeSpec = skuData.sizeSpec || '';
        
        for (const template of templates) {
            if (template.leafCat?.catId !== catId) continue;
            
            for (const spec of (template.template || [])) {
                if (spec.specName === sizeSpec) {
                    return {
                        maxPriceTimes: spec.times || 3,
                        acceptPrice: spec.acceptPrice,
                        minPrice: spec.minPrice,
                        priceStrategy: spec.strategy,
                        isAmount: true
                    };
                }
            }
        }
        
        return null;
    },
    
    // 计算调整后的价格（简化算法：supplyPrice - priceStrategy * currentTimes）
    calculateAdjustedPrice(supplyPrice, priceStrategy, currentTimes) {
        const adjusted = supplyPrice - priceStrategy * currentTimes;
        return Math.max(adjusted, 0);
    },
    
    // 决定SKU的核价操作
    determineSkuAction(skuData, rule) {
        const priceOrderId = skuData.priceOrderId;
        const skuId = skuData.sku;
        const supplyPrice = skuData.supplyPrice;
        const suggestPrice = skuData.suggestSupplyPrice;
        const currentTimes = skuData.times || 0;
        
        const maxPriceTimes = rule.maxPriceTimes || 3;
        const acceptPrice = rule.acceptPrice;
        const minPrice = rule.minPrice;
        const priceStrategy = rule.priceStrategy;
        const isAmount = rule.isAmount;
        
        const result = {
            action: 'skip',
            reason: '',
            priceOrderId: priceOrderId,
            skuId: skuId,
            price: supplyPrice
        };

//=====================================核价核心流程=====================================================
        if (currentTimes < maxPriceTimes) {
            if (suggestPrice >= acceptPrice) {
                result.action = 'agree';
                result.reason = '官方报价 >= 可接受价格';
                result.price = suggestPrice;
            } else {
                const adjustedPrice = this.calculateAdjustedPrice(supplyPrice, priceStrategy, currentTimes);
                
                if (adjustedPrice < minPrice) {
                    result.action = 'refuse';
                    result.reason = '调整价格 < 最低价格';
                } else if (suggestPrice >= adjustedPrice) {
                    result.action = 'agree';
                    result.reason = '官方报价 >= 调整价格';
                    result.price = suggestPrice;
                } else {
                    result.action = 'adjust';
                    result.reason = '官方报价 < 调整价格';
                    result.price = adjustedPrice;
                }
            }
        } else if (currentTimes === maxPriceTimes) {
            if (suggestPrice < minPrice) {
                result.action = 'refuse';
                result.reason = '最终核价 且 官方报价 < 最低价格';
            } else {
                result.action = 'agree';
                result.reason = '最终核价 且 官方报价 >= 最低价格';
                result.price = suggestPrice;
            }
        } else {
            result.action = 'refuse';
            result.reason = '核价次数 > 最大次数';
        }
        
        return result;
    },
//======================================================================================================

    // 批量提交核价结果
    async submitPriceReviewBatch(actions, mallid, sellerTemp) {
        const orderGroups = {};
        const rejectIds = [];
        
        for (const action of actions) {
            if (action.action === 'skip') continue;
            
            const priceOrderId = action.priceOrderId;
            
            if (action.action === 'refuse') {
                if (!rejectIds.includes(priceOrderId)) {
                    rejectIds.push(priceOrderId);
                }
            } else if (action.action === 'agree' || action.action === 'adjust') {
                if (!orderGroups[priceOrderId]) {
                    orderGroups[priceOrderId] = {
                        priceOrderId: priceOrderId,
                        supplierResult: action.action === 'agree' ? 1 : 2,
                        bargainReasonList: [],
                        items: []
                    };
                }
                orderGroups[priceOrderId].items.push({
                    productSkuId: action.skuId,
                    price: action.price
                });
            }
        }
        
        const items = Object.values(orderGroups);
        
        if (items.length === 0 && rejectIds.length === 0) {
            return { success: true, message: '无需提交', successCount: 0, failCount: 0 };
        }
        
        const requestData = {
            rejectOrderIdList: rejectIds,
            items: items
        };
        
        try {
            const headers = this.getHeaders(mallid);
            headers["cookie"] = `seller_temp=${sellerTemp}`;
            
            const response = await fetch(this.PRICE_REVIEW_BATCH_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                const successCount = items.length + rejectIds.length;
                return { success: true, message: '批量提交成功', successCount: successCount, failCount: 0 };
            } else {
                const failCount = items.length + rejectIds.length;
                return { success: false, message: data.errorMsg || '未知错误', successCount: 0, failCount: failCount };
            }
        } catch (e) {
            const failCount = items.length + rejectIds.length;
            return { success: false, message: e.message, successCount: 0, failCount: failCount };
        }
    },
    
    // 处理单页数据
    async processPageAndSubmit(pageNum, pageSize, catIdsFilter, templates, mallid, sellerTemp, shopName) {
        const pageData = {
            pageSize: pageSize,
            pageNum: pageNum,
            priceReviewStatusList: [1],
            supplierTodoTypeList: [1],
            timeType: 1,
            timeEnd: Date.now()
        };
        
        if (catIdsFilter && catIdsFilter.length > 0) {
            pageData.leafCatIdList = catIdsFilter;
        }
        
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                const headers = this.getHeaders(mallid);
                headers["cookie"] = `seller_temp=${sellerTemp}`;
                
                const response = await fetch(this.PRICE_SEARCH_URL, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(pageData)
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        const dataList = result.result?.dataList || [];
                        const total = result.result?.total || 0;
                        
                        if (dataList.length === 0) {
                            return { total: total, matched: 0, unmatched: 0 };
                        }
                        
                        const skuDataList = this.extractSkuData(dataList);
                        const actions = [];
                        
                        for (const skuData of skuDataList) {
                            const rule = this.matchTemplateRule(skuData, templates);
                            if (rule) {
                                const action = this.determineSkuAction(skuData, rule);
                                actions.push(action);
                                
                                const actionName = {
                                    'agree': '同意',
                                    'adjust': '调整',
                                    'refuse': '拒绝',
                                    'skip': '跳过'
                                }[action.action] || '未知';
                                
                                const logContent = this.createPriceLog(
                                    shopName,
                                    mallid,
                                    String(skuData.spu || ''),
                                    (skuData.suggestSupplyPrice || 0) / 100,
                                    (rule.acceptPrice || 0) / 100,
                                    (rule.minPrice || 0) / 100,
                                    skuData.times || 0,
                                    actionName,
                                    true,
                                    action.reason,
                                    skuData.sizeSpec || '',
                                    skuData.category || '',
                                    (action.action === 'adjust' || action.action === 'refuse') ? (skuData.supplyPrice || 0) / 100 : null,
                                    action.action === 'adjust' ? (action.price || 0) / 100 : null
                                );
                                
                                this.pricingLogs.push(logContent);
                            }
                        }
                        
                        if (actions.length > 0) {
                            await this.submitPriceReviewBatch(actions, mallid, sellerTemp);
                        }
                        
                        return {
                            total: total,
                            matched: actions.length,
                            unmatched: skuDataList.length - actions.length
                        };
                    }
                }
                
                if (attempt < this.MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_BASE * attempt));
                }
            } catch (e) {
                console.error('处理页面失败:', e);
                if (attempt < this.MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_BASE * attempt));
                }
            }
        }
        
        return { total: 0, matched: 0, unmatched: 0 };
    },
    
    // 执行核价任务
    async executePricingTask(mallid, sellerTemp, shopName) {
        this.pricingLogs = [];
        
        try {
            const stored = await chrome.storage.local.get('pricingTemplateList');
            const templates = stored.pricingTemplateList || [];
            
            if (templates.length === 0) {
                this.addLog('[核价] 无可用模板');
                return { success: false, message: '无可用模板' };
            }
            
            const catIdsFilter = [...new Set(templates.map(t => t.leafCat?.catId).filter(id => id))];
            
            this.addLog('[核价] 开始执行核价任务...');
            this.updateProgress(0, 100, '获取第一页数据...');
            
            const firstResult = await this.processPageAndSubmit(1, this.PAGE_SIZE, catIdsFilter, templates, mallid, sellerTemp, shopName);
            
            const total = firstResult.total;
            
            if (total === 0) {
                this.addLog('[核价] 无待核价商品');
                this.updateProgress(100, 100, '完成');
                return { success: true, message: '无待核价商品', logs: this.pricingLogs };
            }
            
            const totalPages = Math.ceil(total / this.PAGE_SIZE);
            this.addLog(`[核价] 共 ${total} 个待核价商品，分 ${totalPages} 页处理`);
            
            let processedPages = 1;
            this.updateProgress(Math.round((processedPages / totalPages) * 100), 100, `处理中 ${processedPages}/${totalPages} 页`);
            
            if (totalPages > 1) {
                for (let page = 2; page <= totalPages; page++) {
                    await this.processPageAndSubmit(page, this.PAGE_SIZE, catIdsFilter, templates, mallid, sellerTemp, shopName);
                    processedPages++;
                    this.updateProgress(Math.round((processedPages / totalPages) * 100), 100, `处理中 ${processedPages}/${totalPages} 页`);
                }
            }
            
            this.addLog(`[核价] 核价任务完成，共处理 ${this.pricingLogs.length} 条记录`);
            this.updateProgress(100, 100, '完成');
            
            return { success: true, message: '核价完成', logs: this.pricingLogs };
        } catch (e) {
            this.addLog(`[核价] 任务失败: ${e.message}`);
            this.updateProgress(0, 100, '失败');
            return { success: false, message: e.message, logs: this.pricingLogs };
        }
    }
};
