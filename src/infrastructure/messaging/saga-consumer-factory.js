import { EventosVeiculo } from '../../application/gateways/eventos-veiculo.js'
import { VendaSagaUsecase } from '../../application/usecases/venda-saga-usecase.js'
import { InvalidInputError } from '../../domain/errors/invalid-input-error.js'
import { MysqlVendaRepository } from '../datasource/mysql-venda-repository.js'
import { SqsConsumer } from './sqs-consumer.js'
import { SqsVendaEventosPublisher } from './sqs-venda-eventos-publisher.js'

/**
 * Liga os eventos de veículos (entrada) às reações de vendas. Compensações
 * emitidas por vendas são publicadas na fila de eventos de vendas (saída).
 */
const sagaConsumerFactory = ({ db, sqsClient, vendasEventosUrl, veiculosEventosUrl, logger }) => {
  const sagaUsecase = new VendaSagaUsecase(
    new MysqlVendaRepository(db),
    new SqsVendaEventosPublisher({ sqsClient, queueUrl: vendasEventosUrl, logger }),
    logger
  )

  return new SqsConsumer({
    sqsClient,
    queueUrl: veiculosEventosUrl,
    logger,
    isPermanentError: (error) => error instanceof InvalidInputError,
    handlers: {
      [EventosVeiculo.VEICULO_RESERVADO]: (evento) => sagaUsecase.onVeiculoReservado(evento),
      [EventosVeiculo.VEICULO_RESERVA_FALHOU]: (evento) => sagaUsecase.onVeiculoReservaFalhou(evento),
      [EventosVeiculo.VEICULO_VENDIDO]: (evento) => sagaUsecase.onVeiculoVendido(evento),
      [EventosVeiculo.VEICULO_VENDA_FALHOU]: (evento) => sagaUsecase.onVeiculoVendaFalhou(evento),
      [EventosVeiculo.VEICULO_LIBERADO]: (evento) => sagaUsecase.onVeiculoLiberado(evento)
    }
  })
}

export { sagaConsumerFactory }
