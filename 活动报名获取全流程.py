import re
import requests
import json
import hashlib
from datetime import datetime
from math import ceil


headers = {
    "accept": "*/*",
    "content-type": "application/json",
    "mallid": "634418220265983",    # 该值从cookie中获取
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
}
cookies = {
    "seller_temp": "N_eyJ0IjoiT21IdEJram9wM045cTlGZi83VnUwQVdsdVJGQmNVK0ZSaG91dDRBWGo1K25EZmpFZWM0cDZHZzloZHFQcmJvZGMvamZ5ZTJhQkF1WHl3dXdocXNYVHc9PSIsInYiOjEsInMiOjEwMDAxLCJ1IjoyNDQxMDAwNTIyNjY3Nn0="
}


# ============================================================
# 步骤1: 查询全部活动列表
# ============================================================
def timestamp_to_str(timestamp):
    """将毫秒时间戳转换为日期时间字符串"""
    if timestamp:
        return datetime.fromtimestamp(timestamp / 1000).strftime('%Y-%m-%d %H:%M')
    return None


def parse_activities(data):
    """解析活动信息并保存为json文件"""
    
    # 获取活动列表
    activity_list = data.get('result', {}).get('activityList', [])
    
    # 收集所有数据行
    rows = []
    
    for activity in activity_list:
        # 前置判断 thematicList 是否为空
        thematic_list = activity.get('thematicList', [])
        
        if not thematic_list:
            # thematicList 为空：只提取外部信息，创建一行数据
            rows.append({
                'activityType': activity.get('activityType', ''),
                'activityName': activity.get('activityName', ''),
                'activityThematicName': None,
                'activityContent': activity.get('activityContent', ''),
                'timeRange': '长期',
                'activityThematicId': activity.get('activityType', ''),
                'discountThreshold': activity.get('discountThreshold', ''),
                'stockThreshold': activity.get('stockThreshold', ''),
                'enrolledCount': None
            })
        else:
            # thematicList 不为空：先获取外部信息，再遍历内部
            activity_type = activity.get('activityType', '')
            activity_name = activity.get('activityName', '')
            activity_content = activity.get('activityContent', '')
            activity_discount = activity.get('discountThreshold', '')
            activity_stock = activity.get('stockThreshold', '')
            
            # 遍历 thematicList 内部信息
            for thematic in thematic_list:
                # 获取 thematic 内部的价格和库存条件
                thematic_discount = thematic.get('discountThreshold')
                thematic_stock = thematic.get('stockThreshold')
                
                # 优先使用内部条件，没有则使用外部条件
                final_discount = thematic_discount if thematic_discount is not None else activity_discount
                final_stock = thematic_stock if thematic_stock is not None else activity_stock
                
                # 处理时间
                start_time = thematic.get('startTime')
                end_time = thematic.get('endTime')
                if start_time and end_time:
                    time_range = f"{timestamp_to_str(start_time)} - {timestamp_to_str(end_time)}"
                else:
                    time_range = '长期'
                
                rows.append({
                    'activityType': activity_type,
                    'activityName': activity_name,
                    'activityThematicName': thematic.get('activityThematicName'),
                    'activityContent': activity_content,
                    'timeRange': time_range,
                    'activityThematicId': thematic.get('activityThematicId'),
                    'discountThreshold': final_discount,
                    'stockThreshold': final_stock,
                    'enrolledCount': thematic.get('enrolledCount')
                })

    return rows


def query_all_activities():
    url = "https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll/activity/list"
    request_data = {
        "needSessionItem": True,
        "needCanEnrollCnt": True
    }
    request_data = json.dumps(request_data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=request_data)
    response_data = response.json() 
    
    if not response_data.get('success'):
        print(f"查询活动列表失败: {response_data.get('errorMsg', '未知错误')}")
        return None, None, None, None
    
    # 解析并保存格式化结果
    parsed_data = parse_activities(response_data)
    
    # 输出去重的 activityType 和 activityThematicId 列表
    activity_types = list(set(item['activityType'] for item in parsed_data if item['activityType'] is not None))
    thematic_ids = list(set(item['activityThematicId'] for item in parsed_data if item['activityThematicId'] is not None and len(str(item['activityThematicId'])) > 5))
    all_activity_ids = list(set(item['activityThematicId'] for item in parsed_data if item['activityThematicId'] is not None))
    all_activity_count = len(parsed_data)
    
    return activity_types, thematic_ids, all_activity_ids, all_activity_count


