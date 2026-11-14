import assert from 'node:assert/strict'
import test from 'node:test'
import { createSalesOperations } from '../src/sales-operations.js'

const makeDb = (initialSale) => {
  const sale = { ...initialSale }
  const db = {
    execute: async (sql, params = []) => {
      if (sql.startsWith('SELECT id, codigo')) return [[{ ...sale }]]
      if (sql.startsWith('SELECT codigo')) return [[]]
      if (sql.includes("SET veiculo_id = ?")) {
        Object.assign(sale, {
          veiculo_id: params[0],
          cliente_id: params[1],
          preco: params[2],
          status: 'AGUARDANDO_PAGAMENTO'
        })
        return [{ affectedRows: 1 }]
      }
      if (sql.includes("SET status = 'PAGAMENTO_CONFIRMADO'")) {
        sale.status = 'PAGAMENTO_CONFIRMADO'
        return [{ affectedRows: 1 }]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    }
  }
  return { db, sale }
}

test('reservation worker processes the vehicle and ignores duplicate delivery', async () => {
  const { db, sale } = makeDb({
    codigo: 'VEN-1234ABCD',
    veiculo_placa: 'ABC1D23',
    cliente_cpf: '12345678901',
    status: 'RESERVA_PROCESSANDO'
  })
  const vehicle = { id: 7, preco: 85000, status: 'DISPONIVEL' }
  const calls = []
  const operations = createSalesOperations({
    db,
    clientesBaseUrl: 'http://clientes',
    veiculosBaseUrl: 'http://veiculos',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/internal/clientes/12345678901')) {
        return new Response(JSON.stringify({ id: 8 }))
      }
      if (url.endsWith('/internal/veiculos/ABC1D23/status')) {
        vehicle.status = JSON.parse(options.body).status
        return new Response(JSON.stringify(vehicle))
      }
      if (url.endsWith('/internal/veiculos/ABC1D23')) {
        return new Response(JSON.stringify(vehicle))
      }
      throw new Error(`Unexpected API request: ${url}`)
    }
  })

  await operations.processMessage({ tipo: 'RESERVAR_VEICULO', codigo: sale.codigo })
  await operations.processMessage({ tipo: 'RESERVAR_VEICULO', codigo: sale.codigo })

  assert.equal(sale.status, 'AGUARDANDO_PAGAMENTO')
  assert.equal(sale.veiculo_id, 7)
  assert.equal(sale.cliente_id, 8)
  assert.equal(vehicle.status, 'RESERVADO')
  assert.equal(calls.length, 3)
})

test('payment worker marks the sale confirmed and ignores duplicate delivery', async () => {
  const { db, sale } = makeDb({
    codigo: 'VEN-1234ABCD',
    veiculo_placa: 'ABC1D23',
    cliente_cpf: '12345678901',
    status: 'PAGAMENTO_PROCESSANDO'
  })
  const vehicle = { id: 7, status: 'RESERVADO' }
  const calls = []
  const operations = createSalesOperations({
    db,
    clientesBaseUrl: 'http://clientes',
    veiculosBaseUrl: 'http://veiculos',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/internal/veiculos/ABC1D23/status')) {
        vehicle.status = JSON.parse(options.body).status
        return new Response(JSON.stringify(vehicle))
      }
      if (url.endsWith('/internal/veiculos/ABC1D23')) {
        return new Response(JSON.stringify(vehicle))
      }
      throw new Error(`Unexpected API request: ${url}`)
    }
  })

  await operations.processMessage({ tipo: 'CONFIRMAR_PAGAMENTO', codigo: sale.codigo })
  await operations.processMessage({ tipo: 'CONFIRMAR_PAGAMENTO', codigo: sale.codigo })

  assert.equal(sale.status, 'PAGAMENTO_CONFIRMADO')
  assert.equal(vehicle.status, 'VENDIDO')
  assert.equal(calls.length, 2)
})
