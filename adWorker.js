// Web Worker for parallel ad goods fetching
const AD_QUERY_URL = 'https://ads.temu.com/api/v1/coconut/ad/query_mall_goods_list';

// 处理消息
self.onmessage = async function(e) {
    const { taskId, pages, pageSize, listId, headers } = e.data;
    
    const results = [];
    
    // 并发发送所有页面请求
    const promises = pages.map(async (page) => {
        try {
            const payload = {
                page_number: page,
                page_size: pageSize,
                is_gray: true,
                list_id: listId
            };
            
            const response = await fetch(AD_QUERY_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                credentials: 'include'
            });
            
            if (!response.ok) {
                return { page, success: false, goods: [], error: `HTTP ${response.status}` };
            }
            
            const data = await response.json();
            
            if (data.success) {
                const goodsInfoList = data.result?.goods_info_list || [];
                const filteredGoods = goodsInfoList
                    .filter(goods => {
                        if (!goods.goods_id) return false;
                        const grayReason = goods.gray_reason;
                        if (!grayReason || grayReason.length === 0) return true;
                        const type = grayReason[0]?.type || 0;
                        return type !== 2 && type !== 3;
                    })
                    .map(goods => goods.goods_id);
                return { page, success: true, goods: filteredGoods };
            } else {
                return { page, success: false, goods: [], error: data.error_msg || '请求失败' };
            }
        } catch (error) {
            return { page, success: false, goods: [], error: error.message };
        }
    });
    
    // 等待所有响应
    const responses = await Promise.allSettled(promises);
    
    for (const response of responses) {
        if (response.status === 'fulfilled') {
            results.push(response.value);
        } else {
            results.push({ success: false, goods: [], error: response.reason?.message || '请求失败' });
        }
    }
    
    // 返回结果
    self.postMessage({ taskId, results });
};
