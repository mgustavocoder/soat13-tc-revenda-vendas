import assert from 'node:assert/strict'
import test from 'node:test'
import { ConcurrentUpdateError, VendaSagaUsecase } from '../../../src/application/usecases/venda-saga-usecase.js'
import { InvalidInputError } from '../../../src/domain/errors/invalid-input-error.js'
import { makePublisher, makeRepository, silentLogger, vendaExistente } from './fakes.js'

const setup = (status, overrides = {}) => {
  const repository = makeRepository([vendaExistente({ status, ...overrides })])
  const publisher = makePublisher()
  const usecase = new VendaSagaUsecase(repository, publisher, silentLogger)
  return { repository, publisher, usecase, row: () => repository.rows.get('VEN-1234ABCD') }
}

const base = { vendaCodigo: 'VEN-1234ABCD', veiculoPlaca: 'ABC1D23' }

test('VEICULO_RESERVADO completes the reservation step and ignores redelivery', async () => {
  const { usecase, publisher, row } = setup('RESERVA_PROCESSANDO')
  const evento = { tipo: 'VEICULO_RESERVADO', ...base, veiculoId: 7, preco: 85000 }
  await usecase.onVeiculoReservado(evento)
  await usecase.onVeiculoReservado(evento)
  assert.equal(row().status, 'AGUARDANDO_PAGAMENTO')
  assert.equal(row().veiculoId, 7)
  assert.equal(row().preco, 85000)
  assert.equal(publisher.events.length, 0)
})

test('VEICULO_RESERVADO for an already closed sale publishes a compensating VENDA_CANCELADA', async () => {
  const { usecase, publisher, row } = setup('RESERVA_FALHOU')
  await usecase.onVeiculoReservado({ tipo: 'VEICULO_RESERVADO', ...base, veiculoId: 7, preco: 1 })
  assert.equal(row().status, 'RESERVA_FALHOU')
  assert.deepEqual(publisher.events.map(e => e.tipo), ['VENDA_CANCELADA'])
})

test('VEICULO_RESERVA_FALHOU ends the saga with the reason reported by vehicles', async () => {
  const { usecase, row } = setup('RESERVA_PROCESSANDO')
  await usecase.onVeiculoReservaFalhou({ tipo: 'VEICULO_RESERVA_FALHOU', ...base, motivo: 'Veículo não está disponível para venda.' })
  assert.equal(row().status, 'RESERVA_FALHOU')
  assert.equal(row().ultimoErro, 'Veículo não está disponível para venda.')
})

test('VEICULO_VENDIDO confirms the payment and VEICULO_VENDA_FALHOU allows a retry', async () => {
  const sold = setup('PAGAMENTO_PROCESSANDO')
  await sold.usecase.onVeiculoVendido({ tipo: 'VEICULO_VENDIDO', ...base })
  assert.equal(sold.row().status, 'PAGAMENTO_CONFIRMADO')

  const failed = setup('PAGAMENTO_PROCESSANDO')
  await failed.usecase.onVeiculoVendaFalhou({ tipo: 'VEICULO_VENDA_FALHOU', ...base, motivo: 'O veículo não está reservado para esta venda.' })
  assert.equal(failed.row().status, 'PAGAMENTO_FALHOU')
})

test('events that do not match the current state are ignored', async () => {
  const { usecase, row } = setup('CANCELADA')
  await usecase.onVeiculoVendido({ tipo: 'VEICULO_VENDIDO', ...base })
  await usecase.onVeiculoReservaFalhou({ tipo: 'VEICULO_RESERVA_FALHOU', ...base })
  await usecase.onVeiculoLiberado({ tipo: 'VEICULO_LIBERADO', ...base })
  await usecase.onVeiculoVendido({ tipo: 'VEICULO_VENDIDO', ...base, vendaCodigo: 'VEN-00000000' })
  assert.equal(row().status, 'CANCELADA')
})

test('invalid events are permanent errors and lost updates are retried', async () => {
  const { usecase, repository } = setup('PAGAMENTO_PROCESSANDO')
  await assert.rejects(usecase.onVeiculoVendido({ tipo: 'VEICULO_VENDIDO' }), InvalidInputError)
  repository.atualizar = async () => false
  await assert.rejects(usecase.onVeiculoVendido({ tipo: 'VEICULO_VENDIDO', ...base }), ConcurrentUpdateError)
})
