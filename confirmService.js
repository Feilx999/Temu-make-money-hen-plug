// 确认商品服务 - 确认待确认商品功能
const ConfirmService = {
    PAGE_SIZE: 50,
    MAX_RETRY: 3,
    SEARCH_URL: "https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier",
    SUBMIT_URL: "https://agentseller.temu.com/bg-brando-mms/goods/batchSupplierConfirm",
    
    // 日志回调函数
    logCallback: null,
    
    // 设置日志回调
    setLogCallback(callback) {
        this.logCallback = callback;
    },
    
    // 输出日志
    log(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] [确认] ${message}`;
        if (this.logCallback) {
            this.logCallback(logMessage);
        }
        console.log(logMessage);
    },
    
    // 获取请求头
    getHeaders(mallid) {
        return {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "mallid": mallid,
            "user-agent": navigator.userAgent
        };
    },
    
    // 获取首页数据以获取总数
    async getFirstPage(mallid, sellerTemp) {
        const data = {
            pageSize: 1,
            pageNum: 1,
            supplierTodoTypeList: [6]  // 6表示待确认商品
        };
        
        try {
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                const response = await fetch(this.SEARCH_URL, {
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
    
    // 执行确认商品
    async executeConfirm(mallid, sellerTemp, maxConfirmCount = null) {
        this.log('开始执行确认商品任务...');
        
        // 获取总数
        const firstPageResult = await this.getFirstPage(mallid, sellerTemp);
        if (!firstPageResult.success) {
            this.log(`错误: ${firstPageResult.error}`);
            return firstPageResult;
        }
        
        let total = firstPageResult.total;
        
        if (total === 0) {
            this.log('没有需要确认的商品');
            return { success: true, successCount: 0, total: 0, failReasons: {} };
        }
        
        // 如果设置了最大确认数，限制总数
        if (maxConfirmCount && maxConfirmCount > 0 && total > maxConfirmCount) {
            this.log(`限制最大确认数为 ${maxConfirmCount}`);
            total = maxConfirmCount;
        }
        
        this.log(`待确认商品: ${total} 个`);
        
        const maxPage = Math.ceil(total / this.PAGE_SIZE);
        let successCount = 0;
        let failReasons = {};
        let processedCount = 0;
        
        for (let page = 1; page <= maxPage; page++) {
            // 检查是否已达到最大确认数
            if (maxConfirmCount && processedCount >= maxConfirmCount) {
                break;
            }
            
            this.log(`正在处理第 ${page}/${maxPage} 页...`);
            
            // 获取商品列表
            const payload = {
                pageSize: this.PAGE_SIZE,
                pageNum: page,
                supplierTodoTypeList: [6]
            };
            
            let querySuccess = false;
            let dataList = [];
            
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                try {
                    const response = await fetch(this.SEARCH_URL, {
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
                            dataList = result.result?.dataList || [];
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
            
            // 构建确认任务列表
            let confirmTaskList = [];
            for (const item of dataList) {
                const goodsId = item.goodsId;
                if (goodsId) {
                    confirmTaskList.push({ goodsId: goodsId });
                }
            }
            
            // 检查是否需要切片处理
            if (maxConfirmCount && maxConfirmCount > 0) {
                const remaining = maxConfirmCount - processedCount;
                if (remaining <= 0) {
                    // 剩余数为0，跳过当前和后续所有页
                    this.log(`已达到最大确认数 ${maxConfirmCount}，停止处理`);
                    break;
                }
                if (confirmTaskList.length > remaining) {
                    // 需要切片，只取剩余数量
                    this.log(`当前页${confirmTaskList.length}条，剩余可确认${remaining}条，进行切片`);
                    confirmTaskList = confirmTaskList.slice(0, remaining);
                }
            }
            
            if (confirmTaskList.length === 0) continue;
            
            // 提交确认
            const submitPayload = { supplierConfirmReqList: confirmTaskList };
            
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                try {
                    const response = await fetch(this.SUBMIT_URL, {
                        method: 'POST',
                        headers: this.getHeaders(mallid),
                        credentials: 'include',
                        body: JSON.stringify(submitPayload)
                    });
                    
                    if (response.status === 403) {
                        this.log('COOKIE已失效，请重新登录');
                        return { success: false, error: 'COOKIE已失效' };
                    }
                    
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            const failList = result.result?.failedDetails || [];
                            if (failList.length > 0) {
                                successCount += confirmTaskList.length - failList.length;
                                for (const failItem of failList) {
                                    const reason = failItem.errorMsg || '接口返回未知错误';
                                    failReasons[reason] = (failReasons[reason] || 0) + 1;
                                }
                            } else {
                                successCount += confirmTaskList.length;
                            }
                            processedCount += confirmTaskList.length;
                            break;
                        } else {
                            if (retry === this.MAX_RETRY - 1) {
                                const reason = `提交确认失败`;
                                failReasons[reason] = (failReasons[reason] || 0) + confirmTaskList.length;
                            }
                        }
                    }
                } catch (error) {
                    if (retry === this.MAX_RETRY - 1) {
                        const reason = `提交确认请求失败`;
                        failReasons[reason] = (failReasons[reason] || 0) + confirmTaskList.length;
                    }
                }
            }
        }
        
        // 输出结果
        if (Object.keys(failReasons).length > 0) {
            this.log(`成功确认 ${successCount}/${total} 个商品`);
            this.log(`失败原因: ${JSON.stringify(failReasons)}`);
        } else {
            this.log(`成功确认 ${successCount}/${total} 个商品`);
        }
        
        return {
            success: true,
            successCount: successCount,
            total: total,
            failReasons: failReasons
        };
    }
};
