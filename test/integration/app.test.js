import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { createApp } from '../../src/infrastructure/api/app.js'
import { controllersFactory } from '../../src/infrastructure/controllers/controllers-factory.js'
import { sagaConsumerFactory } from '../../src/infrastructure/messaging/saga-consumer-factory.js'

const silentLogger = { info() {}, warn() {}, error() {} }
const vendasEventosUrl = 'https://sqs.us-east-1.amazonaws.com/123/vendas-eventos'

/** Simula a tabela `vendas` interpretando apenas os comandos usados pelo repositório. */
const makeDb = (initial = []) => {
  const rows = new Map(initial.map(row => [row.codigo, { ...row }]))
  const db = {
    rows,
    execute: async (sql, params = []) => {
      if (sql.startsWith('INSERT')) {
        const [codigo, veiculoPlaca, clienteId, clienteCpf, status] = params
        const active = [...rows.values()].some(row => row.veiculo_placa === veiculoPlaca &&
          ['RESERVA_PROCESSANDO', 'AGUARDANDO_PAGAMENTO', 'PAGAMENTO_PROCESSANDO', 'PAGAMENTO_FALHOU'].includes(row.status))
        if (active) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
        rows.set(codigo, {
          id: rows.size + 1,
          codigo,
          veiculo_placa: veiculoPlaca,
          cliente_id: clienteId,
          cliente_cpf: clienteCpf,
          status,
          preco: null,
          veiculo_id: null,
          last_error: null,
          data_venda: '2026-11-14T00:00:00.000Z'
        })
        return [{ insertId: rows.size }]
      }
      if (sql.startsWith('UPDATE')) {
        const [veiculoId, clienteId, preco, status, lastError, codigo, statusAnterior] = params
        const row = rows.get(codigo)
        if (!row || row.status !== statusAnterior) return [{ affectedRows: 0 }]
        Object.assign(row, { veiculo_id: veiculoId, cliente_id: clienteId, preco, status, last_error: lastError })
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('WHERE codigo = ?')) {
        const row = rows.get(params[0])
        return [row ? [{ ...row }] : []]
      }
      if (sql.startsWith('SELECT')) return [[...rows.values()].map(row => ({ ...row }))]
      throw new Error(`Unexpected SQL: ${sql}`)
    }
  }
  return db
}

const makeSqs = ({ fail = false } = {}) => ({
  sent: [],
  async send(command) {
    if (command instanceof SendMessageCommand) {
      if (fail) throw new Error('SQS unavailable')
      this.sent.push({ queueUrl: command.input.QueueUrl, ...JSON.parse(command.input.MessageBody) })
    }
    return {}
  }
})

const clientesFetch = async (url) => {
  if (url.endsWith('/internal/clientes/12345678901')) {
    return new Response(JSON.stringify({ id: 8, nome: 'Maria', cpf: '12345678901', email: 'm@m.com' }))
  }
  return new Response(JSON.stringify({ message: 'Cliente não encontrado.' }), { status: 404 })
}

