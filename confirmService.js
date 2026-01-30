// 确认商品服务 - 确认待确认商品功能
const ConfirmService = {
    PAGE_SIZE: 50,
    MAX_RETRY: 3,
    SEARCH_URL: "https://agentseller.temu.com/api/kiana/mms/robin/searchForChainSupplier",
    SUBMIT_URL: "https://agentseller.temu.com/bg-brando-mms/goods/batchSupplierConfirm",
    
    // 日志回调函数
    logCallback: null,
    progressCallback: null,
    
    // 设置日志回调
    setLogCallback(callback) {
        this.logCallback = callback;
    },
    
    setProgressCallback(callback) {
        this.progressCallback = callback;
    },
    
    // 输出日志
    log(message) {
        if (this.logCallback) {
            this.logCallback(`[确认] ${message}`);
        }
        console.log(`[确认] ${message}`);
    },
    
    updateProgress(current, total, message = '') {
        if (this.progressCallback) {
            const percent = total > 0 ? parseFloat(((current / total) * 100).toFixed(2)) : 0;
            this.progressCallback(percent, message);
        }
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
        this.updateProgress(0, 100, '准备中...');
        
        // 获取总数
        const firstPageResult = await this.getFirstPage(mallid, sellerTemp);
        if (!firstPageResult.success) {
            this.log(`错误: ${firstPageResult.error}`);
            this.updateProgress(0, 100, '失败');
            return firstPageResult;
        }
        
        let total = firstPageResult.total;
        
        if (total === 0) {
            this.log('没有需要确认的商品');
            this.updateProgress(100, 100, '完成');
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
            
            this.updateProgress(processedCount, total, `处理中 ${processedCount}/${total}`);
            
            let errorPage = 0;
            let confirmTaskList = [];
            
            // 获取商品列表 - 始终请求第1页，因为确认后的商品会从待确认列表中移除
            const payload = {
                pageSize: this.PAGE_SIZE,
                pageNum: 1,
                supplierTodoTypeList: [6]
            };
            
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
                            const dataList = result.result?.dataList || [];
                            for (const item of dataList) {
                                const goodsId = item.goodsId;
                                if (goodsId) {
                                    confirmTaskList.push({ goodsId: goodsId });
                                }
                            }
                            break;
                        }
                    }
                    
                    if (retry === this.MAX_RETRY - 1) {
                        errorPage = 1;
                        const reason = `请求第${page}页数据失败`;
                        failReasons[reason] = (failReasons[reason] || 0) + 1;
                    }
                } catch (error) {
                    if (retry === this.MAX_RETRY - 1) {
                        errorPage = 1;
                        const reason = `请求第${page}页数据失败`;
                        failReasons[reason] = (failReasons[reason] || 0) + 1;
                    }
                }
            }
            
            if (errorPage) continue;
            if (confirmTaskList.length === 0) continue;
            
            // 检查是否需要切片处理
            if (maxConfirmCount && maxConfirmCount > 0) {
                const remaining = maxConfirmCount - processedCount;
                if (remaining <= 0) {
                    this.log(`已达到最大确认数 ${maxConfirmCount}，停止处理`);
                    break;
                }
                if (confirmTaskList.length > remaining) {
                    this.log(`当前页${confirmTaskList.length}条，剩余可确认${remaining}条，进行切片`);
                    confirmTaskList = confirmTaskList.slice(0, remaining);
                }
            }
            
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
                        /* DEBUG_START: 调试代码 - 输出batchSupplierConfirm接口原始响应 */
                        // this.log(`[调试] batchSupplierConfirm原始响应: ${JSON.stringify(result)}`);
                        /* DEBUG_END */
                        if (result.success) {
                            const failList = result.result?.failedDetails || [];
                            if (failList.length > 0) {
                                successCount += confirmTaskList.length - failList.length;
                                for (const failItem of failList) {
                                    const reason = failItem.errorMsg || '接口返回未知错误';
                                    failReasons[reason] = (failReasons[reason] || 0) + 1;
                                }
                                // 有部分失败时输出详细响应
                                this.log(`部分失败响应: ${JSON.stringify(result)}`);
                            } else {
                                successCount += confirmTaskList.length;
                            }
                            processedCount += confirmTaskList.length;
                            break;
                        } else {
                            // 仅在最后一次重试失败时输出
                            if (retry === this.MAX_RETRY - 1) {
                                this.log(`确认失败响应: ${JSON.stringify(result)}`);
                            }
                        }
                    } else {
                        // 仅在最后一次重试失败时输出
                        if (retry === this.MAX_RETRY - 1) {
                            try {
                                const jsonResponse = await response.json();
                                this.log(`确认失败响应: ${JSON.stringify(jsonResponse)}`);
                            } catch {
                                const textResponse = await response.text();
                                this.log(`确认失败响应(HTTP ${response.status}): ${textResponse}`);
                            }
                        }
                    }
                    
                    if (retry === this.MAX_RETRY - 1) {
                        errorPage = 1;
                        const reason = `提交确认失败`;
                        failReasons[reason] = (failReasons[reason] || 0) + confirmTaskList.length;
                    }
                } catch (error) {
                    if (retry === this.MAX_RETRY - 1) {
                        errorPage = 1;
                        const reason = `提交确认请求失败`;
                        failReasons[reason] = (failReasons[reason] || 0) + confirmTaskList.length;
                        this.log(`失败异常: ${error.message}`);
                    }
                }
            }
        }
        
        this.updateProgress(100, 100, '完成');
        
        // 输出结果
        this.log(`成功确认 ${successCount}/${total} 个商品`);
        if (Object.keys(failReasons).length > 0) {
            const reasonStrings = Object.entries(failReasons)
                .map(([reason, count]) => `${reason}: ${count}`)
                .join(', ');
            this.log(`失败原因: ${reasonStrings}`);
        }
        
        return {
            success: true,
            successCount: successCount,
            total: total,
            failReasons: failReasons
        };
    }
};
