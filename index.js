import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  KashijieClient, jsonOutput, supplySuccess, assertConfirmed,
  requiredString, validDate, validMobile,
} from './lib/client.js'

export const name = 'kashijie-hotel-reseller'
export const inject = ['tools']

const hotelId = { type: 'string', required: true, description: '酒店搜索返回的 hotelID' }
const ratePlanId = { type: 'string', required: true, description: '房型报价返回的 ratePlanID' }
const checkIn = { type: 'string', required: true, description: '入住日期，YYYY-MM-DD' }
const checkOut = { type: 'string', required: true, description: '离店日期，YYYY-MM-DD' }

export function createTools(config = {}) {
  const client = new KashijieClient({
    baseUrl: config.baseUrl || process.env.KASHIJIE_HOTEL_API_BASE_URL || 'https://www.kashijie.com/open-api',
    appKey: config.appKey || process.env.KASHIJIE_APP_KEY || '',
    appSecret: config.appSecret || process.env.KASHIJIE_APP_SECRET || '',
    fetchImpl: config.fetchImpl || fetch,
  })
  const call = (options, exec) => client.request({ ...options, success: supplySuccess }, exec)
  const hotelArgs = (args) => ({
    hotelID: requiredString(args.hotelID, 'hotelID'),
    checkInDate: validDate(args.checkInDate, '入住日期'),
    checkOutDate: validDate(args.checkOutDate, '离店日期'),
  })

  return [
    {
      name: 'kashijie_hotel_search',
      description: '搜索卡世界全国酒店房源和代理结算价。适合酒店代理查询货源，之后可调用详情、房型和可订检查。',
      parameters: {
        cityName: { type: 'string', required: true, description: '城市名，例如北京' },
        checkInDate: checkIn,
        checkOutDate: checkOut,
        queryText: { type: 'string', description: '酒店名、商圈或地标关键词' },
        pageIndex: { type: 'integer', description: '页码，默认 1' },
        pageSize: { type: 'integer', description: '每页数量，默认 15，最大 50' },
      },
      output: jsonOutput,
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      execute: (args, exec) => call({
        method: 'GET', path: '/v1/hotel/search',
        query: {
          cityName: requiredString(args.cityName, '城市名'),
          checkInDate: validDate(args.checkInDate, '入住日期'),
          checkOutDate: validDate(args.checkOutDate, '离店日期'),
          queryText: args.queryText,
          pageIndex: args.pageIndex ?? 1,
          pageSize: Math.min(50, Math.max(1, args.pageSize ?? 15)),
        },
      }, exec),
    },
    {
      name: 'kashijie_hotel_detail',
      description: '查询卡世界指定酒店的详情。',
      parameters: { hotelID: hotelId, checkInDate: checkIn, checkOutDate: checkOut },
      output: jsonOutput,
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      execute: (args, exec) => call({ method: 'GET', path: '/v1/hotel/detail', query: hotelArgs(args) }, exec),
    },
    {
      name: 'kashijie_hotel_rooms',
      description: '查询指定酒店的房型、实时报价和代理结算成本。',
      parameters: { hotelID: hotelId, checkInDate: checkIn, checkOutDate: checkOut },
      output: jsonOutput,
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      execute: (args, exec) => call({ method: 'GET', path: '/v1/hotel/rooms', query: hotelArgs(args) }, exec),
    },
    {
      name: 'kashijie_hotel_validate',
      description: '酒店下单前执行可订检查并重新确认价格，不产生订单和扣款。',
      parameters: {
        hotelID: hotelId, ratePlanID: ratePlanId, checkInDate: checkIn, checkOutDate: checkOut,
        roomNum: { type: 'integer', required: true, description: '间数，1～9' },
      },
      output: jsonOutput,
      timeoutMs: 30000,
      execute: (args, exec) => call({
        path: '/v1/hotel/validate',
        body: { ...hotelArgs(args), ratePlanID: requiredString(args.ratePlanID, 'ratePlanID'), roomNum: args.roomNum },
      }, exec),
    },
    {
      name: 'kashijie_hotel_order_query',
      description: '使用代理自己的密钥查询酒店订单确认状态和失败退款结果。网络超时先查单，不重复创建。',
      parameters: { order_no: { type: 'string', required: true, description: '卡世界酒店订单号' } },
      output: jsonOutput,
      timeoutMs: 30000,
      execute: (args, exec) => call({
        path: '/v1/hotel/order/query', signed: true,
        body: { order_no: requiredString(args.order_no, '订单号') },
      }, exec),
    },
    {
      name: 'kashijie_hotel_order_create',
      description: '创建真实酒店代理订单并扣预充值余额。仅在用户明确同意扣款时调用，confirm 必须为 true；失败由平台自动退款。',
      parameters: {
        hotelID: hotelId, ratePlanID: ratePlanId, checkInDate: checkIn, checkOutDate: checkOut,
        roomNum: { type: 'integer', required: true, description: '间数，1～9' },
        guest_names: { type: 'string', required: true, description: '入住人姓名，多个用英文逗号分隔' },
        contactName: { type: 'string', required: true, description: '联系人姓名' },
        contactMobile: { type: 'string', required: true, description: '联系人 11 位手机号' },
        arriveHour: { type: 'integer', description: '预计到店小时，0～23' },
        remark: { type: 'string', description: '订单备注' },
        attach: { type: 'string', description: '代理自定义附加信息' },
        confirm: { type: 'boolean', required: true, description: '用户明确同意真实扣款时才为 true' },
      },
      output: jsonOutput,
      timeoutMs: 45000,
      execute: (args, exec) => {
        assertConfirmed(args.confirm)
        if (args.roomNum < 1 || args.roomNum > 9) throw new Error('间数必须为 1～9。')
        return call({
          path: '/v1/hotel/order/create', signed: true,
          body: {
            ...hotelArgs(args), ratePlanID: requiredString(args.ratePlanID, 'ratePlanID'), roomNum: args.roomNum,
            guest_names: requiredString(args.guest_names, '入住人姓名'),
            contactName: requiredString(args.contactName, '联系人姓名'),
            contactMobile: validMobile(args.contactMobile, '联系人手机号'),
            arriveHour: args.arriveHour, remark: args.remark, attach: args.attach,
          },
        }, exec)
      },
    },
  ]
}

export function apply(ctx, config = {}) {
  for (const definition of createTools(config)) ctx.tools.register(defineTool(definition))
}
