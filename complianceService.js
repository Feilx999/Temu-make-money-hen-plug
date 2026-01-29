const ComplianceService = {
    COMPLIANCE_BASE_URL: "https://agentseller.temu.com/ms/bg-flux-ms/compliance_property",
    REAL_PHOTO_URL: "https://agentseller.temu.com/api/flash/real_picture/batch_upload",
    
    logCallback: null,
    progressCallback: null,
    complianceLogs: [],
    
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
            const percent = total > 0 ? parseFloat(((current / total) * 100).toFixed(2)) : 0;
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
    
    // 查询SPU的合规任务列表
    async queryComplianceTasks(spuList, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/page_query`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    page_num: 1,
                    page_size: 50,
                    type: 2,
                    spu_id_list: spuList
                })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, data: data.result?.data || [] };
            }
            this.addLog(`[合规] 失败响应: ${JSON.stringify(data)}`);
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            this.addLog(`[合规] 失败异常: ${e.message}`);
            return { success: false, message: e.message };
        }
    },
    
    // 查询SPU的合规详情
    async queryComplianceDetail(queryItem, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/query_detail`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(queryItem)
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, data: data.result || {} };
            }
            this.addLog(`[合规] 失败响应: ${JSON.stringify(data)}`);
            return { success: false, message: data.error_msg || '查询详情失败' };
        } catch (e) {
            this.addLog(`[合规] 失败异常: ${e.message}`);
            return { success: false, message: e.message };
        }
    },
    
    // 从SPU获取合规模板
    async getComplianceTemplateFromSpu(spuId, mallid, sellerTemp) {
        this.addLog(`[合规] 正在获取SPU ${spuId} 的合规模板...`);
        
        // 1. 查询SPU任务列表
        const queryResult = await this.queryComplianceTasks([spuId], mallid, sellerTemp);
        if (!queryResult.success || queryResult.data.length === 0) {
            return { success: false, message: '未找到合规任务' };
        }
        
        const item = queryResult.data[0];
        const catId = item.cat_id;
        const catName = item.cat_name || '';  // 从API响应中获取类目名
        
        const waitTaskList = (item.wait_task_dtolist || []).map(t => ({
            task_type: t.task_type,
            task_status: t.status,
            task_name: t.task_name || ''
        }));
        
        // 2. 查询详情
        const detailQuery = {
            cat_id: catId,
            cat_name: catName,
            spu_id: item.spu_id,
            goods_id: item.goods_id,
            wait_task_list: waitTaskList
        };
        
        const detailResult = await this.queryComplianceDetail(detailQuery, mallid, sellerTemp);
        if (!detailResult.success) {
            return { success: false, message: detailResult.message };
        }
        
        // 3. 解析模板
        const templateList = detailResult.data.template_list || [];
        const typeNameMap = {};
        waitTaskList.forEach(t => {
            if (t.task_name) {
                typeNameMap[t.task_type] = t.task_name;
            }
        });
        
        // 为每个模板添加task_name
        const enrichedTemplates = templateList.map(t => ({
            ...t,
            task_name: typeNameMap[t.task_type] || t.task_name || `任务${t.task_type}`
        }));
        
        // 4. 获取实拍图数据
        const realPictureList = await this.getRealPictureData([spuId], mallid, sellerTemp);
        
        return {
            success: true,
            data: {
                mall_id: mallid,
                cat_id: catId,
                cat_name: catName,
                input_spu: [spuId],
                template_list: enrichedTemplates,
                real_picture_info_list: realPictureList
            }
        };
    },
    
    // 获取实拍图数据
    async getRealPictureData(spuList, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch("https://agentseller.temu.com/api/flash/real_picture/list", {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    page: 1,
                    page_size: 50,
                    spu_id_list: spuList.map(s => String(s))
                })
            });
            
            const data = await response.json();
            if (data.success && data.result?.items?.length > 0) {
                const item = data.result.items[0];
                const labelList = item.label_image_list || [];
                
                if (labelList.length === 0) return [];
                
                // 解析实拍图数据
                return this.parseRealPictureData(labelList);
            }
            return [];
        } catch (e) {
            console.error('获取实拍图失败:', e);
            return [];
        }
    },
    
    // 解析实拍图数据
    parseRealPictureData(labelList) {
        if (!labelList || labelList.length === 0) return [];
        
        // 按position分组
        const positionMap = {};
        for (const item of labelList) {
            const pos = item.position;
            if (!positionMap[pos]) {
                positionMap[pos] = [];
            }
            positionMap[pos].push({
                image_url: item.image,
                position_type: item.position_type
            });
        }
        
        // 构建real_picture_info_list
        const result = [];
        const positions = Object.keys(positionMap).map(Number).sort((a, b) => a - b);
        
        for (const pos of positions) {
            result.push({
                position: pos,
                is_same_sku: 1,
                sku_photo_info_list: [{
                    sku_id: null,
                    image_list: positionMap[pos]
                }]
            });
        }
        
        return result;
    },
    
    // 查询待处理的SPU列表
    async queryPendingSpuList(catId, taskTypes, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/page_query`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    page_num: 1,
                    page_size: 100,
                    type: 2,
                    task_status_list: [2],
                    cat_ids: [catId],
                    query_type: 2,
                    task_type_list: taskTypes
                })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, data: data.result?.data || [], total: data.result?.total || 0 };
            }
            this.addLog(`[合规] 失败响应: ${JSON.stringify(data)}`);
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            this.addLog(`[合规] 失败异常: ${e.message}`);
            return { success: false, message: e.message };
        }
    },
    
    // 批量提交合规任务
    async batchEditCompliance(goodInfoList, template, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/batch_edit_compliance`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    good_info_list: goodInfoList,
                    confirm_type: 4,
                    template_edit_request: template,
                    batch_upload_task_type: 1
                })
            });
            
            const data = await response.json();
            if (data.success) {
                const result = data.result || {};
                return {
                    success: true,
                    totalSuccess: result.total_success || 0,
                    totalFail: result.total_fail || 0
                };
            }
            this.addLog(`[合规] 失败响应: ${JSON.stringify(data)}`);
            return { success: false, message: data.error_msg || '提交失败' };
        } catch (e) {
            this.addLog(`[合规] 失败异常: ${e.message}`);
            return { success: false, message: e.message };
        }
    },
    
    // 批量上传实拍图
    async batchUploadRealPicture(spuIds, catId, realPictureInfoList, mallid, sellerTemp) {
        if (!realPictureInfoList || realPictureInfoList.length === 0) {
            return { success: true, total: 0, message: '无实拍图' };
        }
        
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        // 构建上传图片列表
        const uploadImageList = [];
        for (const pos of realPictureInfoList) {
            const position = pos.position;
            for (const skuPhoto of (pos.sku_photo_info_list || [])) {
                for (const img of (skuPhoto.image_list || [])) {
                    uploadImageList.push({
                        position: position,
                        position_type: img.position_type,
                        image: img.image_url
                    });
                }
            }
        }
        
        if (uploadImageList.length === 0) {
            return { success: true, total: 0, message: '无实拍图' };
        }
        
        try {
            const response = await fetch(this.REAL_PHOTO_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    spu_ids: spuIds.map(id => parseInt(id)),
                    confirm_type: 4,
                    batch_upload_task_type: 1,
                    upload_image_list: uploadImageList,
                    cate_id_list: [catId]
                })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, total: data.result?.total || 0 };
            }
            this.addLog(`[合规] 失败响应: ${JSON.stringify(data)}`);
            return { success: false, message: data.error_msg || '上传失败' };
        } catch (e) {
            this.addLog(`[合规] 失败异常: ${e.message}`);
            return { success: false, message: e.message };
        }
    },
    
    // 执行合规任务
    async executeComplianceTask(mallid, sellerTemp, shopName) {
        this.complianceLogs = [];
        
        try {
            // 获取保存的合规模板
            const stored = await chrome.storage.local.get('complianceTemplateList');
            const templates = stored.complianceTemplateList || [];
            
            if (templates.length === 0) {
                this.addLog('[合规] 无可用模板');
                return { success: false, message: '无可用模板' };
            }
            
            this.addLog('[合规] 开始执行合规任务...');
            this.updateProgress(0, 100, '准备中...');
            
            let totalSuccess = 0;
            let totalFail = 0;
            let processedTemplates = 0;
            
            for (const templateConfig of templates) {
                const catId = templateConfig.cat_id;
                const templateList = templateConfig.template_list || [];
                const realPictureInfoList = templateConfig.real_picture_info_list || [];
                
                // 过滤出已启用的任务(task_status=3)
                const enabledTemplates = templateList.filter(t => t.task_status === 3);
                const taskTypes = enabledTemplates.map(t => t.task_type);
                
                if (taskTypes.length === 0) {
                    processedTemplates++;
                    continue;
                }
                
                this.addLog(`[合规] 处理类目 ${catId}，任务类型: ${taskTypes.length}个`);
                
                // 查询待处理的SPU
                const pendingResult = await this.queryPendingSpuList(catId, taskTypes, mallid, sellerTemp);
                if (!pendingResult.success || pendingResult.data.length === 0) {
                    this.addLog(`[合规] 类目 ${catId} 无待处理SPU`);
                    processedTemplates++;
                    this.updateProgress(processedTemplates, templates.length, `处理中 ${processedTemplates}/${templates.length}`);
                    continue;
                }
                
                const spuTasks = pendingResult.data.map(item => ({
                    spu_id: item.spu_id,
                    cat_id: item.cat_id,
                    goods_id: item.goods_id,
                    wait_task_dtolist: (item.wait_task_dtolist || []).map(t => ({
                        task_id: t.task_id,
                        task_type: t.task_type
                    }))
                }));
                
                const spuIds = spuTasks.map(t => t.spu_id);
                this.addLog(`[合规] 找到 ${spuIds.length} 个待处理SPU`);
                
                // 处理常规任务（排除识别码任务61）
                const normalTypes = taskTypes.filter(t => t !== 61);
                
                for (const taskType of normalTypes) {
                    const template = enabledTemplates.find(t => t.task_type === taskType);
                    if (!template) continue;
                    
                    const taskName = template.task_name || `任务${taskType}`;
                    
                    // 构建good_info_list
                    const goodInfoList = [];
                    for (const task of spuTasks) {
                        const waitItem = task.wait_task_dtolist.find(w => w.task_type === taskType);
                        if (waitItem) {
                            goodInfoList.push({
                                spu_id: task.spu_id,
                                goods_id: task.goods_id,
                                cat_id: task.cat_id,
                                task_id: waitItem.task_id
                            });
                        }
                    }
                    
                    if (goodInfoList.length === 0) continue;
                    
                    const result = await this.batchEditCompliance(goodInfoList, template, mallid, sellerTemp);
                    
                    if (result.success) {
                        totalSuccess += result.totalSuccess;
                        totalFail += result.totalFail;
                        this.complianceLogs.push(`[${taskName}] 成功: ${result.totalSuccess}, 失败: ${result.totalFail}`);
                        this.addLog(`[合规] [${taskName}] 成功: ${result.totalSuccess}, 失败: ${result.totalFail}`);
                    } else {
                        totalFail += goodInfoList.length;
                        this.complianceLogs.push(`[${taskName}] 提交失败: ${result.message}`);
                        this.addLog(`[合规] [${taskName}] 提交失败: ${result.message}`);
                    }
                }
                
                // 处理实拍图任务
                if (realPictureInfoList.length > 0) {
                    const realResult = await this.batchUploadRealPicture(spuIds, catId, realPictureInfoList, mallid, sellerTemp);
                    if (realResult.success && realResult.total > 0) {
                        totalSuccess += realResult.total;
                        this.complianceLogs.push(`[实拍图] 成功: ${realResult.total}`);
                        this.addLog(`[合规] [实拍图] 成功: ${realResult.total}`);
                    }
                }
                
                processedTemplates++;
                this.updateProgress(processedTemplates, templates.length, `处理中 ${processedTemplates}/${templates.length}`);
            }
            
            this.addLog(`[合规] 合规任务完成，成功: ${totalSuccess}, 失败: ${totalFail}`);
            this.updateProgress(100, 100, '完成');
            
            return { success: true, totalSuccess, totalFail, logs: this.complianceLogs };
        } catch (e) {
            this.addLog(`[合规] 任务失败: ${e.message}`);
            this.updateProgress(0, 100, '失败');
            return { success: false, message: e.message, logs: this.complianceLogs };
        }
    }
};
