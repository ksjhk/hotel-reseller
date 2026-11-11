import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, createTools, inject } from '../index.js'
import { signature } from '../lib/client.js'

function mockConfig(result = { code: 200, success: true, data: { mocked: true } }) {
  const calls = []
  return {
    calls,
    config: {
      baseUrl: 'https://mock.local/open-api', appKey: 'key', appSecret: 'secret',
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    },
  }
}

const tool = (tools, name) => {
  const found = tools.find((item) => item.name === name)
  assert.ok(found, `missing tool ${name}`)
  return found
}

const dates = { checkInDate: '2027-01-10', checkOutDate: '2027-01-12' }

test('hotel plugin exposes exactly six expected tools', () => {
  const { config } = mockConfig()
  const tools = createTools(config)
  assert.deepEqual(tools.map((item) => item.name), [
    'kashijie_hotel_search',
    'kashijie_hotel_detail',
    'kashijie_hotel_rooms',
    'kashijie_hotel_validate',
    'kashijie_hotel_order_query',
    'kashijie_hotel_order_create',
  ])
  assert.deepEqual(inject, ['tools'])
})

test('hotel search, detail, rooms and validate use anonymous endpoints', async () => {
  const { config, calls } = mockConfig()
  const tools = createTools({ ...config, appKey: '', appSecret: '' })
  await tool(tools, 'kashijie_hotel_search').execute({ cityName: '北京', ...dates, queryText: 'mock', pageIndex: 2, pageSize: 99 })
  assert.equal(calls[0].url.pathname, '/open-api/v1/hotel/search')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].url.searchParams.get('cityName'), '北京')
  assert.equal(calls[0].url.searchParams.get('pageIndex'), '2')
  assert.equal(calls[0].url.searchParams.get('pageSize'), '50')
  assert.equal(calls[0].url.searchParams.has('sign'), false)

  await tool(tools, 'kashijie_hotel_detail').execute({ hotelID: 'hotel_mock', ...dates })
  assert.equal(calls[1].url.pathname, '/open-api/v1/hotel/detail')
  assert.equal(calls[1].url.searchParams.get('hotelID'), 'hotel_mock')

  await tool(tools, 'kashijie_hotel_rooms').execute({ hotelID: 'hotel_mock', ...dates })
  assert.equal(calls[2].url.pathname, '/open-api/v1/hotel/rooms')
  assert.equal(calls[2].url.searchParams.get('checkInDate'), dates.checkInDate)

  await tool(tools, 'kashijie_hotel_validate').execute({ hotelID: 'hotel_mock', ratePlanID: 'rate_mock', ...dates, roomNum: 2 })
  assert.equal(calls[3].url.pathname, '/open-api/v1/hotel/validate')
  assert.equal(calls[3].options.method, 'POST')
  const validateBody = JSON.parse(calls[3].options.body)
  assert.equal(validateBody.ratePlanID, 'rate_mock')
  assert.equal(validateBody.roomNum, 2)
  assert.equal('sign' in validateBody, false)
})

test('hotel order query is signed', async () => {
  const { config, calls } = mockConfig()
  const tools = createTools(config)
  await tool(tools, 'kashijie_hotel_order_query').execute({ order_no: 'hotel_order_mock' })
  assert.equal(calls[0].url.pathname, '/open-api/v1/hotel/order/query')
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.order_no, 'hotel_order_mock')
  assert.equal(body.sign, signature({ order_no: 'hotel_order_mock', app_key: 'key', timestamp: body.timestamp }, 'secret'))
})

test('hotel order create requires confirmation and sends the complete signed order', async () => {
  const { config, calls } = mockConfig()
  const tools = createTools(config)
  const create = tool(tools, 'kashijie_hotel_order_create')
  const order = {
    hotelID: 'hotel_mock', ratePlanID: 'rate_mock', ...dates, roomNum: 2,
    guest_names: 'Mock Guest', contactName: 'Mock Contact', contactMobile: '10000000000',
    arriveHour: 18, remark: 'mock remark', attach: 'mock attach', confirm: false,
  }
  await assert.rejects(async () => create.execute(order), /明确确认/)
  assert.equal(calls.length, 0)

  await create.execute({ ...order, confirm: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.pathname, '/open-api/v1/hotel/order/create')
  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.hotelID, 'hotel_mock')
  assert.equal(body.ratePlanID, 'rate_mock')
  assert.equal(body.roomNum, 2)
  assert.equal(body.guest_names, 'Mock Guest')
  assert.equal(body.contactMobile, '10000000000')
  assert.equal(body.arriveHour, 18)
  assert.equal('confirm' in body, false)
  const expected = { ...order, confirm: undefined, app_key: 'key', timestamp: body.timestamp }
  delete expected.confirm
  assert.equal(body.sign, signature(expected, 'secret'))
})

test('hotel create rejects invalid room counts before any request', async () => {
  const { config, calls } = mockConfig()
  const create = tool(createTools(config), 'kashijie_hotel_order_create')
  const order = {
    hotelID: 'hotel_mock', ratePlanID: 'rate_mock', ...dates, roomNum: 10,
    guest_names: 'Mock Guest', contactName: 'Mock Contact', contactMobile: '10000000000', confirm: true,
  }
  await assert.rejects(async () => create.execute(order), /1～9/)
  assert.equal(calls.length, 0)
})

test('hotel apply registers valid DSH tool definitions', () => {
  const { config } = mockConfig()
  const registered = []
  apply({ tools: { register: (value) => registered.push(value) } }, config)
  assert.equal(registered.length, 6)
})
