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

test('reservation validates other domains via HTTP and stores only in sales database', async () => {
  const sale = {
    id: 11,
    codigo: 'VEN-1234ABCD',
    veiculo_id: 7,
    veiculo_placa: 'ABC1D23',
    cliente_id: 8,
    cliente_cpf: '12345678901',
    data_venda: '2026-11-02T00:00:00.000Z',
    preco: '85000.00',
    status: 'AGUARDANDO_PAGAMENTO'
  }
  const statements = []
  const db = {
    execute: async (sql, params) => {
      statements.push(sql)
      if (sql.startsWith('SELECT codigo')) return [[]]
      if (sql.startsWith('INSERT')) return [{ insertId: 11 }]
      if (sql.startsWith('SELECT id, codigo')) return [[sale]]
      throw new Error(`Unexpected SQL: ${sql}`)
    }
  }
  const vehicle = {
    id: 7,
    placa: 'ABC1D23',
    marca: 'Toyota',
    modelo: 'Corolla',
    ano: 2024,
    cor: 'Branco',
    preco: 85000,
    status: 'DISPONIVEL'
  }
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/internal/clientes/12345678901')) {
      return new Response(JSON.stringify({
        id: 8,
        nome: 'Maria Silva',
        cpf: '12345678901',
        email: 'maria@email.com'
      }))
    }
    if (url.endsWith('/internal/veiculos/ABC1D23')) {
      return new Response(JSON.stringify(vehicle))
    }
    if (url.endsWith('/internal/veiculos/ABC1D23/status')) {
      return new Response(JSON.stringify({ placa: vehicle.placa, status: 'RESERVADO' }))
    }
    throw new Error(`Unexpected API request: ${url}`)
  }
  const app = createApp({
    db,
    clientesBaseUrl: 'http://clientes-service',
    veiculosBaseUrl: 'http://veiculos-service',
    fetchImpl
  })

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/vendas/reservar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' })
    })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.veiculoPlaca, 'ABC1D23')
    assert.equal(body.clienteCpf, '12345678901')
    assert.equal(body.status, 'AGUARDANDO_PAGAMENTO')
    assert.equal(body.veiculo.status, 'RESERVADO')
    assert.equal(calls.length, 3)
    assert.equal(statements.length, 3)
    assert.ok(statements.every((sql) => sql.includes('vendas')))
  })
})