# ============================================================
# 步骤1.5: 制作活动模板（查询SPU的规格信息）
# ============================================================
def query_spu_sku_info(spu_id):

    url = "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery"
    data = {
        "productIds": [spu_id],
        "page": 1,
        "pageSize": 20
    }
    data = json.dumps(data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=data)
    
    if response.status_code == 200:
        if response.json().get("result", {}).get("total", 0) > 0:
            for item in response.json().get("result", {}).get("pageItems", []):
                cat_id = item.get("leafCat", {}).get("catId", 0)
                cat_name = item.get("leafCat", {}).get("catName", "")
                sku_data = []
                for sku in item.get("productSkuSummaries", []):
                    for spec in sku.get("productSkuSpecList", []):
                        sku_data.append({
                            "specId": [spec.get("specId", 0) for spec in sorted_specs],
                            "specName": "".join(
                                spec.get("specName", "") for spec in sorted_specs
                            )
                        })

                template = {
                    "spu": spu_id,
                    "catId": cat_id,
                    "catName": cat_name,
                    "skuData": sku_data,
                }

            # 解析完成后需要用户输入 活动价格、活动库存、活动id列表
            # 输入前template如下：
            #     {
            #         "catId": 10498,
            #         "spu": 3710349415,
            #         "catName": "桌布",
            #         "skuData": [
            #             {
            #                 "specId": [
            #                     61919202
            #                 ],
            #                 "specName": "60*60inch/152*152cm",
            #             },
            #             {
            #                 "specId": [
            #                     207716516
            #                 ],
            #                 "specName": "70*70inch/180*180am",
            #             }
            #         ]
            #     }

            # 输入后保存为
            #     {
            #         "catId": 10498,
            #         "spu": 3710349415,
            #         "catName": "桌布",
            #         "skuData": [
            #             {
            #                 "specId": [
            #                     61919202
            #                 ],
            #                 "specName": "60*60inch/152*152cm",
            #                 "activityPrice": 100,     # 活动价格 单位为 分
            #                 "activityStock": 10,      # 活动库存
            #                 "all_activity_ids": [1, 5],   # 报名的活动id
            #                 "all_activity":true           # 是否报名全部活动
            #             },
            #             {
            #                 "specId": [
            #                     207716516
            #                 ],
            #                 "specName": "70*70inch/180*180am",
            #                 "activityPrice": 100,
            #                 "activityStock": 10,
            #                 "all_activity_ids": [1, 5],
            #                 "all_activity":true
            #             }
            #         ]
            #     }
            
            # 读取已有模板，按catId覆盖
            import os
            existing_templates = []
            if os.path.exists("活动模板.json"):
                try:
                    with open("活动模板.json", "r", encoding='utf-8') as f:
                        existing_templates = json.load(f)
                        # 如果文件中是单个对象而不是列表，转为列表
                        if isinstance(existing_templates, dict):
                            existing_templates = [existing_templates]
                except:
                    existing_templates = []
            
            # 查找是否已存在相同catId的模板
            found = False
            for i, existing_template in enumerate(existing_templates):
                if existing_template.get("catId") == cat_id:
                    # 覆盖旧模板
                    existing_templates[i] = template
                    found = True
                    break
            
            # 如果没有找到，添加新模板
            if not found:
                existing_templates.append(template)
            
            # 保存更新后的模板列表
            with open("活动模板.json", "w", encoding='utf-8') as f:
                json.dump(existing_templates, f, ensure_ascii=False, indent=4)
            
        else:
            print(f"查询失败 该SPU不存在 errorMsg={response.json().get("errorMsg", "")}")
    else:
        print(f"请求失败 errorMsg={response.json().get('errorMsg', '未知错误')} HTTP={response.status_code}")
        return None


