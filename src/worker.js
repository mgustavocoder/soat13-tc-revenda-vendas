import 'dotenv/config'
import { SQSClient } from '@aws-sdk/client-sqs'
import { createPool } from 'mysql2/promise'
import { createSalesOperations } from './sales-operations.js'
import { createSqsWorker } from './sqs-worker.js'

const queueUrl = process.env.SQS_QUEUE_URL
if (!queueUrl) throw new Error('SQS_QUEUE_URL must be configured for the sales worker')

const db = createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'vendas_db',
  waitForConnections: true,
  connectionLimit: 5
})
const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' })
const operations = createSalesOperations({
  db,
  clientesBaseUrl: process.env.CLIENTES_SERVICE_URL || 'http://clientes.revenda.svc.cluster.local:3001',
  veiculosBaseUrl: process.env.VEICULOS_SERVICE_URL || 'http://veiculos.revenda.svc.cluster.local:3002'
})
const worker = createSqsWorker({ sqsClient, queueUrl, operations })

process.once('SIGTERM', () => worker.stop())
process.once('SIGINT', () => worker.stop())

try {
  await worker.run()
} finally {
  sqsClient.destroy()
  await db.end()
}
