import { ServiceUnavailableError } from '../../application/errors/service-unavailable-error.js'
import { VendaEventosPublisher } from '../../application/gateways/venda-eventos-publisher.js'
import { SqsProducer } from './sqs-producer.js'

class SqsVendaEventosPublisher extends VendaEventosPublisher {
  constructor({ sqsClient, queueUrl, logger }) {
    super()
    this.logger = logger
    this.producer = new SqsProducer({ sqsClient, queueUrl, origem: 'vendas', logger })
  }

  async publicar(tipo, payload) {
    try {
      return await this.producer.publicar(tipo, payload)
    } catch (cause) {
      this.logger?.error(`Falha ao publicar o evento ${tipo}.`, { vendaCodigo: payload.vendaCodigo, error: cause.message })
      throw new ServiceUnavailableError('Fila de eventos de vendas indisponível.', { cause })
    }
  }
}

export { SqsVendaEventosPublisher }
