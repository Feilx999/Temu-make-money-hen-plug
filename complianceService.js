const ComplianceService = {
    COMPLIANCE_BASE_URL: "https://agentseller.temu.com/ms/bg-flux-ms/compliance_property",
    REAL_PHOTO_URL: "https://agentseller.temu.com/api/flash/real_picture/batch_upload",
    FILE_UPLOAD_URL: "https://agentseller.temu.com/api/galerie/general_file",
    
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
    
    // 创建识别码Excel文件内容（使用xlsx库或简单CSV格式）
    createGoodsCodeExcelBlob(spuIds, goodsCode) {
        // 使用简单的xlsx格式创建文件
        // 参考模板格式：SPU ID, 识别码, 操作类型
        const ExcelJS = window.ExcelJS;
        
        if (ExcelJS) {
            // 如果有ExcelJS库，使用它创建xlsx
            return this.createExcelWithExcelJS(spuIds, goodsCode);
        } else {
            // 否则使用简单的CSV转xlsx方式
            return this.createSimpleExcel(spuIds, goodsCode);
        }
    },
    
    // 使用简单方式创建Excel（基于模板文件）
    async createSimpleExcel(spuIds, goodsCode) {
        // 创建一个简单的xlsx文件
        // 使用SheetJS (xlsx) 库的格式
        const header = ['spu_id', '商品识别码', '操作类型'];
        const rows = spuIds.map(spuId => [spuId, goodsCode, '更新']);
        
        // 构建CSV内容然后转换
        let csvContent = header.join(',') + '\n';
        for (const row of rows) {
            csvContent += row.join(',') + '\n';
        }
        
        // 返回CSV的Blob（后续需要转换为xlsx）
        return new Blob([csvContent], { type: 'text/csv' });
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
                        // 仅在失败数不为0时输出日志
                        if (result.totalFail > 0) {
                            this.addLog(`[合规] [${taskName}] 成功: ${result.totalSuccess}, 失败: ${result.totalFail}`);
                        }
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
                    } else if (!realResult.success) {
                        this.complianceLogs.push(`[实拍图] 失败: ${realResult.message}`);
                        this.addLog(`[合规] [实拍图] 失败: ${realResult.message}`);
                    }
                }
                
                // 处理识别码任务（task_type=61）
                const goodsCodeTemplate = enabledTemplates.find(t => t.task_type === 61);
                if (goodsCodeTemplate) {
                    const goodsCodeResult = await this.batchUploadGoodsCode(spuIds, goodsCodeTemplate, mallid, sellerTemp);
                    if (goodsCodeResult.success) {
                        totalSuccess += goodsCodeResult.total;
                        this.complianceLogs.push(`[识别码] 成功: ${goodsCodeResult.total}`);
                    } else {
                        totalFail += spuIds.length;
                        this.complianceLogs.push(`[识别码] 失败: ${goodsCodeResult.message}`);
                        this.addLog(`[合规] [识别码] 失败: ${goodsCodeResult.message}`);
                    }
                }
                
                processedTemplates++;
                this.updateProgress(processedTemplates, templates.length, `处理中 ${processedTemplates}/${templates.length}`);
            }
            
            // 仅在有失败时输出汇总日志
            if (totalFail > 0) {
                this.addLog(`[合规] 合规任务完成，成功: ${totalSuccess}, 失败: ${totalFail}`);
            } else {
                this.addLog(`[合规] 合规任务完成，成功: ${totalSuccess}`);
            }
            this.updateProgress(100, 100, '完成');
            
            return { success: true, totalSuccess, totalFail, logs: this.complianceLogs };
        } catch (e) {
            this.addLog(`[合规] 任务失败: ${e.message}`);
            this.updateProgress(0, 100, '失败');
            return { success: false, message: e.message, logs: this.complianceLogs };
        }
    }
};