const withServer = async ({ db, sqsClient, fetchImpl = clientesFetch }, callback) => {
  const controllers = controllersFactory({
    db,
    sqsClient,
    vendasEventosUrl,
    clientesBaseUrl: 'http://clientes/',
    fetchImpl,
    logger: silentLogger
  })
  const server = createApp({ ...controllers, logger: silentLogger }).listen(0)
  await once(server, 'listening')
  try {
    await callback(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

const post = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
})

test('reservation validates the client, stores the sale and publishes VENDA_CRIADA', async () => {
  const db = makeDb()
  const sqsClient = makeSqs()
  await withServer({ db, sqsClient }, async (baseUrl) => {
    const response = await post(`${baseUrl}/api/vendas/reservar`, { veiculoPlaca: 'abc1d23', clienteCpf: '123.456.789-01' })
    assert.equal(response.status, 202)
    const body = await response.json()
    assert.equal(body.veiculoPlaca, 'ABC1D23')
    assert.equal(body.status, 'RESERVA_PROCESSANDO')
    assert.equal(body.statusUrl, `/api/vendas/${body.codigo}`)

    assert.equal(sqsClient.sent.length, 1)
    const [evento] = sqsClient.sent
    assert.equal(evento.queueUrl, vendasEventosUrl)
    assert.equal(evento.tipo, 'VENDA_CRIADA')
    assert.equal(evento.origem, 'vendas')
    assert.equal(evento.vendaCodigo, body.codigo)
    assert.equal(evento.clienteId, 8)
    assert.ok(evento.eventoId)

    const duplicate = await post(`${baseUrl}/api/vendas/reservar`, { veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' })
    assert.equal(duplicate.status, 409)
  })
})

test('reservation maps unknown clients, invalid input and unavailable dependencies', async () => {
  await withServer({ db: makeDb(), sqsClient: makeSqs() }, async (baseUrl) => {
    assert.equal((await post(`${baseUrl}/api/vendas/reservar`, { veiculoPlaca: 'ABC1D23', clienteCpf: '99999999999' })).status, 404)
    assert.equal((await post(`${baseUrl}/api/vendas/reservar`, { placa: 'X', clienteCpf: '1' })).status, 400)
  })

  const offline = async () => { throw new TypeError('fetch failed') }
  await withServer({ db: makeDb(), sqsClient: makeSqs(), fetchImpl: offline }, async (baseUrl) => {
    assert.equal((await post(`${baseUrl}/api/vendas/reservar`, { veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' })).status, 503)
  })

  const db = makeDb()
  await withServer({ db, sqsClient: makeSqs({ fail: true }) }, async (baseUrl) => {
    const response = await post(`${baseUrl}/api/vendas/reservar`, { veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' })
    assert.equal(response.status, 503)
    const [row] = db.rows.values()
    assert.equal(row.status, 'RESERVA_FALHOU')
  })
})

test('choreographed saga: payment request, vehicle events and compensation on cancel', async () => {
  const db = makeDb([{
    id: 1,
    codigo: 'VEN-1234ABCD',
    veiculo_placa: 'ABC1D23',
    cliente_id: 8,
    cliente_cpf: '12345678901',
    status: 'RESERVA_PROCESSANDO',
    preco: null,
    veiculo_id: null,
    last_error: null,
    data_venda: '2026-11-14T00:00:00.000Z'
  }])
  const sqsClient = makeSqs()
  const consumer = sagaConsumerFactory({
    db,
    sqsClient,
    vendasEventosUrl,
    veiculosEventosUrl: 'veiculos-eventos',
    logger: silentLogger
  })
  const deliver = (evento) => consumer.handleMessage({
    MessageId: evento.tipo,
    ReceiptHandle: evento.tipo,
    Body: JSON.stringify(evento),
    Attributes: { ApproximateReceiveCount: '1' }
  })

  await deliver({ tipo: 'VEICULO_RESERVADO', vendaCodigo: 'VEN-1234ABCD', veiculoPlaca: 'ABC1D23', veiculoId: 7, preco: 85000 })
  assert.equal(db.rows.get('VEN-1234ABCD').status, 'AGUARDANDO_PAGAMENTO')

  await withServer({ db, sqsClient }, async (baseUrl) => {
    const payment = await post(`${baseUrl}/api/vendas/VEN-1234ABCD/confirmar-pagamento`)
    assert.equal(payment.status, 202)
    assert.equal((await payment.json()).status, 'PAGAMENTO_PROCESSANDO')
    assert.equal(sqsClient.sent.at(-1).tipo, 'PAGAMENTO_RECEBIDO')

    const busy = await post(`${baseUrl}/api/vendas/VEN-1234ABCD/cancelar`)
    assert.equal(busy.status, 409)

    await deliver({ tipo: 'VEICULO_VENDA_FALHOU', vendaCodigo: 'VEN-1234ABCD', veiculoPlaca: 'ABC1D23', motivo: 'O veículo não está reservado para esta venda.' })
    const failed = await (await fetch(`${baseUrl}/api/vendas/VEN-1234ABCD`)).json()
    assert.equal(failed.status, 'PAGAMENTO_FALHOU')
    assert.equal(failed.erro, 'O veículo não está reservado para esta venda.')

    const cancel = await post(`${baseUrl}/api/vendas/VEN-1234ABCD/cancelar`)
    assert.equal(cancel.status, 200)
    assert.equal((await cancel.json()).status, 'CANCELADA')
    assert.deepEqual(
      { tipo: sqsClient.sent.at(-1).tipo, vendaCodigo: sqsClient.sent.at(-1).vendaCodigo },
      { tipo: 'VENDA_CANCELADA', vendaCodigo: 'VEN-1234ABCD' }
    )

    const list = await (await fetch(`${baseUrl}/api/vendas`)).json()
    assert.equal(list.length, 1)
    assert.equal(list[0].preco, 85000)
    assert.equal((await fetch(`${baseUrl}/api/vendas/invalido`)).status, 400)
    assert.equal((await fetch(`${baseUrl}/api/vendas/VEN-00000000`)).status, 404)
  })
})
