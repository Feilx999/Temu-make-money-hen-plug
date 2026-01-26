// JIT服务 - 开通JIT功能
const JitService = {
    PAGE_SIZE: 100,
    MAX_RETRY: 3,
    QUERY_URL: "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery",
    OPEN_JIT_URL: "https://agentseller.temu.com/visage-agent-seller/product/skc/batchOpenJit",
    
    // 日志回调函数
    logCallback: null,
    
    // 设置日志回调
    setLogCallback(callback) {
        this.logCallback = callback;
    },
    
    // 输出日志
    log(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] [JIT] ${message}`;
        if (this.logCallback) {
            this.logCallback(logMessage);
        }
        console.log(logMessage);
    },
    
    // 获取请求头
    getHeaders(mallid) {
        return {
            "accept": "*/*",
            "content-type": "application/json",
            "mallid": mallid,
            "user-agent": navigator.userAgent
        };
    },
    
    // 获取首页数据以获取总数
    async getFirstPage(mallid, sellerTemp, filterType = 'all') {
        const data = {
            isJitForMms: false,       // 筛选未开jit的商品
            skcSiteStatus: 1,         // 筛选在售商品
            page: 1,
            pageSize: 1
        };
        
        // 如果是仅首单商品，添加过滤条件
        if (filterType === 'first') {
            data.isFirstOrder = true;
        }
        
        try {
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                const response = await fetch(this.QUERY_URL, {
                    method: 'POST',
                    headers: this.getHeaders(mallid),
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
                
                if (response.status === 403) {
                    return { success: false, error: 'COOKIE已失效，请重新登录' };
                }
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        const total = result.result?.total || 0;
                        return { success: true, total: total };
                    }
                }
                
                if (retry === this.MAX_RETRY - 1) {
                    return { success: false, error: '获取首页数据失败' };
                }
            }
        } catch (error) {
            return { success: false, error: `获取首页数据异常: ${error.message}` };
        }
    },
    
    // 执行开通JIT
    async executeOpenJit(mallid, sellerTemp, filterType = 'all') {
        this.log('开始执行开通JIT任务...');
        
        // 获取总数
        const firstPageResult = await this.getFirstPage(mallid, sellerTemp, filterType);
        if (!firstPageResult.success) {
            this.log(`错误: ${firstPageResult.error}`);
            return firstPageResult;
        }
        
        const total = firstPageResult.total;
        
        if (total === 0) {
            this.log('没有需要开通JIT的商品');
            return { success: true, successCount: 0, total: 0, failReasons: {} };
        }
        
        this.log(`待开JIT商品: ${total} 个`);
        
        const maxPage = Math.ceil(total / this.PAGE_SIZE);
        let successCount = 0;
        let failReasons = {};
        
        for (let page = 1; page <= maxPage; page++) {
            this.log(`正在处理第 ${page}/${maxPage} 页...`);
            
            // 获取商品列表
            const payload = {
                isJitForMms: false,
                skcSiteStatus: 1,
                page: page,
                pageSize: this.PAGE_SIZE
            };
            
            if (filterType === 'first') {
                payload.isFirstOrder = true;
            }
            
            let querySuccess = false;
            let dataList = [];
            
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                try {
                    const response = await fetch(this.QUERY_URL, {
                        method: 'POST',
                        headers: this.getHeaders(mallid),
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                    
                    if (response.status === 403) {
                        this.log('COOKIE已失效，请重新登录');
                        return { success: false, error: 'COOKIE已失效' };
                    }
                    
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            dataList = result.result?.pageItems || [];
                            querySuccess = true;
                            break;
                        }
                    }
                } catch (error) {
                    if (retry === this.MAX_RETRY - 1) {
                        const reason = `请求第${page}页数据失败`;
                        failReasons[reason] = (failReasons[reason] || 0) + 1;
                    }
                }
            }
            
            if (!querySuccess) continue;
            
            // 构建开JIT任务列表
            const jitTaskList = [];
            for (const item of dataList) {
                const productSkcId = item.productSkcId;
                if (productSkcId) {
                    jitTaskList.push({ productSkcId: productSkcId });
                }
            }
            
            if (jitTaskList.length === 0) continue;
            
            // 批量开JIT
            const openJitPayload = { list: jitTaskList };
            
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                try {
                    const response = await fetch(this.OPEN_JIT_URL, {
                        method: 'POST',
                        headers: this.getHeaders(mallid),
                        credentials: 'include',
                        body: JSON.stringify(openJitPayload)
                    });
                    
                    if (response.status === 403) {
                        this.log('COOKIE已失效，请重新登录');
                        return { success: false, error: 'COOKIE已失效' };
                    }
                    
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            const failList = result.result?.handleProductFailedMsgList || [];
                            if (failList.length > 0) {
                                successCount += jitTaskList.length - failList.length;
                                for (const failItem of failList) {
                                    const reason = failItem.errorMsg || '开JIT失败';
                                    failReasons[reason] = (failReasons[reason] || 0) + 1;
                                }
                            } else {
                                successCount += jitTaskList.length;
                            }
                            break;
                        } else {
                            if (retry === this.MAX_RETRY - 1) {
                                const errorMsg = result.errorMsg || '开JIT失败';
                                failReasons[errorMsg] = (failReasons[errorMsg] || 0) + jitTaskList.length;
                            }
                        }
                    }
                } catch (error) {
                    if (retry === this.MAX_RETRY - 1) {
                        const reason = `第${page}页开JIT请求失败`;
                        failReasons[reason] = (failReasons[reason] || 0) + jitTaskList.length;
                    }
                }
            }
        }
        
        // 输出结果
        if (Object.keys(failReasons).length > 0) {
            this.log(`成功开通 ${successCount}/${total} 个商品的JIT`);
            this.log(`失败原因: ${JSON.stringify(failReasons)}`);
        } else {
            this.log(`成功开通 ${successCount}/${total} 个商品的JIT`);
        }
        
        return {
            success: true,
            successCount: successCount,
            total: total,
            failReasons: failReasons
        };
    }
};
