import { randomUUID } from 'node:crypto'
import { SendMessageCommand } from '@aws-sdk/client-sqs'

/**
 * Publica eventos de domínio em uma fila SQS standard. Cada evento leva um
 * envelope com identificador, tipo e data de ocorrência; o tipo também vai em
 * MessageAttributes para permitir filtros e observabilidade.
 */
class SqsProducer {
  constructor({ sqsClient, queueUrl, origem, logger }) {
    this.sqsClient = sqsClient
    this.queueUrl = queueUrl
    this.origem = origem
    this.logger = logger
  }

  async publicar(tipo, payload) {
    if (!this.queueUrl) {
      throw new Error(`Fila de eventos de ${this.origem} não configurada.`)
    }
    const evento = {
      eventoId: randomUUID(),
      tipo,
      origem: this.origem,
      ocorridoEm: new Date().toISOString(),
      ...payload
    }
    await this.sqsClient.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(evento),
      MessageAttributes: {
        tipo: { DataType: 'String', StringValue: tipo }
      }
    }))
    this.logger?.info(`Evento ${tipo} publicado.`, { vendaCodigo: payload.vendaCodigo })
    return evento
  }
}

export { SqsProducer }
