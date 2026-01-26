// 补货服务 - 基于商品补货流程_async.py

const ReplenishService = {
    PAGE_SIZE: 100,
    MAX_RETRY: 3,
    WORKER_COUNT: 10,
    QUERY_URL: "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery",
    UPDATE_URL: "https://agentseller.temu.com/darwin-mms/api/kiana/foredawn/sales/stock/updateMmsSkuSalesStock",
    
    workers: [],
    workerResolvers: {},
    taskIdCounter: 0,
    logCallback: null,
    
    setLogCallback(callback) {
        this.logCallback = callback;
    },
    
    log(message) {
        if (this.logCallback) {
            this.logCallback(message);
        } else {
            console.log(message);
        }
    },
    
    // 初始化Workers
    initWorkers() {
        if (this.workers.length > 0) return;
        
        for (let i = 0; i < this.WORKER_COUNT; i++) {
            const worker = new Worker(chrome.runtime.getURL('replenishWorker.js'));
            worker.onmessage = (e) => {
                const { taskId, results } = e.data;
                if (this.workerResolvers[taskId]) {
                    this.workerResolvers[taskId](results);
                    delete this.workerResolvers[taskId];
                }
            };
            this.workers.push(worker);
        }
    },
    
    // 使用Worker执行批量请求
    async executeWithWorker(workerIndex, mallid, products) {
        return new Promise((resolve) => {
            const taskId = ++this.taskIdCounter;
            this.workerResolvers[taskId] = resolve;
            this.workers[workerIndex].postMessage({
                taskId,
                mallid,
                products,
                headers: this.getHeaders(mallid)
            });
        });
    },
    
    // 使用多个Worker并发处理
    async updateProductsWithWorkers(mallid, products) {
        this.initWorkers();
        
        const workerCount = this.workers.length;
        const chunkSize = Math.ceil(products.length / workerCount);
        const chunks = [];
        
        for (let i = 0; i < products.length; i += chunkSize) {
            chunks.push(products.slice(i, i + chunkSize));
        }
        
        const promises = chunks.map((chunk, index) => 
            this.executeWithWorker(index % workerCount, mallid, chunk)
        );
        
        const allResults = await Promise.all(promises);
        return allResults.flat();
    },
    
    getHeaders(mallid) {
        return {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "mallid": mallid,
            "user-agent": navigator.userAgent
        };
    },
    
    // 解析货号过滤规则
    parseSkuFilter(filterText) {
        if (!filterText || filterText.trim() === '') {
            return null;
        }
        // 按空格或换行分割，过滤空值
        const patterns = filterText.split(/[\s\n]+/).filter(p => p.trim() !== '');
        if (patterns.length === 0) {
            return null;
        }
        return patterns;
    },
    
    // 检查货号是否匹配过滤规则（使用extCode字段）
    matchSkuFilter(extCode, patterns) {
        if (!patterns || patterns.length === 0) {
            return true; // 无过滤规则，全部匹配
        }
        if (!extCode) {
            return false;
        }
        for (const pattern of patterns) {
            // 支持通配符 * 匹配任意个字符
            if (pattern.includes('*')) {
                // 转义特殊字符，*转为.*
                const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
                const regex = new RegExp('^' + escaped + '$', 'i');
                if (regex.test(extCode)) {
                    return true;
                }
            } else {
                if (extCode.toLowerCase() === pattern.toLowerCase()) {
                    return true;
                }
            }
        }
        return false;
    },
    
    // 获取首页数据以获取总数
    async getFirstPage(mallid, setStock, stockLimit) {
        const data = {
            jitStockQuantitySection: {
                leftValue: 0,
                rightValue: Math.floor(stockLimit * setStock)
            },
            skcSiteStatus: 1,
            page: 1,
            pageSize: 1
        };
        
        for (let retry = 0; retry < this.MAX_RETRY; retry++) {
            try {
                const response = await fetch(this.QUERY_URL, {
                    method: 'POST',
                    headers: this.getHeaders(mallid),
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
                
                if (response.status === 403) {
                    return { success: false, error: 'COOKIE已失效' };
                }
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        const total = result.result?.total || 0;
                        return { success: true, total };
                    }
                }
            } catch (error) {
                if (retry === this.MAX_RETRY - 1) {
                    return { success: false, error: `获取首页数据异常: ${error.message}` };
                }
            }
        }
        return { success: false, error: '获取首页数据失败' };
    },
    
    // 查询所有需要补货的商品
    async fetchAllProducts(mallid, setStock, stockLimit, skuFilterPatterns = null) {
        const allProducts = [];
        
        // 获取总数
        const firstPageResult = await this.getFirstPage(mallid, setStock, stockLimit);
        if (!firstPageResult.success) {
            return { success: false, error: firstPageResult.error, products: [] };
        }
        
        const total = firstPageResult.total;
        if (total === 0) {
            return { success: true, total: 0, products: [] };
        }
        
        const maxPage = Math.ceil(total / this.PAGE_SIZE);
        this.log(`[补货] 开始查询 ${maxPage} 页数据...`);
        
        for (let page = 1; page <= maxPage; page++) {
            const payload = {
                jitStockQuantitySection: {
                    leftValue: 0,
                    rightValue: Math.floor(stockLimit * setStock)
                },
                skcSiteStatus: 1,
                page: page,
                pageSize: this.PAGE_SIZE
            };
            
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                try {
                    const response = await fetch(this.QUERY_URL, {
                        method: 'POST',
                        headers: this.getHeaders(mallid),
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                    
                    if (response.status === 403) {
                        return { success: false, error: 'COOKIE已失效', products: [] };
                    }
                    
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            const dataList = result.result?.pageItems || [];
                            
                            for (const item of dataList) {
                                const productId = item.productId;
                                const productSkcId = item.productSkcId;
                                const extCode = item.extCode || '';
                                const skuSummaries = item.productSkuSummaries || [];
                                
                                if (!productId || !productSkcId || skuSummaries.length === 0) {
                                    continue;
                                }
                                
                                // 应用货号过滤（使用extCode字段）
                                if (skuFilterPatterns && !this.matchSkuFilter(extCode, skuFilterPatterns)) {
                                    continue;
                                }
                                
                                const skuChanges = [];
                                for (const sku of skuSummaries) {
                                    const skuId = sku.productSkuId;
                                    const currentStock = parseInt(sku.virtualStock || 0);
                                    const stockToAdd = setStock - currentStock;
                                    
                                    if (skuId && stockToAdd !== 0) {
                                        skuChanges.push({
                                            productSkuId: skuId,
                                            virtualStockDiff: stockToAdd
                                        });
                                    }
                                }
                                
                                if (skuChanges.length > 0) {
                                    allProducts.push({
                                        productId: productId,
                                        productSkcId: productSkcId,
                                        skuVirtualStockChangeList: skuChanges
                                    });
                                }
                            }
                            break;
                        }
                    }
                } catch (error) {
                    if (retry === this.MAX_RETRY - 1) {
                        this.log(`[补货] 第${page}页查询失败: ${error.message}`);
                    }
                }
            }
        }
        
        this.log(`[补货] 查询完成，共获取 ${allProducts.length} 个需要补货的SPU`);
        return { success: true, total, products: allProducts };
    },
    
    // 更新单个商品库存
    async updateProduct(mallid, product) {
        for (let retry = 0; retry < this.MAX_RETRY; retry++) {
            try {
                const response = await fetch(this.UPDATE_URL, {
                    method: 'POST',
                    headers: this.getHeaders(mallid),
                    credentials: 'include',
                    body: JSON.stringify(product)
                });
                
                if (response.status === 403) {
                    return { success: false, error: 'COOKIE已失效' };
                }
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.errorCode === 1000000) {
                        return { success: true };
                    } else {
                        const errorMsg = result.error_msg || result.errorMsg || `errorCode=${result.errorCode}`;
                        if (retry === this.MAX_RETRY - 1) {
                            return { success: false, error: errorMsg };
                        }
                    }
                }
            } catch (error) {
                if (retry === this.MAX_RETRY - 1) {
                    return { success: false, error: error.message };
                }
            }
            
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)));
        }
        return { success: false, error: '重试失败' };
    },
    
    // 批量并发更新商品库存（100并发）
    async updateProductsBatch(mallid, products) {
        const results = [];
        // 并发发送所有请求，不等待响应
        const promises = products.map(product => 
            this.updateProductAsync(mallid, product)
        );
        // 等待所有响应
        const responses = await Promise.allSettled(promises);
        for (const response of responses) {
            if (response.status === 'fulfilled') {
                results.push(response.value);
            } else {
                results.push({ success: false, error: response.reason?.message || '请求失败' });
            }
        }
        return results;
    },
    
    // 异步更新单个商品（无重试，用于并发）
    async updateProductAsync(mallid, product) {
        try {
            const response = await fetch(this.UPDATE_URL, {
                method: 'POST',
                headers: this.getHeaders(mallid),
                credentials: 'include',
                body: JSON.stringify(product)
            });
            
            if (response.status === 403) {
                return { success: false, error: 'COOKIE已失效' };
            }
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.errorCode === 1000000) {
                    return { success: true };
                } else {
                    return { success: false, error: result.error_msg || result.errorMsg || '补货失败' };
                }
            }
            return { success: false, error: '请求失败' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // 执行补货任务
    async executeReplenish(mallid, sellerTemp, setStock = 1000, stockLimit = 0.95, skuFilter = '') {
        this.log('[补货] 开始执行补货任务...');
        this.log(`[补货] 补货库存: ${setStock}, 补货阈值: ${stockLimit * 100}%`);
        
        // 解析货号过滤规则
        const skuFilterPatterns = this.parseSkuFilter(skuFilter);
        if (skuFilterPatterns) {
            this.log(`[补货] 货号过滤规则: ${skuFilterPatterns.join(', ')}`);
        }
        
        // 查询需要补货的商品
        const fetchResult = await this.fetchAllProducts(mallid, setStock, stockLimit, skuFilterPatterns);
        
        if (!fetchResult.success) {
            this.log(`[补货] 查询失败: ${fetchResult.error}`);
            return { success: false, error: fetchResult.error };
        }
        
        if (fetchResult.products.length === 0) {
            this.log('[补货] 无需要补货的商品');
            return { success: true, successCount: 0, total: 0, failReasons: {} };
        }
        
        const totalProducts = fetchResult.products.length;
        this.log(`[补货] 待补货商品: ${totalProducts} 个`);
        this.log(`[补货] 开始更新库存（${this.WORKER_COUNT}个Worker并发）...`);
        
        let successCount = 0;
        let failCount = 0;
        const failReasons = {};
        let lastLogCount = 0;
        
        // 使用多个Worker并发处理所有商品
        const results = await this.updateProductsWithWorkers(mallid, fetchResult.products);
        
        for (const result of results) {
            if (result.success) {
                successCount++;
            } else {
                failCount++;
                const reason = result.error || '未知错误';
                failReasons[reason] = (failReasons[reason] || 0) + 1;
            }
            
            // 每成功100个输出进度日志
            if (successCount > 0 && successCount >= lastLogCount + 100) {
                this.log(`[补货] 已完成 ${successCount}/${totalProducts} 个商品的补货`);
                lastLogCount = Math.floor(successCount / 100) * 100;
            }
        }
        
        // 最终进度日志
        if (successCount > lastLogCount || successCount === totalProducts) {
            this.log(`[补货] 已完成 ${successCount}/${totalProducts} 个商品的补货`);
        }
        
        // 输出结果
        if (Object.keys(failReasons).length > 0) {
            this.log(`[补货] 补货完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
            this.log(`[补货] 失败原因: ${JSON.stringify(failReasons)}`);
        } else {
            this.log(`[补货] 补货完成: 成功 ${successCount} 个`);
        }
        
        return {
            success: true,
            successCount,
            failCount,
            total: totalProducts,
            failReasons
        };
    }
};
