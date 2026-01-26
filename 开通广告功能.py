import httpx
import asyncio
import json
import uuid


headers = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json;charset=UTF-8",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36 Edg/106.0.1370.47",
}
cookies = {
    "api_uid": "Cm18HWl15qgpIOxQgFV5Ag==",
    "region": "0",
    "_nano_fp": "GVLq8brqLt-YjyLtjJrhz#f70_C81_TAim923awQOVN",
    "ad_timezone": "Asia%2FShanghai",
    "img_sup": "webp",
    "_bee": "34TeJDd5f8hJjVrqNlnylNfjx8a3Uapo",
    "njrpl": "34TeJDd5f8hJjVrqNlnylNfjx8a3Uapo",
    "dilx": "HxiW1xyWjRqJ5dHMYMuI5",
    "hfsc": "L3yMeYwz6Tzx1JbEew==",
    "auth_token": "eyJraWQiOiJ2MSIsImN0eSI6IkpXVCIsImVuYyI6IkEyNTZHQ00iLCJhbGciOiJkaXIifQ..pAV07zK6b-8am12C.9pDpyiSafU8JzPz4s4XvnVIESnFkTIZoauyTjt3XFejud9KXH9RqFmH0ktZVG0M6axgT3vo10CqvZQip38Vft01qBRgYng0Kz5G4nYHpCqOOy0boMktP-y5v0dHHJ1Rq-bNQij7cqxbSreep_hCr0axlPodQMl6CMHt8Kxmj1_6c-tOCuyN0yXT1lOyIF8jnw5cKCBsjvl7WlIIaRtcIi2g4e27pEPB6WGNKATkj6GYw1e8eA9rxCka8yDBUskIOfafcTI2ddAX5WiYvPr0Yc5OyKIvxX11KYUtt0YspTkLNko2SXDBshsDlsQM7t1b2BsiJ0cHDNrm8v33tkstnwkE0v00SuefkJ0rMfSsTgnlcV5QJY3SAAXTqk7Q8pc6D0Uu3WzLvLmuGdrKfadAdBPkSd928F3zAPKmyapY6U0fT1VNGeKKEAbX7NgRKoB3bksPBT2jShlcWydu4h3Q8PZ01l2sti0gA9M0.25sBIN9rHIkcPqTp-IlvVA",
    "ad_uin": "Dvksk-er_SzUmA1mzqcWzA",
    "ad_site": "\"\"",
    "MALL_ID": "634418222900211",
    "ad_area": "2",
    "ad_language": "zh-Hans",
    "mall_ad_timezone": "Asia%2FShanghai"
}
# url = "https://ads.temu.com/api/v1/coconut/ad/query_mall_goods_list"

async def request_with_retry(client, url, headers, cookies, data, max_retries=3):
    """带重试机制的异步请求函数"""
    last_error = None
    for attempt in range(max_retries):
        try:
            response = await client.post(url, headers=headers, cookies=cookies, data=data)
            response_json = response.json()
            if response_json.get("success", False):
                return response_json
            last_error = f"HTTP={response.status_code} errorMsg={response_json.get('error_msg')} resp={response_json}"
        except Exception as e:
            last_error = f"Exception: {str(e)}"
            await asyncio.sleep(0.5)  # 失败后短暂等待
    
    # 仅在最后一次失败后输出日志
    if last_error:
        print(f"请求失败（重试{max_retries}次后）: {last_error}")
    return None


async def fetch_goods_page(client, url, headers, cookies, page, page_size, list_id, semaphore):
    """异步获取商品列表单页数据"""
    async with semaphore:  # 控制并发数量
        payload = {
            "page_number": page,
            "page_size": page_size,
            "is_gray": True,
            "list_id": list_id
        }
        payload_json = json.dumps(payload, separators=(',', ':'))
        response_data = await request_with_retry(client, url, headers, cookies, payload_json)
        
        if response_data:
            goods_info_list = response_data.get("result", {}).get("goods_info_list", [])
            if len(goods_info_list) != 0:
                # 参照74-86行的保留条件
                filtered_goods = [
                    goods.get("goods_id")
                    for goods in goods_info_list 
                    if goods.get("goods_id", False) and 
                    (
                        not goods.get("gray_reason") or
                        len(goods.get("gray_reason", [])) == 0 or
                        (
                            goods.get("gray_reason", [])[0].get("type", 0) != 2 and
                            goods.get("gray_reason", [])[0].get("type", 0) != 3
                        )
                    )
                ]
                return filtered_goods
        return []


