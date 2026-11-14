import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs'

const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Consumidor genérico de eventos SQS.
 *
 * - `handlers` mapeia o `tipo` do evento para a função do caso de uso.
 * - Sucesso, evento desconhecido, JSON inválido ou erro permanente → a
 *   mensagem é removida da fila.
 * - Erro transitório → a mensagem volta para a fila após o visibility timeout
 *   e, ao exceder `maxReceiveCount`, vai para a DLQ pela redrive policy.
 * - `onExhausted` (opcional, por tipo) roda na última tentativa, permitindo
 *   publicar um evento de falha/compensação antes de a mensagem ir para a DLQ.
 */
class SqsConsumer {
  constructor({
    sqsClient,
    queueUrl,
    handlers,
    onExhausted = {},
    isPermanentError = () => false,
    logger,
    maxReceiveCount = 5,
    waitTimeSeconds = 20,
    visibilityTimeout = 180,
    errorDelayMs = 5000
  }) {
    this.sqsClient = sqsClient
    this.queueUrl = queueUrl
    this.handlers = handlers
    this.onExhausted = onExhausted
    this.isPermanentError = isPermanentError
    this.logger = logger
    this.maxReceiveCount = maxReceiveCount
    this.waitTimeSeconds = waitTimeSeconds
    this.visibilityTimeout = visibilityTimeout
    this.errorDelayMs = errorDelayMs
    this.running = false
  }

  async start() {
    this.running = true
    this.logger.info('Consumidor SQS iniciado.', { queueUrl: this.queueUrl })
    while (this.running) {
      try {
        const response = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          WaitTimeSeconds: this.waitTimeSeconds,
          VisibilityTimeout: this.visibilityTimeout
        }))
        for (const message of response.Messages || []) {
          await this.handleMessage(message)
        }
      } catch (error) {
        this.logger.error('Falha ao consultar a fila SQS.', { error: error.message })
        if (this.running) await delay(this.errorDelayMs)
      }
    }
  }

  stop() {
    this.running = false
  }

  async handleMessage(message) {
    let evento
    try {
      evento = JSON.parse(message.Body || '')
    } catch {
      this.logger.error('Mensagem SQS com JSON inválido descartada.', { messageId: message.MessageId })
      return this.#delete(message)
    }

    const handler = this.handlers[evento?.tipo]
    if (!handler) {
      this.logger.warn(`Evento ${evento?.tipo} ignorado.`, { messageId: message.MessageId })
      return this.#delete(message)
    }

    try {
      await handler(evento)
      return this.#delete(message)
    } catch (error) {
      this.logger.error(`Falha ao processar o evento ${evento.tipo}.`, {
        messageId: message.MessageId,
        vendaCodigo: evento.vendaCodigo,
        error: error.message
      })
      if (this.isPermanentError(error)) return this.#delete(message)
      await this.#handleRetry(message, evento)
    }
  }

  async #handleRetry(message, evento) {
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount || 1)
    const exhausted = this.onExhausted[evento.tipo]
    if (receiveCount < this.maxReceiveCount || !exhausted) return
    try {
      await exhausted(evento)
    } catch (error) {
      this.logger.error(`Falha ao compensar o evento ${evento.tipo} após esgotar as tentativas.`, {
        messageId: message.MessageId,
        error: error.message
      })
    }
  }

  async #delete(message) {
    await this.sqsClient.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: message.ReceiptHandle
    }))
  }
}

export { SqsConsumer }
