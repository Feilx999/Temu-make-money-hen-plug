// 补货服务 - 并发查询 + 并发更新（无需Worker文件）
// 进度分配: 准备0-5%, 查询5-20%, 更新20-100%

const ReplenishService = {
    PAGE_SIZE: 100,
    MAX_RETRY: 3,
    CONCURRENCY: 10,
    QUERY_URL: "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery",
    UPDATE_URL: "https://agentseller.temu.com/darwin-mms/api/kiana/foredawn/sales/stock/updateMmsSkuSalesStock",
    
    // 任务队列（竞争式）
    taskQueue: [],
    taskIndex: 0,
    processedTaskIds: new Set(),
    
    // 结果统计
    successCount: 0,
    failCount: 0,
    failReasons: {},
    totalTasks: 0,
    
    // 回调
    logCallback: null,
    progressCallback: null,
    
    // 状态
    isRunning: false,
    cookieExpired: false,
    
    // 进度配置（百分比）
    PROGRESS: {
        PREPARE_START: 0,
        PREPARE_END: 5,
        QUERY_START: 5,
        QUERY_END: 20,
        UPDATE_START: 20,
        UPDATE_END: 100
    },
    
    setLogCallback(callback) {
        this.logCallback = callback;
    },
    
    setProgressCallback(callback) {
        this.progressCallback = callback;
    },
    
    log(message) {
        if (this.logCallback) {
            this.logCallback(`[补货] ${message}`);
        }
        console.log(`[补货] ${message}`);
    },
    
    // 直接设置进度百分比
    setProgress(percent, message = '') {
        if (this.progressCallback) {
            this.progressCallback(parseFloat(percent.toFixed(2)), message);
        }
    },
    
    // 计算查询阶段进度
    calcQueryProgress(completed, total) {
        const range = this.PROGRESS.QUERY_END - this.PROGRESS.QUERY_START;
        return this.PROGRESS.QUERY_START + (completed / total) * range;
    },
    
    // 计算更新阶段进度
    calcUpdateProgress(completed, total) {
        const range = this.PROGRESS.UPDATE_END - this.PROGRESS.UPDATE_START;
        return this.PROGRESS.UPDATE_START + (completed / total) * range;
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
        const patterns = filterText.split(/[\s\n]+/).filter(p => p.trim() !== '');
        return patterns.length === 0 ? null : patterns;
    },
    
    // 检查货号是否匹配过滤规则
    matchSkuFilter(extCode, patterns) {
        if (!patterns || patterns.length === 0) return true;
        if (!extCode) return false;
        
        for (const pattern of patterns) {
            if (pattern.includes('*')) {
                const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
                const regex = new RegExp('^' + escaped + '$', 'i');
                if (regex.test(extCode)) return true;
            } else {
                if (extCode.toLowerCase() === pattern.toLowerCase()) return true;
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
                        return { success: true, total: result.result?.total || 0 };
                    }
                }
            } catch (error) {
                if (retry === this.MAX_RETRY - 1) {
                    return { success: false, error: `获取数据异常: ${error.message}` };
                }
            }
        }
        return { success: false, error: '获取数据失败' };
    },
    
    // 查询单页数据
    async queryPage(mallid, page, setStock, stockLimit) {
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
                    return { success: false, error: 'COOKIE已失效', cookieExpired: true, items: [] };
                }
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        return { success: true, items: result.result?.pageItems || [] };
                    }
                }
            } catch (error) {
                if (retry === this.MAX_RETRY - 1) {
                    return { success: false, error: error.message, items: [] };
                }
            }
        }
        return { success: false, error: '查询失败', items: [] };
    },
    
    // 并发查询所有页面（控制并发数）
    async fetchAllProducts(mallid, setStock, stockLimit, skuFilterPatterns, totalPages) {
        const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);
        const taskList = [];
        const seenProductIds = new Set();
        let completedPages = 0;
        
        // 分批并发查询
        for (let i = 0; i < allPages.length; i += this.CONCURRENCY) {
            if (this.cookieExpired) break;
            
            const batch = allPages.slice(i, i + this.CONCURRENCY);
            const promises = batch.map(page => this.queryPage(mallid, page, setStock, stockLimit));
            const results = await Promise.all(promises);
            
            for (const result of results) {
                completedPages++;
                
                if (result.cookieExpired) {
                    this.cookieExpired = true;
                    return { success: false, error: 'COOKIE已失效', tasks: [] };
                }
                
                if (!result.success || !result.items) continue;
                
                for (const item of result.items) {
                    const productId = item.productId;
                    const productSkcId = item.productSkcId;
                    const extCode = item.extCode || '';
                    const skuSummaries = item.productSkuSummaries || [];
                    
                    if (!productId || !productSkcId || skuSummaries.length === 0) continue;
                    if (seenProductIds.has(productSkcId)) continue;
                    seenProductIds.add(productSkcId);
                    
                    if (skuFilterPatterns && !this.matchSkuFilter(extCode, skuFilterPatterns)) continue;
                    
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
                        taskList.push({
                            productId: productId,
                            productSkcId: productSkcId,
                            skuVirtualStockChangeList: skuChanges
                        });
                    }
                }
            }
            
            // 更新查询进度
            this.setProgress(this.calcQueryProgress(completedPages, totalPages), `查询中 ${completedPages}/${totalPages}`);
        }
        
        return { success: true, tasks: taskList };
    },
    
    // 更新单个商品
    async updateProduct(mallid, product) {
        try {
            const response = await fetch(this.UPDATE_URL, {
                method: 'POST',
                headers: this.getHeaders(mallid),
                credentials: 'include',
                body: JSON.stringify(product)
            });
            
            if (response.status === 403) {
                return { success: false, error: 'COOKIE已失效', cookieExpired: true };
            }
            
            let responseData = null;
            try {
                responseData = await response.json();
            } catch (e) {
                return { success: false, error: `HTTP ${response.status}` };
            }
            
            if (response.ok && responseData.success && responseData.errorCode === 1000000) {
                return { success: true };
            } else {
                return { success: false, error: responseData.error_msg || responseData.errorMsg || '补货失败' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
    
    // 获取下一个任务（竞争式）
    getNextTask() {
        while (this.taskIndex < this.taskQueue.length) {
            const currentIndex = this.taskIndex++;
            const taskId = `task_${currentIndex}`;
            
            if (this.processedTaskIds.has(taskId)) continue;
            this.processedTaskIds.add(taskId);
            
            return this.taskQueue[currentIndex];
        }
        return null;
    },
    
    // 并发更新所有任务（竞争式）
    async updateAllTasks(mallid) {
        const totalTasks = this.taskQueue.length;
        if (totalTasks === 0) return;
        
        // 创建worker函数
        const worker = async () => {
            while (this.isRunning && !this.cookieExpired) {
                const task = this.getNextTask();
                if (!task) break;
                
                const result = await this.updateProduct(mallid, task);
                
                if (result.cookieExpired) {
                    this.cookieExpired = true;
                    break;
                }
                
                if (result.success) {
                    this.successCount++;
                } else {
                    this.failCount++;
                    const reason = result.error || '未知错误';
                    this.failReasons[reason] = (this.failReasons[reason] || 0) + 1;
                }
                
                // 更新进度
                const completed = this.successCount + this.failCount;
                this.setProgress(this.calcUpdateProgress(completed, totalTasks), `更新中 ${completed}/${totalTasks}`);
            }
        };
        
        // 启动多个并发worker
        const workers = [];
        for (let i = 0; i < this.CONCURRENCY; i++) {
            workers.push(worker());
        }
        
        await Promise.all(workers);
    },
    
    // 重置状态
    resetState() {
        this.taskQueue = [];
        this.taskIndex = 0;
        this.processedTaskIds.clear();
        this.successCount = 0;
        this.failCount = 0;
        this.failReasons = {};
        this.totalTasks = 0;
        this.isRunning = false;
        this.cookieExpired = false;
    },
    
    // 执行补货任务
    async executeReplenish(mallid, sellerTemp, setStock = 1000, stockLimit = 0.95, skuFilter = '') {
        this.resetState();
        
        this.log('开始执行补货任务...');
        this.log(`补货库存: ${setStock}, 补货阈值: ${stockLimit * 100}%`);
        this.setProgress(this.PROGRESS.PREPARE_START, '准备中...');
        
        const skuFilterPatterns = this.parseSkuFilter(skuFilter);
        if (skuFilterPatterns) {
            this.log(`货号过滤规则: ${skuFilterPatterns.join(', ')}`);
        }
        
        // 1. 获取总数 (0-5%)
        const firstPageResult = await this.getFirstPage(mallid, setStock, stockLimit);
        if (!firstPageResult.success) {
            this.log(`查询失败: ${firstPageResult.error}`);
            this.setProgress(0, '失败');
            return { success: false, error: firstPageResult.error };
        }
        
        const total = firstPageResult.total;
        if (total === 0) {
            this.log('无需要补货的商品');
            this.setProgress(100, '完成');
            return { success: true, successCount: 0, total: 0, failReasons: {} };
        }
        
        const totalPages = Math.ceil(total / this.PAGE_SIZE);
        this.log(`待补货商品: ${total} 个, 共 ${totalPages} 页`);
        this.setProgress(this.PROGRESS.PREPARE_END, '准备完成');
        
        // 2. 并发查询所有页面 (5-20%)
        this.setProgress(this.PROGRESS.QUERY_START, '查询商品数据...');
        
        const queryResult = await this.fetchAllProducts(
            mallid, setStock, stockLimit, skuFilterPatterns, totalPages
        );
        
        if (!queryResult.success) {
            this.log(`查询失败: ${queryResult.error}`);
            this.setProgress(0, '失败');
            return { success: false, error: queryResult.error };
        }
        
        const tasks = queryResult.tasks;
        if (tasks.length === 0) {
            this.log('查询完成，无需要补货的商品');
            this.setProgress(100, '完成');
            return { success: true, successCount: 0, total: 0, failReasons: {} };
        }
        
        this.log(`查询完成，共 ${tasks.length} 个商品需要补货`);
        this.setProgress(this.PROGRESS.QUERY_END, '查询完成');
        
        // 3. 并发更新 (20-100%)
        this.taskQueue = tasks;
        this.totalTasks = tasks.length;
        this.isRunning = true;
        
        this.setProgress(this.PROGRESS.UPDATE_START, '更新库存...');
        await this.updateAllTasks(mallid);
        
        // 4. 清理状态
        this.taskQueue = [];
        this.processedTaskIds.clear();
        this.isRunning = false;
        
        this.setProgress(100, '完成');
        
        // 5. 输出结果
        this.log(`补货完成: 成功 ${this.successCount} 个, 失败 ${this.failCount} 个`);
        if (Object.keys(this.failReasons).length > 0) {
            const reasonStrings = Object.entries(this.failReasons)
                .map(([reason, count]) => `${reason}: ${count}`)
                .join(', ');
            this.log(`失败原因: ${reasonStrings}`);
        }
        
        if (this.cookieExpired) {
            this.log('COOKIE已失效');
            return { success: false, error: 'COOKIE已失效' };
        }
        
        return {
            success: true,
            successCount: this.successCount,
            failCount: this.failCount,
            total: tasks.length,
            failReasons: this.failReasons
        };
    }
};
