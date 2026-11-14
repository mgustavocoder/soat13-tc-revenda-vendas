import assert from 'node:assert/strict'
import test from 'node:test'
import { VendaUsecase } from '../../../src/application/usecases/venda-usecase.js'
import { BusinessRuleError } from '../../../src/domain/errors/business-rule-error.js'
import { DuplicateResourceError } from '../../../src/domain/errors/duplicate-resource-error.js'
import { InvalidInputError } from '../../../src/domain/errors/invalid-input-error.js'
import { ResourceNotFoundError } from '../../../src/domain/errors/resource-not-found-error.js'
import { makePublisher, makeRepository, silentLogger, vendaExistente } from './fakes.js'

const clientes = (cliente = { id: 8 }) => ({ async buscarPorCpf() { return cliente } })

test('reservar validates the client, persists the sale and publishes VENDA_CRIADA', async () => {
  const repository = makeRepository()
  const publisher = makePublisher()
  const usecase = new VendaUsecase(repository, clientes(), publisher, silentLogger)

  const venda = await usecase.reservar({ veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' })

  assert.equal(venda.status, 'RESERVA_PROCESSANDO')
  assert.equal(venda.clienteId, 8)
  assert.deepEqual(publisher.events, [{
    tipo: 'VENDA_CRIADA', vendaCodigo: venda.codigo, veiculoPlaca: 'ABC1D23', clienteId: 8
  }])
})

test('reservar fails fast for invalid input or unknown clients without publishing', async () => {
  const publisher = makePublisher()
  const usecase = new VendaUsecase(makeRepository(), clientes(null), publisher, silentLogger)
  await assert.rejects(usecase.reservar({ veiculoPlaca: 'X', clienteCpf: '1' }), InvalidInputError)
  await assert.rejects(usecase.reservar({ veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' }), ResourceNotFoundError)
  assert.equal(publisher.events.length, 0)
})

test('reservar marks the sale as failed when the event cannot be published', async () => {
  const repository = makeRepository()
  const usecase = new VendaUsecase(repository, clientes(), makePublisher({ fail: true }), silentLogger)
  await assert.rejects(usecase.reservar({ veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' }), /queue down/)
  const [row] = repository.rows.values()
  assert.equal(row.status, 'RESERVA_FALHOU')
  assert.equal(row.ultimoErro, 'Não foi possível iniciar a reserva.')
})

test('reservar propagates the active-sale conflict from the repository', async () => {
  const repository = makeRepository()
  repository.criar = async () => { throw new DuplicateResourceError('Já existe uma venda ativa com este veículo.') }
  const usecase = new VendaUsecase(repository, clientes(), makePublisher(), silentLogger)
  await assert.rejects(usecase.reservar({ veiculoPlaca: 'ABC1D23', clienteCpf: '12345678901' }), DuplicateResourceError)
})

test('confirmarPagamento moves to PAGAMENTO_PROCESSANDO and publishes PAGAMENTO_RECEBIDO', async () => {
  const repository = makeRepository([vendaExistente()])
  const publisher = makePublisher()
  const usecase = new VendaUsecase(repository, clientes(), publisher, silentLogger)

  const venda = await usecase.confirmarPagamento('ven-1234abcd')

  assert.equal(venda.status, 'PAGAMENTO_PROCESSANDO')
  assert.equal(repository.rows.get('VEN-1234ABCD').status, 'PAGAMENTO_PROCESSANDO')
  assert.deepEqual(publisher.events, [{ tipo: 'PAGAMENTO_RECEBIDO', vendaCodigo: 'VEN-1234ABCD', veiculoPlaca: 'ABC1D23' }])
})

test('cancelar publishes VENDA_CANCELADA so vehicles can compensate the reservation', async () => {
  const repository = makeRepository([vendaExistente({ status: 'PAGAMENTO_FALHOU', ultimoErro: 'x' })])
  const publisher = makePublisher()
  const usecase = new VendaUsecase(repository, clientes(), publisher, silentLogger)

  const venda = await usecase.cancelar('VEN-1234ABCD')

  assert.equal(venda.status, 'CANCELADA')
  assert.equal(publisher.events[0].tipo, 'VENDA_CANCELADA')
})

test('commands restore the previous state when the event cannot be published', async () => {
  const repository = makeRepository([vendaExistente({ status: 'PAGAMENTO_FALHOU', ultimoErro: 'erro anterior' })])
  const usecase = new VendaUsecase(repository, clientes(), makePublisher({ fail: true }), silentLogger)

  await assert.rejects(usecase.cancelar('VEN-1234ABCD'), /queue down/)
  await assert.rejects(usecase.confirmarPagamento('VEN-1234ABCD'), /queue down/)

  const row = repository.rows.get('VEN-1234ABCD')
  assert.equal(row.status, 'PAGAMENTO_FALHOU')
  assert.equal(row.ultimoErro, 'erro anterior')
})

test('commands reject invalid codes, missing sales and concurrent changes', async () => {
  const repository = makeRepository([vendaExistente()])
  repository.atualizar = async () => false
  const usecase = new VendaUsecase(repository, clientes(), makePublisher(), silentLogger)
  await assert.rejects(usecase.cancelar('abc'), InvalidInputError)
  await assert.rejects(usecase.cancelar('VEN-00000000'), ResourceNotFoundError)
  await assert.rejects(usecase.cancelar('VEN-1234ABCD'), /alterada por outra operação/)
  await assert.rejects(usecase.confirmarPagamento('VEN-1234ABCD'), BusinessRuleError)
})
