import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../src/app.js'

const withServer = async (app, callback) => {
  const server = app.listen(0)
  await once(server, 'listening')
  try {
    await callback(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

const makeDb = (initialSale) => {
  const sale = { ...initialSale }
  const statements = []
  const db = {
    execute: async (sql, params = []) => {
      statements.push(sql)
      if (sql.startsWith('INSERT')) {
        Object.assign(sale, {
          codigo: params[0],
          veiculo_placa: params[1],
          cliente_cpf: params[2],
          preco: null,
          data_venda: '2026-11-02T00:00:00.000Z',
          status: 'RESERVA_PROCESSANDO'
        })
        return [{ insertId: 11 }]
      }
      if (sql.startsWith('UPDATE vendas SET status = ?')) {
        sale.status = params[0]
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('UPDATE vendas SET status = ?, last_error = NULL')) {
        sale.status = params[0]
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('SELECT id, codigo')) return [[{ ...sale }]]
      throw new Error(`Unexpected SQL: ${sql}`)
    }
  }
  return { db, sale, statements }
}

test('reservation stores a processing sale and enqueues it without calling dependent services', async () => {
  const { db, statements } = makeDb({})
  const messages = []
  const app = createApp({
    db,
    sqsClient: { send: async (command) => messages.push(command.input) },
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/sales',
    fetchImpl: async () => { throw new Error('Dependent services must not be called by the API') }
  })

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vendas/reservar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' })
    })
    assert.equal(response.status, 202)
    const body = await response.json()
    assert.equal(body.veiculoPlaca, 'ABC1D23')
    assert.equal(body.clienteCpf, '12345678901')
    assert.equal(body.status, 'RESERVA_PROCESSANDO')
    assert.equal(body.statusUrl, `/api/vendas/${body.codigo}`)
    assert.equal(messages.length, 1)
    assert.deepEqual(JSON.parse(messages[0].MessageBody), {
      tipo: 'RESERVAR_VEICULO',
      codigo: body.codigo
    })
    assert.equal(statements.length, 2)
  })
})

test('payment confirmation updates state and enqueues the operation', async () => {
  const { db, sale } = makeDb({
    codigo: 'VEN-1234ABCD',
    veiculo_placa: 'ABC1D23',
    cliente_cpf: '12345678901',
    status: 'AGUARDANDO_PAGAMENTO'
  })
  const messages = []
  const app = createApp({
    db,
    sqsClient: { send: async (command) => messages.push(command.input) },
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/sales',
    fetchImpl: async () => { throw new Error('Dependent services must not be called by the API') }
  })

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vendas/${sale.codigo}/confirmar-pagamento`, {
      method: 'POST'
    })
    assert.equal(response.status, 202)
    const body = await response.json()
    assert.equal(body.status, 'PAGAMENTO_PROCESSANDO')
    assert.equal(body.statusUrl, `/api/vendas/${sale.codigo}`)
    assert.deepEqual(JSON.parse(messages[0].MessageBody), {
      tipo: 'CONFIRMAR_PAGAMENTO',
      codigo: sale.codigo
    })
  })
})
