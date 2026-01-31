const ComplianceService = {
    COMPLIANCE_BASE_URL: "https://agentseller.temu.com/ms/bg-flux-ms/compliance_property",
    REAL_PHOTO_URL: "https://agentseller.temu.com/api/flash/real_picture/batch_upload",
    REAL_PHOTO_LIST_URL: "https://agentseller.temu.com/api/flash/real_picture/list",
    FILE_UPLOAD_URL: "https://agentseller.temu.com/api/galerie/general_file",
    
    // 分页配置
    PAGE_SIZE: 50,
    MAX_RETRY: 3,
    
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
        let enrichedTemplates = templateList.map(t => ({
            ...t,
            task_name: typeNameMap[t.task_type] || t.task_name || `任务${t.task_type}`
        }));
        
        // 3.5 转换task_type=166的模板结构
        enrichedTemplates = this.transformTaskType166(enrichedTemplates);
        
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
    
    // 解析实拍图数据 - 确保数值类型正确
    parseRealPictureData(labelList) {
        if (!labelList || labelList.length === 0) return [];
        
        // 按position分组
        const positionMap = {};
        for (const item of labelList) {
            const pos = Number(item.position);
            if (!positionMap[pos]) {
                positionMap[pos] = [];
            }
            positionMap[pos].push({
                image_url: item.image,
                position_type: Number(item.position_type)
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
    
    // 转换task_type=166的模板结构
    // sku_group_multi_detail_list -> sku_multi_detail
    transformTaskType166(templateList) {
        for (const item of templateList) {
            if (item.task_type === 166 && item.sku_group_multi_detail_list) {
                const skuGroupList = item.sku_group_multi_detail_list;
                if (skuGroupList && skuGroupList.length > 0) {
                    // 提取第一个元素的sku_multi_detail
                    const skuMultiDetail = skuGroupList[0].sku_multi_detail || [];
                    // 替换结构
                    item.sku_multi_detail = skuMultiDetail;
                    // 删除原字段
                    delete item.sku_group_multi_detail_list;
                }
            }
        }
        return templateList;
    },
    
    // 查询待处理的SPU列表（支持分页）
    async queryPendingSpuList(catId, taskTypes, mallid, sellerTemp, pageNum = 1) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        // 确保数值类型正确
        const numericCatId = typeof catId === 'string' ? parseInt(catId, 10) : Number(catId);
        const numericTaskTypes = taskTypes.map(t => typeof t === 'string' ? parseInt(t, 10) : Number(t));
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/page_query`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    page_num: pageNum,
                    page_size: this.PAGE_SIZE,
                    type: 2,
                    task_status_list: [2],
                    cat_ids: [numericCatId],
                    query_type: 2,
                    task_type_list: numericTaskTypes
                })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, data: data.result?.data || [], total: data.result?.total || 0 };
            }
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 查询需要上传实拍图的SPU列表（使用独立API，支持分页）
    async queryRealPhotoSpuList(catId, mallid, sellerTemp, page = 1) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        const numericCatId = typeof catId === 'string' ? parseInt(catId, 10) : Number(catId);
        
        try {
            const response = await fetch(this.REAL_PHOTO_LIST_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    page: page,
                    page_size: this.PAGE_SIZE,
                    cate_id_list: [numericCatId],
                    rapid_screen_status_list: [1]  // 状态1表示需要上传
                })
            });
            
            const data = await response.json();
            if (data.success !== false) { 
                const result = data.result || {};
                const items = result.items || [];
                const spuList = items.map(item => item.spu_id).filter(id => id);
                return { success: true, data: spuList, total: result.total || 0 };
            }
            return { success: false, message: data.error_msg || '查询失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 批量提交合规任务
    async batchEditCompliance(goodInfoList, template, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        // 确保good_info_list中的数值类型正确 - 严格按照Python参考代码
        const normalizedGoodInfoList = goodInfoList.map(item => ({
            spu_id: item.spu_id,
            goods_id: item.goods_id,
            cat_id: typeof item.cat_id === 'string' ? parseInt(item.cat_id, 10) : Number(item.cat_id),
            task_id: item.task_id
        }));
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/batch_edit_compliance`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    good_info_list: normalizedGoodInfoList,
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
    
    // 获取文件上传签名
    async getUploadSignature(mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/signature`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ tag: "excellence-private" })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, sign: data.result };
            }
            return { success: false, message: data.error_msg || '获取签名失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 上传识别码Excel文件
    async uploadGoodsCodeFile(fileBlob, fileName, sign, mallid, sellerTemp) {
        try {
            // 读取文件内容
            const arrayBuffer = await fileBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // 计算MD5
            const md5Hash = this.md5(uint8Array);
            
            // 编码文件名
            const encodedFileName = encodeURIComponent(fileName);
            
            // 构建FormData - 严格按照Python代码的方式
            const formData = new FormData();
            
            // 文件必须使用正确的MIME类型
            const xlsxBlob = new Blob([arrayBuffer], { 
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
            });
            formData.append('file', xlsxBlob, fileName);
            formData.append('content_type', 'application/octet-stream');
            formData.append('content_disposition', `inline; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
            formData.append('content_md5', md5Hash);
            formData.append('sign', sign);
            
            const response = await fetch(`${this.FILE_UPLOAD_URL}?sdk_version=js-0.0.40&tag_name=excellence-private`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            
            const data = await response.json();
            // this.addLog(`[合规] 文件上传响应: ${JSON.stringify(data)}`);
            
            if (data.url) {
                return { success: true, url: data.url };
            }
            return { success: false, message: data.error_msg || '文件上传失败' };
        } catch (e) {
            this.addLog(`[合规] 文件上传异常: ${e.message}`);
            return { success: false, message: e.message };
        }
    },
    
    // MD5哈希函数实现
    md5(input) {
        // 将输入转换为字节数组
        let bytes;
        if (input instanceof Uint8Array) {
            bytes = input;
        } else if (typeof input === 'string') {
            bytes = new TextEncoder().encode(input);
        } else {
            bytes = new Uint8Array(input);
        }
        
        // MD5常量
        const K = new Uint32Array([
            0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
            0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
            0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
            0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
            0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
            0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
            0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
            0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
        ]);
        const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
        
        // 填充消息
        const bitLen = bytes.length * 8;
        const padLen = (bytes.length % 64 < 56) ? (56 - bytes.length % 64) : (120 - bytes.length % 64);
        const padded = new Uint8Array(bytes.length + padLen + 8);
        padded.set(bytes);
        padded[bytes.length] = 0x80;
        
        // 添加长度（小端序）
        const view = new DataView(padded.buffer, padded.length - 8);
        view.setUint32(0, bitLen >>> 0, true);
        view.setUint32(4, Math.floor(bitLen / 0x100000000), true);
        
        // 初始化状态
        let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
        
        // 处理每个64字节块
        for (let i = 0; i < padded.length; i += 64) {
            const M = new Uint32Array(16);
            for (let j = 0; j < 16; j++) {
                M[j] = padded[i + j * 4] | (padded[i + j * 4 + 1] << 8) | (padded[i + j * 4 + 2] << 16) | (padded[i + j * 4 + 3] << 24);
            }
            
            let A = a0, B = b0, C = c0, D = d0;
            
            for (let j = 0; j < 64; j++) {
                let F, g;
                if (j < 16) { F = (B & C) | (~B & D); g = j; }
                else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
                else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
                else { F = C ^ (B | ~D); g = (7 * j) % 16; }
                
                F = (F + A + K[j] + M[g]) >>> 0;
                const s = S[Math.floor(j / 16) * 4 + (j % 4)];
                A = D; D = C; C = B;
                B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
            }
            
            a0 = (a0 + A) >>> 0;
            b0 = (b0 + B) >>> 0;
            c0 = (c0 + C) >>> 0;
            d0 = (d0 + D) >>> 0;
        }
        
        // 转换为16进制字符串（小端序）
        const toHex = n => {
            let hex = '';
            for (let i = 0; i < 4; i++) {
                hex += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
            }
            return hex;
        };
        
        return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
    },
    
    // 提交识别码上传任务
    async submitGoodsCodeUpload(fileUrl, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/upload/submit`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ url: fileUrl })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true, taskId: data.result?.task_id };
            }
            return { success: false, message: data.error_msg || '提交任务失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 查询识别码上传任务状态
    async queryGoodsCodeUploadStatus(taskId, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/upload/query`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ task_id: taskId })
            });
            
            const data = await response.json();
            if (data.success) {
                const uploadResult = data.result?.upload_result || {};
                return { success: true, status: uploadResult.status };
            }
            return { success: false, message: data.error_msg || '查询状态失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 确认识别码上传结果
    async confirmGoodsCodeUpload(taskId, mallid, sellerTemp) {
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        try {
            const response = await fetch(`${this.COMPLIANCE_BASE_URL}/upload/confirm`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ task_id: taskId, confirm_type: 1 })
            });
            
            const data = await response.json();
            if (data.success) {
                return { success: true };
            }
            return { success: false, message: data.error_msg || '确认失败' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    },
    
    // 从模板中提取识别码
    extractGoodsCodeFromTemplate(template) {
        const inputText = template.input_text || {};
        for (const propId in inputText) {
            const propData = inputText[propId];
            const multiInputs = propData.multi_line_inputs || [];
            if (multiInputs.length > 0) {
                const codes = multiInputs
                    .filter(item => item.name)
                    .map(item => item.name);
                if (codes.length > 0) {
                    return codes.join(';');
                }
            }
        }
        return null;
    },
    
    // 批量上传识别码（完整流程）
    async batchUploadGoodsCode(spuIds, template, mallid, sellerTemp) {
        // 1. 提取识别码
        const goodsCode = this.extractGoodsCodeFromTemplate(template);
        if (!goodsCode) {
            return { success: false, message: '未找到识别码配置' };
        }
        
        // this.addLog(`[合规] 识别码: ${goodsCode}`);
        
        // 2. 获取签名
        const signResult = await this.getUploadSignature(mallid, sellerTemp);
        if (!signResult.success) {
            return { success: false, message: signResult.message };
        }
        
        // this.addLog(`[合规] 获取签名成功`);
        
        // 3. 创建Excel文件
        const fileBlob = await this.createGoodsCodeExcelFromTemplate(spuIds, goodsCode);
        const fileName = `${mallid}_goods_code_${Date.now()}.xlsx`;
        
        // 4. 上传文件
        const uploadResult = await this.uploadGoodsCodeFile(fileBlob, fileName, signResult.sign, mallid, sellerTemp);
        if (!uploadResult.success) {
            return { success: false, message: uploadResult.message };
        }
        
        // this.addLog(`[合规] 文件上传成功`);
        
        // 5. 提交任务
        const submitResult = await this.submitGoodsCodeUpload(uploadResult.url, mallid, sellerTemp);
        if (!submitResult.success) {
            return { success: false, message: submitResult.message };
        }
        
        const taskId = submitResult.taskId;
        // this.addLog(`[合规] 任务已提交，task_id: ${taskId}`);
        
        // 6. 轮询查询状态（最多45秒）
        let success = false;
        for (let i = 0; i < 45; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const statusResult = await this.queryGoodsCodeUploadStatus(taskId, mallid, sellerTemp);
            if (statusResult.success && statusResult.status === 20) {
                // 状态20表示完成
                // this.addLog(`[合规] 解析完成 (耗时 ${i + 1} 秒)`);
                
                // 7. 确认结果
                const confirmResult = await this.confirmGoodsCodeUpload(taskId, mallid, sellerTemp);
                if (confirmResult.success) {
                    // this.addLog(`[合规] 识别码上传成功: ${spuIds.length} 个SPU`);
                    success = true;
                    break;
                } else {
                    return { success: false, message: confirmResult.message };
                }
            }
        }
        
        if (!success) {
            return { success: false, message: '处理超时' };
        }
        
        return { success: true, total: spuIds.length };
    },
    
    // 使用模板文件创建识别码Excel
    async createGoodsCodeExcelFromTemplate(spuIds, goodsCode) {
        // 检查XLSX库是否可用
        const XLSX = window.XLSX || (typeof self !== 'undefined' ? self.XLSX : null);
        
        if (!XLSX) {
            this.addLog('[合规] 错误: SheetJS (XLSX) 库未加载');
            throw new Error('SheetJS库未加载，无法创建Excel文件');
        }
        
        // this.addLog(`[合规] 创建Excel文件: ${spuIds.length} 个SPU`);
        
        // 尝试加载模板文件
        try {
            const templateUrl = chrome.runtime.getURL('识别码上传模板.xlsx');
            const response = await fetch(templateUrl);
            
            if (response.ok) {
                const templateBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(templateBuffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                // 添加数据行（从第2行开始，第1行是表头）
                for (let i = 0; i < spuIds.length; i++) {
                    const row = i + 2;
                    worksheet[XLSX.utils.encode_cell({r: row - 1, c: 0})] = { t: 'n', v: spuIds[i] };
                    worksheet[XLSX.utils.encode_cell({r: row - 1, c: 1})] = { t: 's', v: goodsCode };
                    worksheet[XLSX.utils.encode_cell({r: row - 1, c: 2})] = { t: 's', v: '更新' };
                }
                
                // 更新范围
                worksheet['!ref'] = `A1:C${spuIds.length + 1}`;
                
                // 导出为Blob
                const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
                // this.addLog('[合规] 使用模板创建Excel成功');
                return new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            }
        } catch (e) {
            this.addLog(`[合规] 模板加载失败: ${e.message}，使用动态创建`);
        }
        
        // 如果模板不可用，动态创建Excel
        const wsData = [
            ['SPU ID', '识别码', '操作类型'],
            ...spuIds.map(spuId => [spuId, goodsCode, '更新'])
        ];
        
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        
        const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        this.addLog('[合规] 动态创建Excel成功');
        return new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    },
    
    // 解析SPU数据列表 - 严格按照Python的parse_spu_tasks函数
    parseSpuTasks(dataList) {
        const spuTasks = [];
        for (const item of dataList) {
            spuTasks.push({
                spu_id: item.spu_id,
                cat_id: item.cat_id,
                goods_id: item.goods_id,
                wait_task_dtolist: (item.wait_task_dtolist || []).map(t => ({
                    task_id: t.task_id,
                    task_type: t.task_type
                }))
            });
        }
        return spuTasks;
    },
    
    // 提交常规合规信息 - 严格按照Python的submit_normal_compliance函数
    async submitNormalCompliance(spuTasks, taskType, template, mallid, sellerTemp) {
        const taskName = template.task_name || `task_type=${taskType}`;
        
        // 构建当前任务类型的good_info_list
        const goodInfoList = [];
        for (const task of spuTasks) {
            let taskId = null;
            for (const waitItem of task.wait_task_dtolist) {
                if (waitItem.task_type === taskType) {
                    taskId = waitItem.task_id;
                    break;
                }
            }
            
            if (taskId) {
                goodInfoList.push({
                    spu_id: task.spu_id,
                    goods_id: task.goods_id,
                    cat_id: task.cat_id,
                    task_id: taskId
                });
            }
        }
        
        if (goodInfoList.length === 0) {
            return { successCount: 0, failCount: 0 };
        }
        
        // 调用批量提交API
        const result = await this.batchEditCompliance(goodInfoList, template, mallid, sellerTemp);
        
        if (result.success) {
            return { 
                successCount: result.totalSuccess || 0, 
                failCount: result.totalFail || 0,
                taskName 
            };
        } else {
            throw new Error(result.message || '提交失败');
        }
    },
    
    // 提交实拍图 - 严格按照Python的submit_real_photo函数
    async submitRealPhoto(spuIds, uploadImageList, catId, mallid, sellerTemp) {
        if (!uploadImageList || uploadImageList.length === 0) {
            throw new Error('没有可上传的实拍图');
        }
        
        const headers = this.getHeaders(mallid);
        headers["cookie"] = `seller_temp=${sellerTemp}`;
        
        // 确保spu_ids为整数数组 - 严格按照Python代码
        const numericSpuIds = spuIds.map(id => {
            const num = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(num) ? id : num;
        });
        const numericCatId = typeof catId === 'string' ? parseInt(catId, 10) : Number(catId);
        
        // 构建请求数据 - 严格按照Python代码的字段顺序和格式
        const submitData = {
            spu_ids: numericSpuIds,
            confirm_type: 4,
            batch_upload_task_type: 1,
            upload_image_list: uploadImageList,
            cate_id_list: [numericCatId]
        };
        
        try {
            const response = await fetch(this.REAL_PHOTO_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(submitData)
            });
            
            const data = await response.json();
            if (data.success) {
                const result = data.result || {};
                const total = result.total || 0;
                const failCount = total < spuIds.length ? spuIds.length - total : 0;
                return { successCount: total, failCount: failCount };
            } else {
                throw new Error(data.error_msg || '实拍图上传失败');
            }
        } catch (e) {
            throw new Error(e.message || '实拍图上传失败');
        }
    },
    
    // 处理一页的常规合规信息和商品识别码 - 严格按照Python的process_compliance_page函数
    async processCompliancePage(dataList, taskTypeTemplates, normalTypes, hasGoodsCode, mallId, catId, mallid, sellerTemp) {
        const pageStats = {
            normal_success: 0,
            normal_fail: 0,
            goods_code_success: 0,
            goods_code_fail: 0
        };
        
        const spuTasks = this.parseSpuTasks(dataList);
        const spuIds = spuTasks.map(task => task.spu_id);
        
        // 处理常规任务
        if (normalTypes && normalTypes.length > 0) {
            for (const taskType of normalTypes) {
                const template = taskTypeTemplates[taskType];
                if (!template) continue;
                
                const taskName = template.task_name || `task_type=${taskType}`;
                
                // 带重试的提交
                for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                    try {
                        const result = await this.submitNormalCompliance(spuTasks, taskType, template, mallid, sellerTemp);
                        pageStats.normal_success += result.successCount;
                        pageStats.normal_fail += result.failCount;
                        if (result.successCount > 0) {
                            this.addLog(`    ✅ [${taskName}] 成功: ${result.successCount}, 失败: ${result.failCount}`);
                        }
                        break;
                    } catch (e) {
                        if (retry === this.MAX_RETRY - 1) {
                            this.addLog(`    ❌ [${taskName}] 提交失败(重试${this.MAX_RETRY}次后): ${e.message}`);
                            // 统计该任务类型匹配的SPU数量为失败
                            let matchingCount = 0;
                            for (const task of spuTasks) {
                                for (const waitItem of task.wait_task_dtolist) {
                                    if (waitItem.task_type === taskType) {
                                        matchingCount++;
                                        break;
                                    }
                                }
                            }
                            pageStats.normal_fail += matchingCount;
                        }
                    }
                }
            }
        }
        
        // 处理识别码任务
        if (hasGoodsCode && spuIds.length > 0) {
            const template = taskTypeTemplates[61];
            
            // 带重试的提交
            for (let retry = 0; retry < this.MAX_RETRY; retry++) {
                try {
                    const result = await this.batchUploadGoodsCode(spuIds, template, mallid, sellerTemp);
                    if (result.success) {
                        pageStats.goods_code_success += result.total || spuIds.length;
                        this.addLog(`    ✅ [识别码] 成功: ${result.total || spuIds.length}`);
                    } else {
                        throw new Error(result.message);
                    }
                    break;
                } catch (e) {
                    if (retry === this.MAX_RETRY - 1) {
                        this.addLog(`    ❌ [识别码] 提交失败(重试${this.MAX_RETRY}次后): ${e.message}`);
                        pageStats.goods_code_fail += spuIds.length;
                    }
                }
            }
        }
        
        return pageStats;
    },
    
    // 处理一页的实拍图上传 - 严格按照Python的process_real_photo_page函数
    async processRealPhotoPage(spuList, uploadImageList, catId, mallid, sellerTemp) {
        const pageStats = {
            real_photo_success: 0,
            real_photo_fail: 0
        };
        
        if (!spuList || spuList.length === 0) {
            return pageStats;
        }
        
        // 带重试的提交
        for (let retry = 0; retry < this.MAX_RETRY; retry++) {
            try {
                const result = await this.submitRealPhoto(spuList, uploadImageList, catId, mallid, sellerTemp);
                pageStats.real_photo_success += result.successCount;
                pageStats.real_photo_fail += result.failCount;
                if (result.successCount > 0) {
                    this.addLog(`    ✅ [实拍图] 成功: ${result.successCount}, 失败: ${result.failCount}`);
                }
                break;
            } catch (e) {
                if (retry === this.MAX_RETRY - 1) {
                    this.addLog(`    ❌ [实拍图] 提交失败(重试${this.MAX_RETRY}次后): ${e.message}`);
                    pageStats.real_photo_fail += spuList.length;
                }
            }
        }
        
        return pageStats;
    },
    
    // 执行合规任务 - 严格按照Python主流程实现
    async executeComplianceTask(mallid, sellerTemp, shopName) {
        this.complianceLogs = [];
        
        // 统计数据 - 严格按照Python的stats结构
        const stats = {
            total_success: 0,
            total_fail: 0,
            normal_success: 0,
            normal_fail: 0,
            goods_code_success: 0,
            goods_code_fail: 0,
            real_photo_success: 0,
            real_photo_fail: 0
        };
        
        try {
            // 获取保存的合规模板
            const stored = await chrome.storage.local.get('complianceTemplateList');
            const templateData = stored.complianceTemplateList || [];
            
            if (templateData.length === 0) {
                this.addLog('[合规] 无可用模板');
                return { success: false, message: '无可用模板' };
            }
            
            this.updateProgress(0, 100, '准备中...');
            
            // ==================== 遍历模板数据 ====================
            for (let templateIndex = 0; templateIndex < templateData.length; templateIndex++) {
                const templateConfig = templateData[templateIndex];
                
                this.addLog(`处理模板 ${templateIndex + 1}/${templateData.length}`);
                
                // 解析当前 template_config 的数据 - 严格按照Python代码
                const mallId = templateConfig.mall_id || mallid;
                const catId = templateConfig.cat_id;
                const inputSpuList = templateConfig.input_spu || [];
                const templateList = templateConfig.template_list || [];
                const realPictureInfoList = templateConfig.real_picture_info_list || [];
                
                // 解析启用的任务类型 (task_status=3表示已启用) - 严格按照Python代码
                const taskTypeTemplates = {};
                for (const template of templateList) {
                    const taskType = template.task_type;
                    const taskStatus = template.task_status;
                    if (taskStatus === 3 && taskType) {
                        taskTypeTemplates[taskType] = template;
                    }
                }
                
                this.addLog(`mall_id=${mallId}, cat_id=${catId}`);
                // this.addLog(`启用的任务类型: ${Object.keys(taskTypeTemplates).join(', ')}`);
                
                // 分离常规任务和特殊任务 - 严格按照Python代码
                const normalTypes = Object.keys(taskTypeTemplates).map(Number).filter(t => t !== 61);
                const hasGoodsCode = 61 in taskTypeTemplates || taskTypeTemplates[61] !== undefined;
                const hasRealPhoto = realPictureInfoList.length > 0;
                
                this.addLog(`任务配置: 常规任务=[${normalTypes.join(',')}], 识别码=${hasGoodsCode ? '是' : '否'}, 实拍图=${hasRealPhoto ? '是' : '否'}`);
                
                // ==================== 处理常规合规信息和商品识别码 ====================
                if (Object.keys(taskTypeTemplates).length > 0) {
                    // 查询首页数据 - 使用所有启用的任务类型
                    const allTaskTypes = Object.keys(taskTypeTemplates).map(Number);
                    
                    try {
                        const queryResult = await this.queryPendingSpuList(catId, allTaskTypes, mallid, sellerTemp, 1);
                        
                        if (!queryResult.success) {
                            this.addLog(`❌ 查询失败: ${queryResult.message}`);
                            continue;
                        }
                        
                        const total = queryResult.total;
                        const firstDataList = queryResult.data;
                        
                        this.addLog(`找到 ${total} 个待处理SPU`);
                        
                        if (total > 0 && firstDataList.length > 0) {
                            // 处理首页数据
                            this.addLog(`  处理第 1 页 (${firstDataList.length} 个SPU)...`);
                            const pageStats = await this.processCompliancePage(
                                firstDataList, taskTypeTemplates, normalTypes, hasGoodsCode, 
                                mallId, catId, mallid, sellerTemp
                            );
                            stats.normal_success += pageStats.normal_success;
                            stats.normal_fail += pageStats.normal_fail;
                            stats.goods_code_success += pageStats.goods_code_success;
                            stats.goods_code_fail += pageStats.goods_code_fail;
                            
                            // 计算总页数
                            const pageCount = Math.ceil(total / this.PAGE_SIZE);
                            
                            // 遍历剩余页数
                            for (let page = 2; page <= pageCount; page++) {
                                try {
                                    const pageQueryResult = await this.queryPendingSpuList(catId, allTaskTypes, mallid, sellerTemp, page);
                                    
                                    if (!pageQueryResult.success) {
                                        this.addLog(`  ❌ 第 ${page} 页查询失败: ${pageQueryResult.message}`);
                                        continue;
                                    }
                                    
                                    const pageDataList = pageQueryResult.data;
                                    
                                    if (pageDataList.length > 0) {
                                        this.addLog(`  处理第 ${page} 页 (${pageDataList.length} 个SPU)...`);
                                        const pageStats = await this.processCompliancePage(
                                            pageDataList, taskTypeTemplates, normalTypes, hasGoodsCode,
                                            mallId, catId, mallid, sellerTemp
                                        );
                                        stats.normal_success += pageStats.normal_success;
                                        stats.normal_fail += pageStats.normal_fail;
                                        stats.goods_code_success += pageStats.goods_code_success;
                                        stats.goods_code_fail += pageStats.goods_code_fail;
                                    }
                                } catch (e) {
                                    this.addLog(`  ❌ 第 ${page} 页处理异常: ${e.message}`);
                                }
                            }
                        } else {
                            this.addLog('  没有需要处理的常规合规信息和商品识别码数据');
                        }
                    } catch (e) {
                        this.addLog(`❌ 查询异常: ${e.message}`);
                    }
                }
                
                // ==================== 处理实拍图任务 ====================
                if (hasRealPhoto) {
                    this.addLog(`[类目 ${catId}] 查询需要上传商品实拍图的SPU...`);
                    
                    // 构建上传图片列表 - 严格按照Python代码的格式
                    const uploadImageList = [];
                    for (const pos of realPictureInfoList) {
                        const position = pos.position;
                        for (const skuPhoto of (pos.sku_photo_info_list || [])) {
                            for (const img of (skuPhoto.image_list || [])) {
                                uploadImageList.push({
                                    position: position,
                                    position_type: img.position_type,
                                    image: img.image_url  // 严格使用image_url字段
                                });
                            }
                        }
                    }
                    
                    if (uploadImageList.length === 0) {
                        this.addLog('  ❌ 没有可上传的实拍图配置');
                        continue;
                    }
                    
                    this.addLog(`  实拍图配置数量: ${uploadImageList.length}`);
                    
                    try {
                        // 查询首页需要上传实拍图的SPU
                        const queryResult = await this.queryRealPhotoSpuList(catId, mallid, sellerTemp, 1);
                        
                        if (!queryResult.success) {
                            this.addLog(`  ❌ 查询失败: ${queryResult.message}`);
                            continue;
                        }
                        
                        const total = queryResult.total;
                        const spuList = queryResult.data;
                        
                        this.addLog(`  找到 ${total} 个待上传实拍图的SPU`);
                        
                        if (total > 0 && spuList.length > 0) {
                            // 处理首页数据
                            this.addLog(`  处理第 1 页 (${spuList.length} 个SPU)...`);
                            const pageStats = await this.processRealPhotoPage(spuList, uploadImageList, catId, mallid, sellerTemp);
                            stats.real_photo_success += pageStats.real_photo_success;
                            stats.real_photo_fail += pageStats.real_photo_fail;
                            
                            // 计算总页数
                            const pageCount = Math.ceil(total / this.PAGE_SIZE);
                            
                            // 遍历剩余页数
                            for (let page = 2; page <= pageCount; page++) {
                                try {
                                    const pageQueryResult = await this.queryRealPhotoSpuList(catId, mallid, sellerTemp, page);
                                    
                                    if (!pageQueryResult.success) {
                                        this.addLog(`  ❌ 第 ${page} 页查询失败: ${pageQueryResult.message}`);
                                        continue;
                                    }
                                    
                                    const pageSpuList = pageQueryResult.data;
                                    
                                    if (pageSpuList.length > 0) {
                                        this.addLog(`  处理第 ${page} 页 (${pageSpuList.length} 个SPU)...`);
                                        const pageStats = await this.processRealPhotoPage(pageSpuList, uploadImageList, catId, mallid, sellerTemp);
                                        stats.real_photo_success += pageStats.real_photo_success;
                                        stats.real_photo_fail += pageStats.real_photo_fail;
                                    }
                                } catch (e) {
                                    this.addLog(`  ❌ 第 ${page} 页处理异常: ${e.message}`);
                                }
                            }
                        } else {
                            this.addLog('  没有需要上传实拍图的SPU');
                        }
                    } catch (e) {
                        this.addLog(`  ❌ 查询异常: ${e.message}`);
                    }
                }
                
                this.updateProgress(templateIndex + 1, templateData.length, `处理中 ${templateIndex + 1}/${templateData.length}`);
            }
            
            // 汇总统计 - 严格按照Python代码
            stats.total_success = stats.normal_success + stats.goods_code_success + stats.real_photo_success;
            stats.total_fail = stats.normal_fail + stats.goods_code_fail + stats.real_photo_fail;
            
            // 输出统计日志 - 严格按照Python代码格式
            this.addLog(`常规任务: 成功 ${stats.normal_success}, 失败 ${stats.normal_fail}`);
            this.addLog(`识别码任务: 成功 ${stats.goods_code_success}, 失败 ${stats.goods_code_fail}`);
            this.addLog(`实拍图任务: 成功 ${stats.real_photo_success}, 失败 ${stats.real_photo_fail}`);
            this.addLog(`总计: 成功 ${stats.total_success}, 失败 ${stats.total_fail}`);
            
            this.updateProgress(100, 100, '完成');
            
            return { 
                success: true, 
                totalSuccess: stats.total_success, 
                totalFail: stats.total_fail, 
                logs: this.complianceLogs,
                stats: stats
            };
        } catch (e) {
            this.addLog(`[合规] 任务失败: ${e.message}`);
            this.updateProgress(0, 100, '失败');
            return { success: false, message: e.message, logs: this.complianceLogs };
        }
    }
};
