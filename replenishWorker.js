// Web Worker for parallel replenish requests
const UPDATE_URL = 'https://agentseller.temu.com/visage-agent-seller/stock/updateProductVirtualStock';

// 处理消息
self.onmessage = async function(e) {
    const { taskId, mallid, products, headers } = e.data;
    
    const results = [];
    
    // 并发发送所有请求
    const promises = products.map(async (product, index) => {
        try {
            const response = await fetch(UPDATE_URL, {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify(product)
            });
            
            if (response.status === 403) {
                return { index, success: false, error: 'COOKIE已失效', cookieExpired: true };
            }
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.errorCode === 1000000) {
                    return { index, success: true };
                } else {
                    return { index, success: false, error: result.error_msg || result.errorMsg || `errorCode=${result.errorCode}` };
                }
            }
            return { index, success: false, error: `HTTP ${response.status}` };
        } catch (error) {
            return { index, success: false, error: error.message };
        }
    });
    
    // 等待所有响应
    const responses = await Promise.allSettled(promises);
    
    for (const response of responses) {
        if (response.status === 'fulfilled') {
            results.push(response.value);
        } else {
            results.push({ success: false, error: response.reason?.message || '请求失败' });
        }
    }
    
    // 返回结果
    self.postMessage({ taskId, results });
};
