import assert from 'node:assert/strict'
import test from 'node:test'
import { StatusVenda, Venda } from '../../../src/domain/entities/venda.js'
import { BusinessRuleError } from '../../../src/domain/errors/business-rule-error.js'
import { InvalidInputError } from '../../../src/domain/errors/invalid-input-error.js'

const nova = () => Venda.iniciar({ veiculoPlaca: 'abc-1d23', clienteCpf: '123.456.789-01', clienteId: 8 })

test('Venda.iniciar normalizes input and starts the saga waiting for the reservation', () => {
  const venda = nova()
  assert.match(venda.codigo, /^VEN-[A-F0-9]{8}$/)
  assert.equal(venda.veiculoPlaca, 'ABC1D23')
  assert.equal(venda.clienteCpf, '12345678901')
  assert.equal(venda.status, StatusVenda.RESERVA_PROCESSANDO)
  assert.throws(() => Venda.iniciar({ veiculoPlaca: 'X', clienteCpf: '1' }), InvalidInputError)
})

test('happy path: reservation, payment request and sale confirmation', () => {
  const venda = nova()
  venda.confirmarReserva({ veiculoId: 7, preco: 85000 })
  assert.equal(venda.status, StatusVenda.AGUARDANDO_PAGAMENTO)
  assert.equal(venda.preco, 85000)
  venda.iniciarPagamento()
  assert.equal(venda.status, StatusVenda.PAGAMENTO_PROCESSANDO)
  venda.concluirPagamento()
  assert.equal(venda.status, StatusVenda.PAGAMENTO_CONFIRMADO)
  assert.throws(() => venda.cancelar(), /já confirmada/)
  assert.throws(() => venda.iniciarPagamento(), /já confirmado/)
})

test('failures record the reason and failed payments can be retried or cancelled', () => {
  const venda = nova()
  venda.confirmarReserva({ veiculoId: 7, preco: 1 })
  venda.iniciarPagamento()
  venda.falharPagamento('x'.repeat(600))
  assert.equal(venda.status, StatusVenda.PAGAMENTO_FALHOU)
  assert.equal(venda.ultimoErro.length, 500)
  assert.equal(venda.toPublic().erro.length, 500)
  venda.iniciarPagamento()
  assert.equal(venda.ultimoErro, null)
  venda.falharPagamento('de novo')
  venda.cancelar()
  assert.equal(venda.status, StatusVenda.CANCELADA)
  assert.throws(() => venda.cancelar(), /já cancelada/)
})

test('commands are rejected while the saga step is still processing', () => {
  const venda = nova()
  assert.throws(() => venda.cancelar(), BusinessRuleError)
  assert.throws(() => venda.iniciarPagamento(), /não está pronta/)
  venda.falharReserva('Veículo não está disponível para venda.')
  assert.equal(venda.status, StatusVenda.RESERVA_FALHOU)
  assert.equal(venda.dispensaReserva(), true)
})