# ============================================================
# 步骤2: 查询指定类目的在售SPU
# ============================================================
def query_total_by_cat_id(cat_id):
    url = "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery"
    data = {
        "catIds": cat_id,  # 筛选类目
        "skcSiteStatus": 1,  # 在售
        "page": 1,
        "pageSize": 1,
    }
    data = json.dumps(data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=data)
    if response.status_code == 200 and response.json().get("errorCode") == 1000000:
        # 请求成功
        total = response.json().get("total",0)
        return total
    else:
        print(f"请求失败 HTTP={response.status_code} errorMsg={response.json().get("errorMsg")}")
        return 0


def use_cat_id_get_max_lenght(template_list, cat_id):
    lenght_list = []
    for t in template_list:
        if t["cat_id"] != cat_id:
            continue
        for s in t["skuData"]:
            lenght_list.append(len(s["all_activity_ids"]))
    
    return max(lenght_list)


def query_spu_by_category(cat_id, page, page_size, createdAtEnd=None):
    url = "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery"
    all_spu_ids = []
    
    data = {
        "catIds": cat_id,  # 筛选类目
        "skcSiteStatus": 1,  # 在售
        "page": page,
        "pageSize": page_size,
    }
    if createdAtEnd:
        data["createdAtEnd"] = createdAtEnd
    data = json.dumps(data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=data)
    
    page_items = response.json().get("result", {}).get("pageItems", [])
    if not page_items:
        return []
    
    # 收集SPU ID
    for item in page_items:
        spu_id = item.get("productId", 0)
        if spu_id > 0:
            all_spu_ids.append(spu_id)
    
    return all_spu_ids

        
def query_spu_and_time_by_category(cat_id, page, page_size, createdAtEnd=None):
    url = "https://agentseller.temu.com/visage-agent-seller/product/skc/pageQuery"
    all_spu_ids = []
    
    data = {
        "catIds": cat_id,  # 筛选类目
        "skcSiteStatus": 1,  # 在售
        "page": page,
        "pageSize": page_size,
    }
    if createdAtEnd:
        data["createdAtEnd"] = createdAtEnd
    data = json.dumps(data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=data)
    
    page_items = response.json().get("result", {}).get("pageItems", [])
    if not page_items:
        return []
    
    # 收集SPU ID
    for item in page_items:
        spu_id = item.get("productId", 0)
        if spu_id > 0:
            all_spu_ids.append(spu_id)

    time_stamp = page_items[-1].get("createdAt", 0)
    
    return all_spu_ids, time_stamp   


# ============================================================
# 步骤3: SPU查询可报活动
# ============================================================
def parse_template_products(data):
    """解析响应数据，提取报名所需的产品信息"""
    template_products = data.get('result', {}).get('templateProducts', [])
    
    parsed_list = []
    for product in template_products:
        parsed_product = {
            "productId": product.get('productId'),    # spuid
            "activityStock": product.get('activityStock'),    # 活动库存
            "activityCode": product.get('activityCode'),      # 活动类型
            "currency": product.get('currency', 'CNY'),      # 货币类型 不可变
            "skcList": []
        }
        
        for skc in product.get('skcList', []):
            parsed_skc = {
                "skcId": skc.get('skcId'),   # skcid
                "skuList": []
            }
            
            for sku in skc.get('skuList', []):
                parsed_skc["skuList"].append({
                    "skuId": sku.get('skuId'),    # skuid
                    "size": sku.get('size'),
                    "activityPrice": sku.get('activityPrice')    # 活动价格（分）
                })
            
            parsed_product["skcList"].append(parsed_skc)
        
        parsed_list.append(parsed_product)
    
    return parsed_list


def query_spu_activities(spu_ids, activity_types, thematic_ids):
    """步骤3: 批量查询SPU的可报活动"""
    
    url = "https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll/batchimport/genTemplate"
    data = {
        "activityTypes": activity_types,
        "thematicIds": thematic_ids,
        "productIds": spu_ids
    }
    data = json.dumps(data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=data)
    response_data = response.json()
    
    if not response_data.get('success'):
        print(f"查询失败: HTTP={response.status_code} errorMsg={response_data.get('errorMsg', '未知错误')}")
        return None
    
    # 解析并格式化结果
    parsed_data = parse_template_products(response_data)
    
    return parsed_data


