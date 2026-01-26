const ActivityService = {
    ACTIVITY_BASE_URL: "https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll",
    SKU_QUERY_URL: "https://agentseller.temu.com/bg/quiet/api/product/skc/pageQuery",
    
    logCallback: null,
    progressCallback: null,
    activityLogs: [],
    
    // 缓存的活动列表
    cachedActivityList: null,
    cachedActivityTypes: null,
    cachedThematicIds: null,
    cachedAllActivityIds: null,
    
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
        // 不在这里输出console.log，避免重复
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
    
    // 步骤0: 查询全部活动列表
    async queryAllActivities(mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.ACTIVITY_BASE_URL}/activity/list`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    needSessionItem: true,
                    needCanEnrollCnt: true
                })
            });
            
            const data = await response.json();
            if (data.success) {
                const parsed = this.parseActivities(data);
                this.cachedActivityList = parsed.rows;
                this.cachedActivityTypes = parsed.activityTypes;
                this.cachedThematicIds = parsed.thematicIds;
                this.cachedAllActivityIds = parsed.allActivityIds;
                
                return {
                    success: true,
                    data: parsed.rows,
                    activityTypes: parsed.activityTypes,
                    thematicIds: parsed.thematicIds,
                    allActivityIds: parsed.allActivityIds,
                    totalCount: parsed.rows.length
                };
            }
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 解析活动信息
    parseActivities(data) {
        const activityList = data.result?.activityList || [];
        const rows = [];
        
        for (const activity of activityList) {
            const thematicList = activity.thematicList || [];
            
            if (thematicList.length === 0) {
                rows.push({
                    activityType: activity.activityType,
                    activityName: activity.activityName,
                    activityThematicName: null,
                    activityContent: activity.activityContent,
                    timeRange: '长期',
                    activityThematicId: activity.activityType,
                    discountThreshold: activity.discountThreshold,
                    stockThreshold: activity.stockThreshold,
                    enrolledCount: null
                });
            } else {
                const activityType = activity.activityType;
                const activityName = activity.activityName;
                const activityContent = activity.activityContent;
                const activityDiscount = activity.discountThreshold;
                const activityStock = activity.stockThreshold;
                
                for (const thematic of thematicList) {
                    const thematicDiscount = thematic.discountThreshold;
                    const thematicStock = thematic.stockThreshold;
                    const finalDiscount = thematicDiscount !== undefined && thematicDiscount !== null ? thematicDiscount : activityDiscount;
                    const finalStock = thematicStock !== undefined && thematicStock !== null ? thematicStock : activityStock;
                    
                    const startTime = thematic.startTime;
                    const endTime = thematic.endTime;
                    let timeRange = '长期';
                    if (startTime && endTime) {
                        timeRange = `${this.timestampToStr(startTime)} - ${this.timestampToStr(endTime)}`;
                    }
                    
                    rows.push({
                        activityType: activityType,
                        activityName: activityName,
                        activityThematicName: thematic.activityThematicName,
                        activityContent: activityContent,
                        timeRange: timeRange,
                        activityThematicId: thematic.activityThematicId,
                        discountThreshold: finalDiscount,
                        stockThreshold: finalStock,
                        enrolledCount: thematic.enrolledCount
                    });
                }
            }
        }
        
        // 提取去重的ID列表
        const activityTypes = [...new Set(rows.map(r => r.activityType).filter(t => t !== null && t !== undefined))];
        const thematicIds = [...new Set(rows.map(r => r.activityThematicId).filter(t => t !== null && t !== undefined && String(t).length > 5))];
        const allActivityIds = [...new Set(rows.map(r => r.activityThematicId).filter(t => t !== null && t !== undefined))];
        
        return { rows, activityTypes, thematicIds, allActivityIds };
    },
    
    timestampToStr(timestamp) {
        if (!timestamp) return null;
        const date = new Date(timestamp);
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },
    
    // 步骤3: SPU查询可报活动 (genTemplate) 以及商品基础信息
    async querySpuActivities(spuId, mallid, sellerTemp) {
        // 确保有活动列表
        if (!this.cachedActivityTypes || !this.cachedThematicIds) {
            await this.queryAllActivities(mallid, sellerTemp);
        }
        
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            // 同时查询商品基础信息和可报活动
            const [goodsResult, activityResult] = await Promise.all([
                this.queryGoodsInfo(spuId, mallid, sellerTemp),
                fetch(`${this.ACTIVITY_BASE_URL}/batchimport/genTemplate`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        activityTypes: this.cachedActivityTypes,
                        thematicIds: this.cachedThematicIds,
                        productIds: [parseInt(spuId)]
                    })
                })
            ]);
            
            const data = await activityResult.json();
            if (data.success) {
                const templateProducts = data.result?.templateProducts || [];
                if (templateProducts.length === 0) {
                    return { success: false, message: '未找到可报活动的商品' };
                }
                
                const parsed = this.parseTemplateProducts(templateProducts, goodsResult);
                return { success: true, data: parsed };
            }
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 查询商品基础信息 (使用与核价配置相同的API)
    async queryGoodsInfo(spuId, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            // 使用/visage-agent-seller/product/skc/pageQuery接口，与核价配置一致
            const response = await fetch('https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery', {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify({
                    productIds: [parseInt(spuId)],
                    page: 1,
                    pageSize: 20
                })
            });
            
            const data = await response.json();
            if (data.success && data.result?.pageItems?.length > 0) {
                const goods = data.result.pageItems[0];
                
                // 解析categories (参考核价配置的实现)
                const categories = [];
                const categoriesObj = goods.categories || {};
                for (const catKey in categoriesObj) {
                    const catData = categoriesObj[catKey];
                    if (catData && typeof catData === 'object' && catData.catId && catData.catName) {
                        categories.push(catData.catName);
                    }
                }
                
                // 解析规格列表 (参考Python代码 1-制作活动模板.py)
                const skuData = [];
                const skuSummaries = goods.productSkuSummaries || [];
                for (const sku of skuSummaries) {
                    // 过滤掉 specId <= 0 的规格
                    const validSpecs = (sku.productSkuSpecList || []).filter(
                        spec => spec.specId && spec.specId > 0
                    );
                    
                    if (validSpecs.length === 0) continue;
                    
                    // 按 specId 排序
                    const sortedSpecs = validSpecs.sort((a, b) => a.specId - b.specId);
                    
                    // 构建结果
                    skuData.push({
                        specId: sortedSpecs.map(spec => spec.specId),
                        specName: sortedSpecs.map(spec => spec.specName).join('')
                    });
                }
                
                return {
                    success: true,
                    leafCat: goods.leafCat || {},
                    categories: categories,
                    skuData: skuData
                };
            }
            return { success: false };
        } catch (e) {
            return { success: false };
        }
    },
    
    // 解析商品活动模板 (使用goodsInfo中的skuData构建规格列表)
    parseTemplateProducts(templateProducts, goodsInfo = {}) {
        const parsedList = [];
        
        for (const product of templateProducts) {
            const parsed = {
                productId: product.productId,
                activityStock: product.activityStock,
                activityCode: product.activityCode,
                currency: product.currency || 'CNY',
                leafCat: goodsInfo.leafCat || {},
                categories: goodsInfo.categories || [],
                // 使用goodsInfo中解析的skuData (参考Python代码)
                skuData: goodsInfo.skuData || []
            };
            
            parsedList.push(parsed);
        }
        
        return parsedList;
    },
    
    // 查询批量SPU的可报活动 (参照Python代码genTemplate接口)
    async queryBatchSpuActivities(spuIds, mallid, sellerTemp) {
        if (!spuIds || spuIds.length === 0) {
            return { success: false, message: 'SPU列表为空' };
        }
        
        // 确保有活动列表
        if (!this.cachedActivityTypes || !this.cachedThematicIds) {
            await this.queryAllActivities(mallid, sellerTemp);
        }
        
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.ACTIVITY_BASE_URL}/batchimport/genTemplate`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    activityTypes: this.cachedActivityTypes,
                    thematicIds: this.cachedThematicIds,
                    productIds: spuIds.map(id => parseInt(id))
                })
            });
            
            const data = await response.json();
            if (data.success) {
                const templateProducts = data.result?.templateProducts || [];
                return { success: true, data: templateProducts };
            }
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 步骤4: 批量提交报名
    async batchImportEnroll(importProducts, mallid, sellerTemp) {
        if (!importProducts || importProducts.length === 0) {
            return { success: false, message: '无商品可提交' };
        }
        
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        // 计算SHA256指纹作为fileName
        const fingerprint = await this.sha256(JSON.stringify(importProducts));
        
        try {
            const response = await fetch(`${this.ACTIVITY_BASE_URL}/batchimport/import`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    fileName: fingerprint,
                    importProducts: importProducts
                })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, fingerprint: fingerprint };
            }
            return { success: false, message: data.error_msg || '提交失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // SHA256计算
    async sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    
    // 查询类目下在售商品总数
    async queryTotalByCatId(catId, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch('https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    catIds: [catId],
                    skcSiteStatus: 1,
                    page: 1,
                    pageSize: 1
                })
            });
            
            const data = await response.json();
            if (data.success && data.errorCode === 1000000) {
                return { success: true, total: data.result?.total || 0 };
            }
            return { success: false, total: 0 };
        } catch (e) {
            return { success: false, total: 0 };
        }
    },
    
    // 查询类目下的在售SPU列表
    async querySpuByCat(catId, page, pageSize, createdAtEnd, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        const body = {
            catIds: [catId],
            skcSiteStatus: 1,
            page: page,
            pageSize: pageSize
        };
        
        if (createdAtEnd) {
            body.createdAtEnd = createdAtEnd;
        }
        
        try {
            const response = await fetch('https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            });
            
            const data = await response.json();
            if (data.success) {
                const pageItems = data.result?.pageItems || [];
                const spuList = pageItems.map(item => item.productId).filter(id => id > 0);
                return { success: true, spuList: spuList };
            }
            return { success: false, spuList: [] };
        } catch (e) {
            return { success: false, spuList: [] };
        }
    },
    
    // 查询类目下的在售SPU列表（带时间游标）
    async querySpuAndTimeByCat(catId, page, pageSize, createdAtEnd, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        const body = {
            catIds: [catId],
            skcSiteStatus: 1,
            page: page,
            pageSize: pageSize
        };
        
        if (createdAtEnd) {
            body.createdAtEnd = createdAtEnd;
        }
        
        try {
            const response = await fetch('https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            });
            
            const data = await response.json();
            if (data.success) {
                const pageItems = data.result?.pageItems || [];
                const spuList = pageItems.map(item => item.productId).filter(id => id > 0);
                const timeStamp = pageItems.length > 0 ? pageItems[pageItems.length - 1].createdAt : null;
                return { success: true, spuList: spuList, timeStamp: timeStamp };
            }
            return { success: false, spuList: [], timeStamp: null };
        } catch (e) {
            return { success: false, spuList: [], timeStamp: null };
        }
    },
    
    // 构建spec价格映射（参照Python use_template_item_to_map）
    buildSpecPriceMap(templates) {
        const specPriceMap = {};
        for (const template of templates) {
            for (const sku of template.skuData) {
                const specName = sku.specName;
                const activityPrice = sku.activityPrice;
                if (specName && activityPrice) {
                    specPriceMap[specName] = activityPrice;
                }
            }
        }
        return specPriceMap;
    },
    
    // 根据模板筛选符合条件的商品（参照Python use_activity_task_list_to_can_upload_list）
    filterByTemplate(taskList, specPriceMap, minStock) {
        const result = [];
        
        for (const item of taskList) {
            // 筛选符合价格条件的SKU
            const filteredSkcList = [];
            
            for (const skc of (item.skcList || [])) {
                const filteredSkuList = [];
                
                for (const sku of (skc.skuList || [])) {
                    const specName = sku.size;
                    const templatePrice = specPriceMap[specName];
                    
                    // 如果模板中有该规格的价格配置，且当前价格大于等于模板价格，则保留
                    if (templatePrice && sku.activityPrice >= templatePrice) {
                        filteredSkuList.push(sku);
                    }
                }
                
                if (filteredSkuList.length > 0) {
                    filteredSkcList.push({
                        skcId: skc.skcId,
                        skuList: filteredSkuList
                    });
                }
            }
            
            // 检查库存和SKU数量
            if (item.activityStock <= minStock && filteredSkcList.length > 0) {
                result.push({
                    productId: item.productId,
                    activityStock: item.activityStock,
                    activityCode: item.activityCode,
                    currency: item.currency,
                    skcList: filteredSkcList
                });
            }
        }
        
        return result;
    },
    
    // 查询报名结果（参照Python query_enroll_results）
    async queryEnrollRecords(fingerprints, pageCount, mallid, sellerTemp) {
        if (!fingerprints || fingerprints.length === 0) {
            return { success: false, message: '无指纹数据' };
        }
        
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.ACTIVITY_BASE_URL}/batchimport/records`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    pageInfo: {
                        pageNo: 1,
                        pageSize: Math.max(100, Math.floor(pageCount * 1.5))
                    }
                })
            });
            
            const data = await response.json();
            if (data.success) {
                const importRecords = data.result?.importRecords || [];
                
                // 遍历查询结果，匹配指纹并统计
                let totalUpload = 0;
                let totalSuccess = 0;
                let totalFail = 0;
                let totalWait = 0;
                const recordIdList = [];
                
                for (const record of importRecords) {
                    if (fingerprints.includes(record.name)) {
                        totalUpload += record.totalCount || 0;
                        totalSuccess += record.successCount || 0;
                        totalFail += record.failedCount || 0;
                        
                        const waitCount = (record.totalCount || 0) - (record.successCount || 0) - (record.failedCount || 0);
                        if (waitCount > 0) {
                            totalWait += waitCount;
                        }
                        
                        if (record.failedCount > 0) {
                            recordIdList.push(record.recordId);
                        }
                    }
                }
                
                return { 
                    success: true, 
                    totalUpload,
                    totalSuccess,
                    totalFail,
                    totalWait,
                    recordIdList
                };
            }
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 查询失败详情（参照Python query_fail_details）
    async queryFailDetails(recordIdList, mallid, sellerTemp) {
        if (!recordIdList || recordIdList.length === 0) {
            return { success: true, data: {} };
        }
        
        const failReasons = {};
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        for (const recordId of recordIdList) {
            try {
                const response = await fetch(`${this.ACTIVITY_BASE_URL}/batchimport/failDetails`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        recordId: recordId,
                        pageInfo: {
                            pageNo: 1,
                            pageSize: 1000000
                        }
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    const failDetails = data.result?.failDetails || [];
                    
                    // 收集失败原因
                    for (const detail of failDetails) {
                        const errorMsg = detail.errorMsg || '未知错误';
                        failReasons[errorMsg] = (failReasons[errorMsg] || 0) + 1;
                    }
                }
            } catch (e) {
                // 继续处理下一个recordId
                continue;
            }
        }
        
        return { success: true, data: failReasons };
    },
    
    // 查询失败详情（旧版本，保留兼容）
    async queryFailDetailsOld(recordId, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.ACTIVITY_BASE_URL}/batchimport/failDetails`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    recordId: recordId,
                    pageInfo: {
                        pageNo: 1,
                        pageSize: 1000000
                    }
                })
            });
            
            const data = await response.json();
            if (data.success) {
                const failDetails = data.result?.failDetails || [];
                const failReasons = {};
                
                for (const detail of failDetails) {
                    const msg = detail.errorMsg || '未知错误';
                    failReasons[msg] = (failReasons[msg] || 0) + 1;
                }
                
                return { success: true, data: failReasons, total: failDetails.length };
            }
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 更新模板的活动ID (基于all_activity字段)
    async updateTemplateActivityIds(templates, mallid, sellerTemp) {
        // 先获取最新的活动列表
        const activityResult = await this.queryAllActivities(mallid, sellerTemp);
        if (!activityResult.success) {
            return { success: false, message: '获取活动列表失败' };
        }
        
        const latestActivityIds = activityResult.allActivityIds;
        
        for (const template of templates) {
            for (const skuData of (template.skuData || [])) {
                if (skuData.all_activity === true) {
                    // 全选时使用最新的全部活动ID
                    skuData.all_activity_ids = [...latestActivityIds];
                } else {
                    // 非全选时取交集(删除过期活动)
                    const originalIds = skuData.all_activity_ids || [];
                    skuData.all_activity_ids = originalIds.filter(id => latestActivityIds.includes(id));
                }
            }
        }
        
        return { success: true, data: templates, latestActivityIds: latestActivityIds };
    },
    
    // 执行活动报名任务 (参照Python全流程完全重写)
    async executeActivityTask(mallid, sellerTemp, shopName) {
        this.activityLogs = [];
        
        try {
            // 获取保存的活动模板
            const stored = await chrome.storage.local.get('activityTemplateList');
            const templates = stored.activityTemplateList || [];
            
            if (templates.length === 0) {
                this.addLog('[活动] 无可用模板');
                return { success: false, message: '无可用模板' };
            }
            
            this.addLog('[活动] 开始执行活动报名任务...');
            this.updateProgress(0, 100, '准备中...');
            
            // 步骤1: 更新活动ID列表
            this.addLog('[活动] 正在更新活动列表...');
            const updateResult = await this.updateTemplateActivityIds(templates, mallid, sellerTemp);
            if (!updateResult.success) {
                this.addLog(`[活动] 更新活动列表失败: ${updateResult.message}`);
                return { success: false, message: updateResult.message };
            }
            
            // 保存更新后的模板
            await chrome.storage.local.set({ activityTemplateList: updateResult.data });
            const updatedTemplates = updateResult.data;
            this.addLog(`[活动] 活动列表已更新，共 ${updateResult.latestActivityIds.length} 个活动`);
            
            // 统计变量
            let totalSuccess = 0;
            let totalFail = 0;
            let totalUpload = 0;
            let totalWait = 0;
            const allFingerprints = [];
            const failReasons = {};
            let allCatPageCount = 0;
            
            // 步骤2: 按类目循环处理 (参照Python main流程)
            const catIdList = [...new Set(updatedTemplates.map(t => t.catId))];
            this.addLog(`[活动] 共 ${catIdList.length} 个类目需要处理`);
            
            for (const catId of catIdList) {
                this.addLog(`[活动] 开始处理类目: ${catId}`);
                
                // 获取该类目下的模板
                const catTemplates = updatedTemplates.filter(t => t.catId === catId);
                
                // 计算该类目模板中最长的activity_ids长度
                const maxActivityIdLength = Math.max(...catTemplates.flatMap(t => 
                    t.skuData.map(sku => (sku.all_activity_ids || []).length)
                ));
                
                // 动态计算pageSize = 2000 / max_activity_id_length
                const pageSize = Math.floor(2000 / Math.max(maxActivityIdLength, 1));
                this.addLog(`[活动] 类目 ${catId} 每批次处理 ${pageSize} 个SPU`);
                
                // 查询该类目下的在售商品总数
                const totalResult = await this.queryTotalByCatId(catId, mallid, sellerTemp);
                if (!totalResult.success || totalResult.total === 0) {
                    this.addLog(`[活动] 类目 ${catId} 无在售商品`);
                    continue;
                }
                
                const total = totalResult.total;
                const pageCount = Math.ceil(total / pageSize);
                allCatPageCount += pageCount;
                this.addLog(`[活动] 类目 ${catId} 共 ${total} 个在售商品，分 ${pageCount} 页处理`);
                
                // 构建spec_price_map和min_stock
                const specPriceMap = this.buildSpecPriceMap(catTemplates);
                const minStock = Math.min(...catTemplates.flatMap(t => 
                    t.skuData.map(sku => sku.activityStock || 30)
                ));
                
                // 分页查询在售SPU并报名
                let page = 0;
                let timeStamp = null;
                
                for (let i = 1; i <= pageCount; i++) {
                    page++;
                    
                    // 判断是否需要使用时间游标 (page_size * (page + 1) > 40000)
                    let spuList;
                    if (pageSize * (page + 1) > 40000) {
                        const result = await this.querySpuAndTimeByCat(catId, page, pageSize, timeStamp, mallid, sellerTemp);
                        if (!result.success) continue;
                        spuList = result.spuList;
                        timeStamp = result.timeStamp;
                        page = 0; // 使用时间游标后重置page
                    } else {
                        const result = await this.querySpuByCat(catId, page, pageSize, timeStamp, mallid, sellerTemp);
                        if (!result.success) continue;
                        spuList = result.spuList;
                    }
                    
                    if (spuList.length === 0) continue;
                    
                    this.addLog(`[活动] 类目 ${catId} 第 ${i}/${pageCount} 页，查询到 ${spuList.length} 个SPU`);
                    
                    // 批量查询可报活动
                    const genResult = await this.queryBatchSpuActivities(spuList, mallid, sellerTemp);
                    if (!genResult.success || genResult.data.length === 0) {
                        this.addLog(`[活动] 批次查询可报活动失败或无数据`);
                        continue;
                    }
                    
                    // 根据模板筛选符合条件的商品
                    const canUploadList = this.filterByTemplate(genResult.data, specPriceMap, minStock);
                    
                    if (canUploadList.length === 0) {
                        this.addLog(`[活动] 批次无符合条件的商品`);
                        continue;
                    }
                    
                    this.addLog(`[活动] 批次准备提交 ${canUploadList.length} 个商品`);
                    
                    // 提交报名
                    const submitResult = await this.batchImportEnroll(canUploadList, mallid, sellerTemp);
                    if (submitResult.success) {
                        allFingerprints.push(submitResult.fingerprint);
                        // this.addLog(`[活动] 批次提交成功，指纹: ${submitResult.fingerprint.substring(0, 16)}...`);
                    } else {
                        this.addLog(`[活动] 批次提交失败: ${submitResult.message}`);
                    }
                    
                    this.updateProgress(
                        Math.round((i / pageCount) * 100),
                        100,
                        `类目 ${catId} 处理中 ${i}/${pageCount}`
                    );
                }
            }
            
            // 等待一段时间后查询结果
            if (allFingerprints.length > 0) {
                this.addLog('[活动] 等待处理结果...');
                await new Promise(r => setTimeout(r, 3000));
                
                // 查询报名结果 (参照Python query_enroll_results)
                const recordsResult = await this.queryEnrollRecords(allFingerprints, allCatPageCount, mallid, sellerTemp);
                if (recordsResult.success) {
                    totalUpload = recordsResult.totalUpload;
                    totalSuccess = recordsResult.totalSuccess;
                    totalFail = recordsResult.totalFail;
                    totalWait = recordsResult.totalWait;
                    
                    // 查询失败详情
                    if (recordsResult.recordIdList.length > 0) {
                        const failResult = await this.queryFailDetails(recordsResult.recordIdList, mallid, sellerTemp);
                        if (failResult.success) {
                            Object.assign(failReasons, failResult.data);
                        }
                    }
                }
            }
            
            // 记录日志 (参照Python输出格式)
            this.activityLogs.push(`总上传数: ${totalUpload}`);
            this.activityLogs.push(`成功报名数: ${totalSuccess}`);
            this.activityLogs.push(`失败数: ${totalFail}`);
            if (totalWait > 0) {
                this.activityLogs.push(`等待处理商品数: ${totalWait}`);
            }
            
            if (Object.keys(failReasons).length > 0) {
                this.activityLogs.push('失败原因:');
                for (const [reason, count] of Object.entries(failReasons)) {
                    this.activityLogs.push(`${reason}=${count}`);
                }
            }
            
            this.addLog(`[活动] 任务完成，成功: ${totalSuccess}, 失败: ${totalFail}`);
            this.updateProgress(100, 100, '完成');
            
            return {
                success: true,
                totalSuccess,
                totalFail,
                totalUpload,
                totalWait,
                failReasons,
                logs: this.activityLogs
            };
        } catch (e) {
            this.addLog(`[活动] 任务失败: ${e.message}`);
            this.updateProgress(0, 100, '失败');
            return { success: false, message: e.message, logs: this.activityLogs };
        }
    },
    
    // 查找SKU配置
    findSkuConfig(skuData, product) {
        if (!skuData || skuData.length === 0) return null;
        
        // 尝试匹配specId
        for (const config of skuData) {
            if (config.specId && config.specId.length > 0) {
                for (const skc of product.skcList) {
                    for (const sku of skc.skuList) {
                        if (config.specId.includes(sku.skuId)) {
                            return config;
                        }
                    }
                }
            }
        }
        
        // 返回第一个配置作为默认
        return skuData[0];
    }
};