async def create_ads_batch(client, url, headers, cookies, goods_id_list):
    """异步创建广告批次"""
    reqs_data = {
        "create_ad_reqs": [
            {
                "goods_id": goods_id,
                "roas": 70000,
                "budget": -1
            }
            for goods_id in goods_id_list
        ]
    }
    
    response_data = await request_with_retry(client, url, headers, cookies, json.dumps(reqs_data, separators=(',', ':')))
    
    batch_fail_map = {}
    batch_success_count = 0
    
    if response_data:
        fail_map = response_data.get("result", {}).get("create_goods_fail_map", {})
        batch_success_count = response_data.get("result", {}).get("success_create_product_num", 0)
        
        for reason in fail_map.values():
            if batch_fail_map.get(reason):
                batch_fail_map[reason] += 1
            else:
                batch_fail_map[reason] = 1
    
    return batch_fail_map, batch_success_count


async def main():
    list_id = str(uuid.uuid4())    # 生成一个uuid作为对话标识
    query_url = "https://ads.temu.com/api/v1/coconut/ad/query_mall_goods_list"
    create_url = "https://ads.temu.com/api/v1/coconut/ad/create_ads/create"
    
    # 配置更大的连接池和超时时间
    timeout = httpx.Timeout(60.0, connect=10.0)
    limits = httpx.Limits(max_connections=300, max_keepalive_connections=100)
    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        # 步骤1: 使用 page_size=1 查询获取 total 值
        data = {
            "page_number": 1,
            "page_size": 1,
            "is_gray": True,
            "list_id": list_id
        }
        data_json = json.dumps(data, separators=(',', ':'))
        response_data = await request_with_retry(client, query_url, headers, cookies, data_json)
        
        if not response_data:
            print("获取总商品数失败")
            return
        
        total = response_data.get("total", 0)
        
        # 步骤2: 使用 total // 100 + 300 计算总页数
        page_count = int(total // 100 * 1.2)
        
        # 初始化统计变量
        goods_id_list = []
        ad_creation_tasks = []  # 存储所有广告创建任务
        
        # 创建信号量控制并发数量（最多50个并发请求）
        semaphore = asyncio.Semaphore(100)
        
        # 步骤3: 使用总页数进行遍历获取全店商品数据（异步并发不等待响应）
        # 创建所有页面获取任务（并发执行）
        print(f"当前店铺有 {total} 个商品， 开始获取 {page_count} 页商品数据...")
        fetch_tasks = [
            asyncio.create_task(
                fetch_goods_page(client, query_url, headers, cookies, page, 100, list_id, semaphore)
            )
            for page in range(1, page_count + 1)
        ]
        
        # 使用 as_completed 按完成顺序处理结果
        for completed_task in asyncio.as_completed(fetch_tasks):
            page_goods = await completed_task
            
            if page_goods:
                goods_id_list.extend(page_goods)
            
            # 步骤4: 当 goods_id_list 中的元素达到 50 个时异步进行后续开通广告流程
            while len(goods_id_list) >= 50:
                # 取前50个进行广告创建
                # print(goods_id_list)
                batch_goods = goods_id_list[:50]
                
                # 异步创建广告（不等待）
                ad_task = asyncio.create_task(
                    create_ads_batch(client, create_url, headers, cookies, batch_goods)
                )
                ad_creation_tasks.append(ad_task)
                
                # 重新赋值 goods_id_list（移除已处理的50个）
                goods_id_list = goods_id_list[50:]
                
                # print(f"已提交批次 #{len(ad_creation_tasks)}，剩余待处理商品数: {len(goods_id_list)}")
        
        # 步骤5: 当查询完成全部页数后，goods_id_list 中的元素个数不为0时进行最后一次开通广告
        if len(goods_id_list) > 0:
            # print(f"处理最后一批商品，数量: {len(goods_id_list)}")
            ad_task = asyncio.create_task(
                create_ads_batch(client, create_url, headers, cookies, goods_id_list)
            )
            ad_creation_tasks.append(ad_task)
        
        # 等待所有广告创建任务完成并收集结果
        # print(f"\n等待所有广告创建任务完成，共 {len(ad_creation_tasks)} 个批次...")
        results = await asyncio.gather(*ad_creation_tasks)
        
        # 步骤6: 收集并合并所有批次的失败统计和成功计数
        fail_count_map = {}
        success_count = 0
        
        for batch_fail_map, batch_success_count in results:
            success_count += batch_success_count
            for reason, count in batch_fail_map.items():
                if fail_count_map.get(reason):
                    fail_count_map[reason] += count
                else:
                    fail_count_map[reason] = count
        
        # 输出全部的失败结果统计
        # print("\n=== 最终统计结果 ===")
        print(f"失败结果统计：{fail_count_map}")
        print(f"成功开通广告{success_count}个")


if __name__ == "__main__":
    asyncio.run(main())

