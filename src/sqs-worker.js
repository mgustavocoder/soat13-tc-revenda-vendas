import {
  DeleteMessageCommand,
  ReceiveMessageCommand
} from '@aws-sdk/client-sqs'

const maxReceiveCount = 5
const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

const createSqsWorker = ({ sqsClient, queueUrl, operations, logger = console }) => {
  let stopping = false

  const handleMessage = async (message) => {
    let operation
    try {
      operation = JSON.parse(message.Body || '')
      await operations.processMessage(operation)
      await sqsClient.send(new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }))
    } catch (error) {
      logger.error('Falha ao processar mensagem da fila de vendas.', {
        messageId: message.MessageId,
        error: error.message
      })

      try {
        const receiveCount = Number(message.Attributes?.ApproximateReceiveCount || 1)
        if (error.permanent && operation) {
          await operations.failOperation(operation, error.message)
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }))
        } else if (receiveCount >= maxReceiveCount && operation) {
          await operations.failOperation(
            operation,
            'Não foi possível concluir a operação após várias tentativas.'
          )
        }
      } catch (handlingError) {
        logger.error('Falha ao registrar o erro da mensagem de vendas.', {
          messageId: message.MessageId,
          error: handlingError.message
        })
      }
    }
  }

  const run = async () => {
    while (!stopping) {
      try {
        const response = await sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          WaitTimeSeconds: 20,
          VisibilityTimeout: 180
        }))

        for (const message of response.Messages || []) {
          await handleMessage(message)
        }
      } catch (error) {
        logger.error('Falha ao consultar a fila de vendas.', { error: error.message })
        await delay(5000)
      }
    }
  }

  return {
    run,
    stop: () => { stopping = true }
  }
}

export { createSqsWorker }
