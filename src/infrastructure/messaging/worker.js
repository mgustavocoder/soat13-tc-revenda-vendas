import 'dotenv/config'
import { SQSClient } from '@aws-sdk/client-sqs'
import { createMysqlPool } from '../datasource/mysql-connection.js'
import { Logger } from '../logger.js'
import { sagaConsumerFactory } from './saga-consumer-factory.js'

const vendasEventosUrl = process.env.SQS_VENDAS_EVENTOS_URL
const veiculosEventosUrl = process.env.SQS_VEICULOS_EVENTOS_URL
if (!vendasEventosUrl || !veiculosEventosUrl) {
  throw new Error('SQS_VENDAS_EVENTOS_URL and SQS_VEICULOS_EVENTOS_URL must be configured for the sales worker')
}

const logger = new Logger()
const db = createMysqlPool({ connectionLimit: 5 })
const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' })
const consumer = sagaConsumerFactory({ db, sqsClient, vendasEventosUrl, veiculosEventosUrl, logger })

process.once('SIGTERM', () => consumer.stop())
process.once('SIGINT', () => consumer.stop())

try {
  await consumer.start()
} finally {
  sqsClient.destroy()
  await db.end()
}