# ============================================================
# 步骤4: 提交报名活动信息
# ============================================================
def use_template_item_to_map(temp):
    spec_price_map = {}
    for sku in temp["skuData"]:
        spec_price_map[f"{sku.get("specName")}"] = sku.get("activityPrice")
    
    return spec_price_map


def use_activity_task_list_to_can_upload_list(task_lsit, spec_price_map, min_stock):
    index1_list = []
    index2_list = []
    for index1, item in enumerate(task_lsit):
        
        for index2, item2 in enumerate(item['skcList'][0]['skuList']):
            if spec_price_map.get(item2["specName"], False) and item2['activityPrice'] >= spec_price_map.get(item2["specName"], False):
                continue
            else:
                index2_list.append(index2)

        for index2 in index2_list:
            del item['skcList'][0]['skuList'][index2]
            index2_list = []

        if item["activityStock"] > min_stock or len(item['skcList'][0]['skuList']) == 0:
            index1_list.append(index1)

    for index1 in index1_list:
        del task_lsit[index1]

    return task_lsit


def submit_activity_enroll(import_products):
    """步骤4: 提交报名活动信息"""

    data = {
        "importProducts": import_products
    }
    
    # 计算SHA256指纹作为fileName
    fingerprint = hashlib.sha256(json.dumps(data["importProducts"], sort_keys=True).encode()).hexdigest()
    data["fileName"] = fingerprint
    
    # 提交报名
    url = "https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll/batchimport/import"
    data_json = json.dumps(data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=data_json)
    
    # 提交成功就返回指纹 否则就返回空
    if response.status_code == 200 and response.json().get('success'):
        return fingerprint
    else:
        return None


def query_enroll_results(fingerprint_list, page_count):
    """查询报名结果"""
    
    # 等待最后一页处理
    import time
    time.sleep(3)
    
    url = "https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll/batchimport/records"
    data = {
        "pageInfo": {
            "pageNo": 1,
            "pageSize": max(100, int(page_count * 1.5))
        }
    }
    data = json.dumps(data, separators=(',', ':'))
    response = requests.post(url, headers=headers, cookies=cookies, data=data)
    
    if response.status_code != 200 or not response.json().get('success'):
        print(f"查询失败: HTTP={response.status_code} errorMsg={response.json().get('errorMsg', '未知错误')}")
        return None
    
    # 遍历查询结果 来 匹配指纹 后 进行统计初步结果
    total_success = 0
    total_fail = 0
    total_upload = 0
    total_wait = 0
    record_id_list = []
    import_records = response.json().get('result', {}).get('importRecords', [])
    for record in import_records:
        if record.get('name') in fingerprint_list:
            total_upload += record.get("totalCount", 0)
            total_success += record.get('successCount', 0)
            total_fail += record.get('failedCount', 0)
            total_wait += (record.get("totalCount", 0) - record.get('successCount', 0) - record.get('failedCount', 0))
            
        if record.get('failedCount', 0) > 0:
            record_id_list.append(record.get('recordId'))
    
    return total_upload, total_success, total_fail, total_wait, record_id_list


def query_fail_details(record_id_list):
    """查询失败详情"""
    fail_reasons = {}
    
    for record in record_id_list:
        if record.get('failedCount', 0) > 0:
            record_id = record.get('recordId')
            
            url = "https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll/batchimport/failDetails"
            data = {
                "recordId": record_id,
                "pageInfo": {
                    "pageNo": 1,
                    "pageSize": 1000000
                }
            }
            data = json.dumps(data, separators=(',', ':'))
            response = requests.post(url, headers=headers, cookies=cookies, data=data)
            
            if response.status_code == 200 and response.json().get('success'):
                fail_details = response.json().get('result', {}).get('failDetails', [])
                
                # 收集失败原因
                for detail in fail_details:
                    error_msg = detail.get('errorMsg', '未知错误')
                    if fail_reasons[error_msg]:
                        fail_reasons[error_msg] += 1
                    else:
                        fail_reasons[error_msg] = 1
    
    return fail_reasons


