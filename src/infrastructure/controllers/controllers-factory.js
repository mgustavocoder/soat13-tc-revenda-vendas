import { VendaUsecase } from '../../application/usecases/venda-usecase.js'
import { MysqlVendaRepository } from '../datasource/mysql-venda-repository.js'
import { ClientesHttpGateway } from '../gateways/clientes-http-gateway.js'
import { SqsVendaEventosPublisher } from '../messaging/sqs-venda-eventos-publisher.js'
import { VendaController } from './venda-controller.js'

const controllersFactory = ({ db, sqsClient, vendasEventosUrl, clientesBaseUrl, fetchImpl, logger }) => {
  const vendaUsecase = new VendaUsecase(
    new MysqlVendaRepository(db),
    new ClientesHttpGateway({ baseUrl: clientesBaseUrl, fetchImpl }),
    new SqsVendaEventosPublisher({ sqsClient, queueUrl: vendasEventosUrl, logger }),
    logger
  )
  return { vendaController: new VendaController(vendaUsecase) }
}

export { controllersFactory }
