# 卡世界酒店代理 API

API 根地址：`https://www.kashijie.com/open-api`

酒店搜索、详情、房型报价和可订检查可匿名调用，同 IP 限 60 次/分钟；主动携带 `app_key` 时必须带完整有效的 `timestamp / sign`。下单、订单查询和余额查询需要签名。金额字段单位为分。

## 快速获取密钥

`POST /platform/quick-start`，公开接口。开发者或 AI 在用户同意后提交用户本人未注册手机号，系统自动注册并返回首组 `app_key / app_secret`、7 天 token 和初始余额 0。

```bash
curl -X POST "https://www.kashijie.com/open-api/platform/quick-start" \
  -H "Content-Type: application/json" \
  -d '{"mobile":"用户本人11位手机号"}'
```

同 IP 每小时最多 3 次。已注册手机号需登录控制台管理密钥，公开接口不会读取或追加他人账号密钥。

## 签名算法

所有签名请求必带 `app_key`、秒级 `timestamp`、`sign`。

1. 取全部请求参数（GET query 或 POST body），排除 `sign` 本身；query 与 body 混用时，两处参数必须合并。
2. 跳过空值、数组与对象。
3. 按参数名升序拼接：`k1=v1&k2=v2`。
4. 末尾追加 `&secret=你的app_secret`。
5. 计算小写 32 位 MD5。

query、JSON body、表单三种方式均可；鉴权参数放 query、业务参数放 body 时，业务参数也必须参与签名。`app_secret` 只在服务端本地参与计算，不明文传输。

## 酒店查询接口

酒店查询保留上游 `success / data / msg` 响应结构，不使用其他响应码规则替代。

| 接口 | 方法 | 说明 |
|---|---|---|
| `/v1/hotel/search` | GET | 酒店搜索 |
| `/v1/hotel/detail` | GET | 酒店详情 |
| `/v1/hotel/rooms` | GET | 房型与实时报价 |
| `/v1/hotel/validate` | POST | 可订检查 |

常用业务参数：

| 参数 | 适用接口 | 必填 | 说明 |
|---|---|---|---|
| `cityName` | search | 是 | 城市名，如「北京」 |
| `checkInDate` / `checkOutDate` | search / detail / rooms / validate | 是 | 入住 / 离店日期，YYYY-MM-DD |
| `pageIndex` / `pageSize` | search | 否 | 页码与每页数量 |
| `queryText` | search | 否 | 酒店名、商圈等关键词 |
| `hotelID` | detail / rooms / validate | 是 | 搜索接口返回的酒店 ID |
| `ratePlanID` / `roomNum` | validate | 是 | 报价产品 ID 与间数 |

匿名搜索示例，日期替换为实际入住计划：

```bash
curl -G "https://www.kashijie.com/open-api/v1/hotel/search" \
  --data-urlencode "cityName=北京" \
  --data-urlencode "checkInDate=2026-11-10" \
  --data-urlencode "checkOutDate=2026-11-11" \
  --data-urlencode "pageIndex=1" \
  --data-urlencode "pageSize=15"
```

## 创建酒店订单

`POST /v1/hotel/order/create`，JSON body，需完整签名参数。

| 参数 | 必填 | 说明 |
|---|---|---|
| `hotelID` / `ratePlanID` | 是 | 酒店 ID / 房型报价产品 ID |
| `checkInDate` / `checkOutDate` | 是 | 入住 / 离店日期 |
| `roomNum` | 是 | 间数，1～9 |
| `guest_names` | 是 | 入住人姓名，多个用英文逗号分隔 |
| `contactName` / `contactMobile` | 是 | 联系人姓名 / 11 位手机号 |
| `arriveHour` / `remark` | 否 | 预计到店小时 / 订单备注 |
| `attach` | 否 | 自定义附加信息 |

平台先实时询价并创建未支付订单，再扣开放平台余额并提交酒店履约；确认失败自动退回余额。未经代理明确授权，不发起真实扣款订单。

## 查询酒店订单

`POST /v1/hotel/order/query`，参数为 `order_no` 与鉴权参数。`supplier_data` 中包含酒店确认状态和失败原因，处理中建议每 10～30 秒轮询。

| status | 说明 |
|---|---|
| `recharging` | 已扣款，酒店确认中 |
| `success` | 预订成功 |
| `refunded` | 确认失败，余额已退回 |

网络超时先按订单号查询，不直接重复创建订单。
