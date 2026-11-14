import 'dotenv/config'
import { SQSClient } from '@aws-sdk/client-sqs'
import { controllersFactory } from '../controllers/controllers-factory.js'
import { createMysqlPool } from '../datasource/mysql-connection.js'
import { Logger } from '../logger.js'
import { createApp } from './app.js'

const logger = new Logger()
const port = Number(process.env.VENDAS_PORT || 3003)
const app = createApp({
  ...controllersFactory({
    db: createMysqlPool(),
    sqsClient: new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' }),
    vendasEventosUrl: process.env.SQS_VENDAS_EVENTOS_URL,
    clientesBaseUrl: process.env.CLIENTES_SERVICE_URL || 'http://localhost:3001',
    logger
  }),
  logger
})

app.listen(port, '0.0.0.0', () => {
  logger.info(`Serviço de vendas disponível na porta ${port}`)
})