# ============================================================
# 主流程
# ============================================================
def main():
    # 步骤1: 查询全部活动列表
    activity_types, thematic_ids, all_activity_ids, all_activity_count = query_all_activities()
    if not activity_types:
        print("查询活动列表失败")
        return

    # 步骤1.5 输入spu 来制作模板
    spu_id = 3710349415     # 示例spu 在扩展程序中 为用户从 搜索框中输入 搜索框 单次只允许输入 一个spu 且只能输入数字
    # 使用spu制作活动报名 模板 后 在界面中填写 活动库存、活动价格、活动id 并 保存
    query_spu_sku_info(spu_id)

    # 步骤2 从模板中获取 全部的类目catId 并去接口获取全部类目下在售的商品数量
    with open("活动模板.json", "r", encoding='utf-8') as f1:
        template_list = json.load(f1)

    # 步骤3 对模板进行更新
    for template in template_list:
        for sku in template['skuData']:
            if sku['all_activity']:
                sku['all_activity_ids'] = all_activity_ids
            else:
                sku['all_activity_ids'] = list(set(sku['all_activity_ids']) & set(all_activity_ids))    # 取新旧活动的并集
    
    # 更新活动模板的 活动列表 并保存
    with open("活动模板.json", "w", encoding='utf-8') as f2:
        json.dump(template_list, f2, ensure_ascii=False, indent=4)

    # 对类目进行循环
    cat_id_list = [ t['catId'] for t in template_list ]
    all_fingerprint_list = []
    all_cat_page_count = 0
    for cat_id in cat_id_list:
        # 获取类目下的商品总数
        total = query_total_by_cat_id(cat_id)
        

        # 使用 该 cat_id 模板的skuData中最长的那个 all_activity_ids 来计算 动态的pageSize
        max_activity_id_lenght = use_cat_id_get_max_lenght(template_list, cat_id)
        page_size = 2000 // max_activity_id_lenght
        page_count = ceil(total / page_size)
        all_cat_page_count += page_count
        page = 0
        time_stamp = 0
        spec_price_map = use_template_item_to_map(temp for temp in template_list if temp["catId"] == cat_id)
        min_stock = min([
            sku["activityStock"] 
            for temp in template_list if temp["catId"] == cat_id
            for sku in temp["skuData"]
            ])

        # 获取在售 spu 进行循环 报名活动
        for i in range(1, page_count + 1):
            page += 1
            if page_size * (page + 1) > 40000:
                spu_list, time_stamp =  query_spu_and_time_by_category(cat_id, page, page_size, time_stamp if time_stamp else None)
                page = 0    # 使用时间游标后需要重置page
            else:
                spu_list = query_spu_by_category(cat_id, page, page_size, time_stamp if time_stamp else None)
            
            # 查询SPU列表中的可报活动
            spu_list_to_activity_task = query_spu_activities(spu_list, activity_types, thematic_ids)

            # 根据模板筛选符合条件活动
            can_upload_activity_task_list = use_activity_task_list_to_can_upload_list(spu_list_to_activity_task, spec_price_map, min_stock)

            # 将符合条件的任务进行上传
            fingerprint = submit_activity_enroll(can_upload_activity_task_list)
            if fingerprint:
                all_fingerprint_list.append(fingerprint)

    # 查询报名结果
    total_upload, total_success, total_fail, total_wait, record_id_list = query_enroll_results(all_fingerprint_list, all_cat_page_count)
    print(f"报名成功: {total_success}/{total_upload}"
        f"报名失败: {total_fail}/{total_upload}"
        f"官方处理中: {total_wait}")

    # 查询详细的报名失败原因
    print("详细错误原因如下：")
    fail_reasons_col = query_fail_details(record_id_list)
    for reason, count in fail_reasons_col.items():
        print(f"{reason}=>{count}个")


if __name__ == "__main__":
    main()
